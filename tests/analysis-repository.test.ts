import {afterEach, describe, expect, it, vi } from 'vitest';
import { AnalysisRepository, SessionCredentials } from '../src/analysis/repository';
import {createRun} from '../src/analysis/engine';
import { examplePackage } from './fixtures/analysis/package';
afterEach(()=>vi.unstubAllGlobals());
const storage = () => {
  const values: Record<string, unknown> = {};
  return { values, get: vi.fn(async (key: string) => ({ [key]: structuredClone(values[key]) })), set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, structuredClone(items)); }), remove: vi.fn(async (key: string) => { delete values[key]; }) };
};
describe('analysis persistence and credentials', () => {
  it('roundtrips validated report packages and deletes only requested history', async () => {
    const area = storage(); const repo = new AnalysisRepository(area);
    const pkg = examplePackage(); await repo.savePackage(pkg);
    expect(await repo.getPackage(pkg.id)).toEqual(pkg);
    expect(await repo.list()).toEqual([{ id: 'run-1', title: '测试讨论', createdAt: pkg.createdAt, status: 'completed' }]);
    await repo.delete('not-this-run'); expect(await repo.getPackage(pkg.id)).toEqual(pkg);
    await repo.delete(pkg.id); expect(await repo.list()).toEqual([]);
  });
  it('serializes concurrent saves without losing a report', async () => {
    const area = storage(); const repo = new AnalysisRepository(area);
    const a = examplePackage(); const b = examplePackage(); b.id = 'run-2';
    await Promise.all([repo.savePackage(a), repo.savePackage(b)]);
    expect(await repo.list()).toHaveLength(2);
  });
  it('reports persistence failures and rejects secret-bearing report payloads', async () => {
    const area = storage(); const repo = new AnalysisRepository(area);
    await expect(repo.savePackage({ ...examplePackage(), apiKey: 'secret' } as any)).rejects.toThrow('unknown_field');
    area.set.mockRejectedValueOnce(new Error('quota'));
    await expect(repo.savePackage(examplePackage())).rejects.toThrow('storage_write');
    expect(await repo.list()).toEqual([]);
  });
  it('binds session keys to a purpose and exact origin and never puts them in local history', async () => {
    const session = storage(); const local = storage(); const vault = new SessionCredentials(session);
    await vault.set('model-a', 'https://api.deepseek.com', 'sk-test-secret');
    expect(await vault.has('model-a', 'https://api.deepseek.com')).toBe(true);
    expect(await vault.has('model-a', 'https://api.other.com')).toBe(false);
    await expect(vault.read('model-a', 'https://api.other.com')).rejects.toThrow('missing_key');
    expect(await vault.read('model-a', 'https://api.deepseek.com')).toBe('sk-test-secret');
    expect(JSON.stringify(local.values)).not.toContain('sk-test');
    await vault.clear('model-a'); expect(await vault.has('model-a', 'https://api.deepseek.com')).toBe(false);
  });
  it('does not let malformed storage or inherited fields turn into credentials', async () => {
    const area = storage(); const vault = new SessionCredentials(area);
    await expect(vault.set('__proto__', 'https://api.deepseek.com', 'secret')).rejects.toThrow('invalid_credential');
    await expect(vault.set('a', 'http://127.0.0.1', 'secret')).rejects.toThrow();
    await expect(vault.set('a', 'https://api.deepseek.com/v1', 'secret')).rejects.toThrow('invalid_credential');
    await expect(vault.read('toString', 'https://api.deepseek.com')).rejects.toThrow('missing_key');
  });
});

it('does not resurrect deleted analysis through late running checkpoints or report saves',async()=>{
  const area=storage();const first=new AnalysisRepository(area);const another=new AnalysisRepository(area);
  const pkg=examplePackage();const job=createRun(pkg.snapshot,{id:'m1',name:'AI',baseUrl:'https://api.example.org/v1',model:'test',temperature:0,maxOutputTokens:4096,declaredVersion:''});
  job.state='running';await first.saveJob(job);await first.savePackage(job.package);
  await another.delete(job.id);
  await expect(first.saveJob(job)).rejects.toThrow('analysis_deleted');
  await expect(first.savePackage(job.package)).rejects.toThrow('analysis_deleted');
  expect(await new AnalysisRepository(area).getJob(job.id)).toBeNull();expect(await first.getPackage(job.id)).toBeNull();
  expect(await first.list()).toEqual([]);
});

it.each(['history','jobs'])('serializes saves across repository instances without dropping another %s record',async(kind)=>{
  const area=storage();const repo=new AnalysisRepository(area);const another=new AnalysisRepository(area);const cfg={id:'m1',name:'AI',baseUrl:'https://api.example.org/v1',model:'test',temperature:0,maxOutputTokens:4096,declaredVersion:''};
  const a=createRun(examplePackage().snapshot,cfg);const b=createRun(examplePackage().snapshot,cfg);const c=createRun(examplePackage().snapshot,cfg);const key=`gzk:analysis:${kind}:v1`;
  const save=(r:AnalysisRepository,job:typeof a)=>kind==='history'?r.savePackage(job.package):r.saveJob(job);
  await save(repo,a);
  const originalGet=area.get.getMockImplementation()!;let release!:()=>void;let entered!:()=>void;let armed=true;
  const enteredPromise=new Promise<void>(r=>{entered=r;});const wait=new Promise<void>(r=>{release=r;});
  area.get.mockImplementation(async(request)=>{const value=await originalGet(request);if(armed&&request===key){armed=false;entered();await wait;}return value;});
  const savingB=save(repo,b);await enteredPromise;
  let cFinished=false;const savingC=save(another,c).then(()=>{cFinished=true;});
  await new Promise(r=>setTimeout(r,15));const completedBeforeRelease=cFinished;release();await Promise.all([savingB,savingC]);
  expect(completedBeforeRelease).toBe(false);
  expect(area.values[key]).toHaveProperty(b.id);expect(area.values[key]).toHaveProperty(c.id);
});
it.each(['history','jobs'])('coordinates deletion with a paused save of another %s record',async(kind)=>{
  const area=storage();const repo=new AnalysisRepository(area);const cfg={id:'m1',name:'AI',baseUrl:'https://api.example.org/v1',model:'test',temperature:0,maxOutputTokens:4096,declaredVersion:''};
  const a=createRun(examplePackage().snapshot,cfg);const b=createRun(examplePackage().snapshot,cfg);const key=`gzk:analysis:${kind}:v1`;
  const save=(job:typeof a)=>kind==='history'?repo.savePackage(job.package):repo.saveJob(job);
  await save(a);const originalGet=area.get.getMockImplementation()!;let release!:()=>void;let entered!:()=>void;let armed=true;
  const enteredPromise=new Promise<void>(r=>{entered=r;});const wait=new Promise<void>(r=>{release=r;});
  area.get.mockImplementation(async(request)=>{const value=await originalGet(request);if(armed&&request===key){armed=false;entered();await wait;}return value;});
  const saving=save(b);await enteredPromise;const deleting=new AnalysisRepository(area).delete(a.id);
  await new Promise(r=>setTimeout(r,15));release();await Promise.all([saving,deleting]);
  expect(area.values[key]).not.toHaveProperty(a.id);expect(area.values[key]).toHaveProperty(b.id);
});

it('uses the origin-wide browser lock for different storage wrappers and releases it on failure',async()=>{
  let queue:Promise<unknown>=Promise.resolve();const lock=vi.fn((_name:string,_options:unknown,task:()=>Promise<unknown>)=>{const next=queue.then(task,task);queue=next.catch(()=>{});return next;});
  vi.stubGlobal('navigator',{locks:{request:lock}});
  const area=storage();const repo=new AnalysisRepository(area);const other=new AnalysisRepository({get:area.get,set:area.set,remove:area.remove});
  const a=examplePackage();const b={...examplePackage(),id:'run-b'};
  await Promise.all([repo.savePackage(a),other.savePackage(b)]);
  expect(await repo.list()).toHaveLength(2);expect(lock).toHaveBeenCalledTimes(2);
  expect(lock.mock.calls.every(([name,options])=>name==='gzk-analysis-records-v1'&&(options as any).mode==='exclusive')).toBe(true);
  area.set.mockRejectedValueOnce(new Error('quota'));
  await expect(repo.delete(a.id)).rejects.toThrow();await other.delete(a.id);expect(await repo.list()).toHaveLength(1);
});
it('refuses extension writes if an origin-wide lock is unavailable',async()=>{
  vi.stubGlobal('navigator',{});vi.stubGlobal('location',{protocol:'chrome-extension:'});
  const area=storage();await expect(new AnalysisRepository(area).savePackage(examplePackage())).rejects.toThrow('storage_lock_unavailable');
  expect(area.set).not.toHaveBeenCalled();
});
