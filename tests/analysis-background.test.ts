import { describe, expect, it, vi } from 'vitest';
import { createAnalysisHandler } from '../src/analysis/background';
import { AnalysisRepository } from '../src/analysis/repository';
import { createRun } from '../src/analysis/engine';
import { examplePackage } from './fixtures/analysis/package';
import { buildTrialSuite } from '../src/analysis/calibration-suite';
import { configurationFingerprint, createReplayRun } from '../src/analysis/comparison';
import { hashValue } from '../src/analysis/contracts';

function setup() {
  const localValues: Record<string, any> = {}; const sessionValues: Record<string, any> = {};
  const area = (data: Record<string, any>) => ({ get: vi.fn(async (key: string) => ({ [key]: structuredClone(data[key]) })), set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(data, structuredClone(next)); }), remove: vi.fn(async (key: string) => { delete data[key]; }) });
  const api = { runtime: { id: 'ours', getURL: (path: string) => `chrome-extension://ours${path}` }, storage: { local: area(localValues), session: area(sessionValues) }, permissions: { contains: vi.fn(async () => true) }, tabs: { create: vi.fn(async (_options: unknown) => ({})) } };
  const call = vi.fn(async () => ({ value: { ok: true }, usage: { inputTokens: 1, outputTokens: 1 }, providerModel: 'alias' }));
  return { localValues, sessionValues, api, call, handle: createAnalysisHandler(api, { call }) };
}
const trusted = { id: 'ours', url: 'chrome-extension://ours/analysis.html?topic=121894' };
const website = { id: 'ours', url: 'https://www.guozaoke.com/t/121894' };
const config = { id: 'm1', name: 'My AI', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', temperature: 0, maxOutputTokens: 4096, declaredVersion: '' };
it('upgrades the legacy official DeepSeek default without rewriting historical storage or custom limits',async()=>{
 const test=setup();
 const legacy={...config,model:'deepseek-flash'};
 test.localValues['gzk:analysis:configs:v1']=[legacy,{...legacy,id:'manual',outputTokenPolicy:'manual'},{...legacy,id:'custom',maxOutputTokens:8192},{...legacy,id:'proxy',baseUrl:'https://proxy.example.org'}];
 const result=await test.handle({type:'analysis:config:get'},trusted) as any;
 expect(result.configs.map((c:any)=>c.maxOutputTokens)).toEqual([65536,4096,8192,4096]);
 expect(test.localValues['gzk:analysis:configs:v1'][0]).toEqual(legacy);
});
it('dispatches automatic DeepSeek runs at their frozen limit',async()=>{
 const test=setup();
 const cfg={...config,model:'deepseek-flash',maxOutputTokens:65536,outputTokenPolicy:'auto' as const};
 await test.handle({type:'analysis:config:save',config:cfg,key:'fixture'},trusted);
 const job=createRun(examplePackage().snapshot,cfg);job.state='running';job.callsUsed=1;job.inputCharactersUsed=10000;
 await new AnalysisRepository(test.api.storage.local).saveJob(job);
 await test.handle({type:'analysis:call',jobId:job.id,ticket:1,stage:'claims',input:{}},trusted);
 expect(test.call).toHaveBeenCalledWith(expect.objectContaining({maxOutputTokens:65536,outputTokenPolicy:'manual'}),expect.anything(),expect.anything(),expect.anything());
});
describe('analysis message security', () => {
  it('permits only topic opening from content scripts and rejects credential/config/call access', async () => {
    const { handle, api, call } = setup();
    for (const type of ['analysis:config:get', 'analysis:config:save', 'analysis:probe', 'analysis:call', 'analysis:source:bytes', 'analysis:calibration:create', 'analysis:calibration:step', 'analysis:calibration:assess']) await expect(handle({ type, config, key: 'secret' }, website)).rejects.toThrow('untrusted_sender');
    await expect(handle({ type: 'analysis:open', url: 'https://www.guozaoke.com/t/121894' }, website)).resolves.toBe(true);
    expect(api.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://ours/analysis.html?topic=121894' });
    expect(call).not.toHaveBeenCalled();
    await expect(handle({ type: 'analysis:open', url: 'https://evil.com/t/1' }, website)).rejects.toThrow();
  });
  it('rejects forged extension URL suffixes, other pages and wrong extension IDs', async () => {
    const { handle } = setup();
    for (const sender of [{ id: 'other', url: trusted.url }, { id: 'ours', url: 'https://evil.org/chrome-extension://ours/analysis.html' }, { id: 'ours', url: 'chrome-extension://ours/analysis-view.html' }, { id: 'ours', url: 'chrome-extension://ours/analysis.html/evil' }]) await expect(handle({ type: 'analysis:config:get' }, sender)).rejects.toThrow('untrusted_sender');
  });
  it('requires origin permission and stores only credentials in session, never returns keys', async () => {
    const { handle, api, localValues, sessionValues } = setup();
    api.permissions.contains.mockResolvedValueOnce(false);
    await expect(handle({ type: 'analysis:config:save', config, key: 'sk-private' }, trusted)).rejects.toThrow('permission_required');
    await handle({ type: 'analysis:config:save', config, key: 'sk-private' }, trusted);
    expect(JSON.stringify(localValues)).not.toContain('sk-private'); expect(JSON.stringify(sessionValues)).toContain('sk-private');
    const output = await handle({ type: 'analysis:config:get' }, trusted);
    expect(JSON.stringify(output)).not.toContain('sk-private'); expect(output).toMatchObject({ configs: [{ ...config, hasKey: true }] });
  });
  it('clears an old credential when a configuration changes its target origin', async () => {
    const { handle } = setup(); await handle({ type: 'analysis:config:save', config, key: 'secret' }, trusted);
    await handle({ type: 'analysis:config:save', config: { ...config, baseUrl: 'https://api.other.com/v1' } }, trusted);
    expect(await handle({ type: 'analysis:config:get' }, trusted)).toMatchObject({ configs: [{ hasKey: false }] });
  });
  it('does not permit unpaid/unreserved model requests or replay of a spent reservation', async () => {
    const { handle, call, api } = setup(); await handle({ type: 'analysis:config:save', config, key: 'secret' }, trusted);
    await expect(handle({ type: 'analysis:call', jobId: 'unknown', ticket: 1, stage: 'claims', input: {} }, trusted)).rejects.toThrow('invalid_reservation');
    const job = createRun(examplePackage().snapshot, config); job.state = 'running'; job.callsUsed = 1; job.inputCharactersUsed = 10000;
    await new AnalysisRepository(api.storage.local).saveJob(job);
    const request = { type: 'analysis:call', jobId: job.id, ticket: 1, stage: 'claims', input: { messages: [] } };
    await handle(request, trusted); expect(call).toHaveBeenCalledTimes(1);
    await expect(handle(request, trusted)).rejects.toThrow('invalid_reservation'); expect(call).toHaveBeenCalledTimes(1);
  });
  it('never reflects remote errors or secrets into message errors', async () => {
    const { handle, call } = setup(); await handle({ type: 'analysis:config:save', config, key: 'secret' }, trusted);
    call.mockRejectedValueOnce(new Error('secret entire response'));
    await expect(handle({ type: 'analysis:probe', configId: 'm1', structure: true }, trusted)).rejects.toThrow('provider_failed');
  });
  it('exposes only frozen corpus metadata and never accepts caller-picked qualification receipts', async () => {
    const { handle, call } = setup();
    const metadata = await handle({ type: 'analysis:calibration:info' }, trusted) as any;
    expect(metadata.cases.length).toBeGreaterThanOrEqual(8);
    expect(metadata.cases[0]).not.toHaveProperty('reference');
    expect(JSON.stringify(metadata)).not.toContain('dimensions');
    await expect(handle({ type: 'analysis:calibration:assess', receiptIds: ['imported'] }, trusted)).rejects.toThrow('invalid_request');
    expect(call).not.toHaveBeenCalled();
  });
  it('creates a budgeted frozen batch without a model call and stores no Key with it', async () => {
    const { handle, call, localValues } = setup();
    await handle({ type: 'analysis:config:save', config, key: 'sk-private' }, trusted);
    const batch = await handle({ type:'analysis:calibration:create', configId:config.id, maxCalls:30 }, trusted) as any;
    const suite=await buildTrialSuite();
    expect(batch.maxCalls).toBe(30); expect(batch.slots).toHaveLength(suite.cases.length*suite.thresholds.repetitions);
    expect(call).not.toHaveBeenCalled(); expect(JSON.stringify(localValues)).not.toContain('sk-private');
    expect(await handle({type:'analysis:qualification:get',configId:config.id},trusted)).toBeNull();
  });
  it('honors cancellation while the initial reservation is still being read', async () => {
    const {handle,call,api}=setup();
    await handle({type:'analysis:config:save',config,key:'secret'},trusted);
    const job=createRun(examplePackage().snapshot,config);job.state='running';job.callsUsed=1;job.inputCharactersUsed=10000;
    await new AnalysisRepository(api.storage.local).saveJob(job);
    const get=api.storage.local.get.getMockImplementation()!;
    let release!:()=>void;let entered=false;
    api.storage.local.get.mockImplementationOnce(async key=>{entered=true;await new Promise<void>(resolve=>{release=resolve;});return get(key);});
    const pending=handle({type:'analysis:call',jobId:job.id,ticket:1,stage:'claims',input:{messages:[]}},trusted);
    await vi.waitFor(()=>expect(entered).toBe(true));
    await handle({type:'analysis:cancel',jobId:job.id},trusted);release();
    await expect(pending).rejects.toMatchObject({code:'cancelled'});
    expect(call).not.toHaveBeenCalled();
  });
  it('rejects output-token changes instead of sending parameters different from the frozen run', async()=>{
    const {handle,api,call}=setup();await handle({type:'analysis:config:save',config,key:'secret'},trusted);
    const job=createRun(examplePackage().snapshot,config);job.state='running';job.callsUsed=1;job.inputCharactersUsed=10000;
    await new AnalysisRepository(api.storage.local).saveJob(job);
    await handle({type:'analysis:config:save',config:{...config,maxOutputTokens:128}},trusted);
    await expect(handle({type:'analysis:call',jobId:job.id,ticket:1,stage:'claims',input:{messages:[]}},trusted)).rejects.toThrow('configuration_changed');
    expect(call).not.toHaveBeenCalled();
  });
});

// Seed the trusted background ledger to test gating; this is not a real model qualification.
async function seedQualification(test: ReturnType<typeof setup>) {
  const cfg = { ...config, declaredVersion: 'fixed-2026-09' };
  await test.handle({type:'analysis:config:save', config:cfg, key:'secret'}, trusted);
  const batch = await test.handle({type:'analysis:calibration:create',configId:cfg.id,maxCalls:90},trusted) as any;
  const suite = await buildTrialSuite(); const id = crypto.randomUUID();
  const record = {id,status:'qualified_trial',createdAt:'2026-09-15T09:00:00.000Z',configurationHash:await configurationFingerprint(cfg),methodVersion:suite.methodVersion,suiteHash:suite.hash,providerModel:'alias',referenceLabel:'Synthetic trial only'};
  test.localValues['gzk:analysis:calibration:qualifications:v1']=[id];
  test.localValues[`gzk:analysis:calibration:qualification:v1:${id}`]=record;
  test.localValues[`gzk:analysis:calibration:batch:v1:${batch.id}`].qualificationId=id;
  return {cfg,record};
}
describe('ordinary analysis qualification gate',()=>{
  it('prepares a fresh run from local qualification without sending any API call',async()=>{
    const test=setup();const {cfg,record}=await seedQualification(test);const repo=new AnalysisRepository(test.api.storage.local);
    const job=createRun(examplePackage().snapshot,cfg);await repo.saveJob(job);
    const prepared=await test.handle({type:'analysis:run:prepare',jobId:job.id},trusted) as any;
    expect(prepared.package.provenance).toMatchObject({mode:'standard',qualificationId:record.id});
    expect((await repo.getJob(job.id))?.package).toEqual(prepared.package);
    expect(test.call).not.toHaveBeenCalled();
    expect(await test.handle({type:'analysis:report:qualification',packageId:job.id,packageHash:await hashValue(prepared.package)},trusted)).toMatchObject({state:'qualified_trial',qualificationId:record.id});
  });
  it('keeps unqualified configurations exploratory and cannot upgrade an in-progress run',async()=>{
    const test=setup();await test.handle({type:'analysis:config:save',config,key:'secret'},trusted);
    const repo=new AnalysisRepository(test.api.storage.local);const job=createRun(examplePackage().snapshot,config);await repo.saveJob(job);
    const prepared=await test.handle({type:'analysis:run:prepare',jobId:job.id},trusted) as any;
    expect(prepared.package.provenance).toMatchObject({mode:'exploratory',qualificationId:null});
    job.callsUsed=1;job.state='paused';await repo.saveJob(job);
    expect((await test.handle({type:'analysis:run:prepare',jobId:job.id},trusted) as any).package.provenance.mode).toBe('exploratory');
    expect(test.call).not.toHaveBeenCalled();
  });
  it('stops a qualified run when the backend identity changes and refuses an expired qualification',async()=>{
    const test=setup();const {cfg}=await seedQualification(test);const repo=new AnalysisRepository(test.api.storage.local);
    const job=createRun(examplePackage().snapshot,cfg);await repo.saveJob(job);
    const prepared=await test.handle({type:'analysis:run:prepare',jobId:job.id},trusted) as any;
    prepared.state='running';prepared.callsUsed=1;prepared.inputCharactersUsed=10000;await repo.saveJob(prepared);
    test.call.mockResolvedValueOnce({value:{ok:true},usage:{inputTokens:1,outputTokens:1},providerModel:'different-backend'});
    await expect(test.handle({type:'analysis:call',jobId:job.id,ticket:1,stage:'claims',input:{}},trusted)).rejects.toThrow('qualification_model_changed');
    await test.handle({type:'analysis:config:save',config:{...cfg,declaredVersion:'changed'}},trusted);
    expect(await test.handle({type:'analysis:report:qualification',packageId:job.id,packageHash:await hashValue(prepared.package)},trusted)).toMatchObject({state:'expired'});
    prepared.callsUsed=2;await repo.saveJob(prepared);
    await expect(test.handle({type:'analysis:call',jobId:job.id,ticket:2,stage:'claims',input:{}},trusted)).rejects.toThrow('configuration_changed');
    expect(test.call).toHaveBeenCalledTimes(1);
  });
  it('does not certify imported standard markers or expose another topic from the preview',async()=>{
    const test=setup();const {record}=await seedQualification(test);const repo=new AnalysisRepository(test.api.storage.local);
    const pkg=examplePackage();pkg.provenance.mode='standard';pkg.provenance.qualificationId=record.id;await repo.savePackage(pkg);
    const request={type:'analysis:report:qualification',packageId:pkg.id,packageHash:await hashValue(pkg)};
    expect(await test.handle(request,trusted)).toMatchObject({state:'unverified'});
    expect(await test.handle(request,{id:'ours',url:'chrome-extension://ours/analysis-view.html?topic=121894'})).toMatchObject({state:'unverified'});
    await expect(test.handle(request,{id:'ours',url:'chrome-extension://ours/analysis-view.html?topic=999'})).rejects.toThrow('untrusted_sender');
    await expect(test.handle(request,website)).rejects.toThrow('untrusted_sender');
  });
});

it('does not revive invalidated calibration by giving old batch receipts a fresh qualification ID',async()=>{
  const test=setup();const {cfg,record}=await seedQualification(test);const repo=new AnalysisRepository(test.api.storage.local);
  const job=createRun(examplePackage().snapshot,cfg);await repo.saveJob(job);
  const prepared=await test.handle({type:'analysis:run:prepare',jobId:job.id},trusted) as any;
  prepared.state='running';prepared.callsUsed=1;prepared.inputCharactersUsed=10000;await repo.saveJob(prepared);
  test.call.mockResolvedValueOnce({value:{ok:true},usage:{inputTokens:1,outputTokens:1},providerModel:'other'});
  await expect(test.handle({type:'analysis:call',jobId:job.id,ticket:1,stage:'claims',input:{}},trusted)).rejects.toThrow('qualification_model_changed');
  const replacement={...record,id:crypto.randomUUID(),createdAt:new Date().toISOString()};
  test.localValues['gzk:analysis:calibration:qualifications:v1'].push(replacement.id);
  test.localValues[`gzk:analysis:calibration:qualification:v1:${replacement.id}`]=replacement;
  const batchKey=Object.keys(test.localValues).find(k=>k.startsWith('gzk:analysis:calibration:batch:v1:'))!;
  test.localValues[batchKey].qualificationId=replacement.id;
  expect(await test.handle({type:'analysis:qualification:get',configId:cfg.id},trusted)).toBeNull();
});
it.each(['rating','extraction'] as const)('keeps the %s replay exploratory even for a qualified configuration',async track=>{
  const test=setup();const {cfg}=await seedQualification(test);const repo=new AnalysisRepository(test.api.storage.local);
  const job=await createReplayRun(examplePackage(),cfg,track);await repo.saveJob(job);
  const prepared=await test.handle({type:'analysis:run:prepare',jobId:job.id},trusted) as any;
  expect(prepared.package.provenance.mode).toBe('exploratory');expect(prepared.package.provenance.qualificationId).toBeNull();
});

it('rechecks changed parameters immediately before dispatch after delayed permission preparation',async()=>{
  const test=setup();await test.handle({type:'analysis:config:save',config,key:'secret'},trusted);const repo=new AnalysisRepository(test.api.storage.local);
  const job=createRun(examplePackage().snapshot,config);job.state='running';job.callsUsed=1;job.inputCharactersUsed=10000;await repo.saveJob(job);
  let release!:(value:boolean)=>void;
  test.api.permissions.contains.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  const pending=test.handle({type:'analysis:call',jobId:job.id,ticket:1,stage:'claims',input:{}},trusted);
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  await test.handle({type:'analysis:config:save',config:{...config,maxOutputTokens:128}},trusted);
  release(true);await expect(pending).rejects.toThrow('configuration_changed');expect(test.call).not.toHaveBeenCalled();
});
it('does not dispatch after another in-flight request invalidates the configuration',async()=>{
  const test=setup();const {cfg}=await seedQualification(test);const repo=new AnalysisRepository(test.api.storage.local);
  async function prepare(){const job=createRun(examplePackage().snapshot,cfg);await repo.saveJob(job);const p=await test.handle({type:'analysis:run:prepare',jobId:job.id},trusted) as any;p.state='running';p.callsUsed=1;p.inputCharactersUsed=10000;await repo.saveJob(p);return p;}
  const first=await prepare(),second=await prepare();let release!:(value:boolean)=>void;
  test.api.permissions.contains.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  const pending=test.handle({type:'analysis:call',jobId:first.id,ticket:1,stage:'claims',input:{}},trusted);
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  test.call.mockResolvedValueOnce({value:{ok:true},usage:{inputTokens:1,outputTokens:1},providerModel:'other'});
  await expect(test.handle({type:'analysis:call',jobId:second.id,ticket:1,stage:'claims',input:{}},trusted)).rejects.toThrow('qualification_model_changed');
  expect(await test.handle({type:'analysis:qualification:get',configId:cfg.id},trusted)).toBeNull();
  release(true);await expect(pending).rejects.toThrow('qualification_changed');expect(test.call).toHaveBeenCalledTimes(1);
});
it('also invalidates an existing qualification when an exploratory replay observes backend drift',async()=>{
  const test=setup();const {cfg}=await seedQualification(test);const repo=new AnalysisRepository(test.api.storage.local);
  const job=await createReplayRun(examplePackage(),cfg,'rating');job.state='running';job.callsUsed=1;job.inputCharactersUsed=10000;await repo.saveJob(job);
  test.call.mockResolvedValueOnce({value:{ok:true},usage:{inputTokens:1,outputTokens:1},providerModel:'other'});
  await expect(test.handle({type:'analysis:call',jobId:job.id,ticket:1,stage:'replies',input:{}},trusted)).rejects.toThrow('qualification_model_changed');
  expect(await test.handle({type:'analysis:qualification:get',configId:cfg.id},trusted)).toBeNull();
});

it('persists an explicit default without changing it when another configuration is added or edited',async()=>{
 const {handle}=setup();
 await handle({type:'analysis:config:save',config,key:'test-only'},trusted);
 expect(await handle({type:'analysis:config:get'},trusted)).toMatchObject({defaultConfigId:'m1'});
 const second={...config,id:'m2',name:'Second'};
 await handle({type:'analysis:config:save',config:second,key:'test-only'},trusted);
 expect(await handle({type:'analysis:config:get'},trusted)).toMatchObject({defaultConfigId:'m1'});
 await handle({type:'analysis:config:default',configId:'m2'},trusted);
 await handle({type:'analysis:config:save',config:{...config,name:'Renamed'},key:''},trusted);
 expect(await handle({type:'analysis:config:get'},trusted)).toMatchObject({defaultConfigId:'m2'});
 await expect(handle({type:'analysis:config:default',configId:'missing'},trusted)).rejects.toThrow('missing_configuration');
 await expect(handle({type:'analysis:config:default',configId:'m1'},website)).rejects.toThrow('untrusted_sender');
 await handle({type:'analysis:config:delete',configId:'m2'},trusted);
 expect(await handle({type:'analysis:config:get'},trusted)).toMatchObject({defaultConfigId:'m1'});
});
it('does not silently choose among multiple legacy configurations with no default',async()=>{
 const {handle,localValues}=setup();localValues['gzk:analysis:configs:v1']=[config,{...config,id:'m2'}];
 expect(await handle({type:'analysis:config:get'},trusted)).toMatchObject({defaultConfigId:null});
});
