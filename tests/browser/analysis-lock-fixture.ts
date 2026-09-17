import {AnalysisRepository,type StorageArea} from '../../src/analysis/repository';
import {examplePackage} from '../fixtures/analysis/package';
const result=document.querySelector('pre')!;
async function verify(){
 if(!navigator.locks)throw new Error('window Web Locks unavailable');
 const values:Record<string,unknown>={};
 const area:StorageArea={get:async(key)=>{const value=structuredClone(values[key]);await new Promise(r=>setTimeout(r,15));return {[key]:value};},set:async(items)=>{Object.assign(values,structuredClone(items));},remove:async(key)=>{delete values[key];}};
 const repo=new AnalysisRepository(area);const worker=new Worker(new URL('./analysis-lock-worker.ts',import.meta.url),{type:'module'});
 let sequence=0;let ready!:(value:boolean)=>void;const readiness=new Promise<boolean>(r=>{ready=r;});
 const waiting=new Map<number,{resolve:()=>void;reject:(error:Error)=>void}>();
 worker.onmessage=async({data})=>{
  if(data.kind==='ready'){ready(data.webLocks);return;}
  if(data.kind==='storage'){try{const value=await (area[data.op as keyof StorageArea] as any)(data.arg);worker.postMessage({kind:'storage-result',id:data.id,value});}catch{worker.postMessage({kind:'storage-result',id:data.id,error:'storage_failed'});}return;}
  const item=waiting.get(data.id);waiting.delete(data.id);data.error?item?.reject(new Error(data.error)):item?.resolve();
 };
 const command=(payload:Record<string,unknown>)=>new Promise<void>((resolve,reject)=>{const id=++sequence;waiting.set(id,{resolve,reject});worker.postMessage({kind:'command',id,...payload});});
 const pkg=(id:string)=>({...examplePackage(),id});
 try{
  const workerLocks=await readiness;if(!workerLocks)throw new Error('worker Web Locks unavailable');
  await Promise.all([repo.savePackage(pkg('lock-a')),command({op:'save',pkg:pkg('lock-b')}),repo.savePackage(pkg('lock-c'))]);
  const before=(await repo.list()).map(item=>item.id).sort();if(before.join(',')!=='lock-a,lock-b,lock-c')throw new Error('concurrent record lost');
  await Promise.all([repo.delete('lock-a'),command({op:'save',pkg:pkg('lock-d')})]);
  let staleRejected=false;try{await command({op:'save',pkg:pkg('lock-a')});}catch(error){staleRejected=error instanceof Error&&error.message.startsWith('analysis_deleted');}
  const after=(await repo.list()).map(item=>item.id).sort();
  if(!staleRejected||after.join(',')!=='lock-b,lock-c,lock-d'||Object.hasOwn(values['gzk:analysis:history:v1'] as object,'lock-a'))throw new Error('deletion resurrected content');
  result.textContent=JSON.stringify({status:'PASS',windowWebLocks:true,workerWebLocks:workerLocks,before,after,deletedContentAbsent:true,lateWriteRejected:staleRejected,modelRequests:0,storage:'disposable in-memory fixture'},null,2);
 }finally{worker.terminate();}
}
verify().catch(error=>{result.textContent='FAIL: '+String(error);});
