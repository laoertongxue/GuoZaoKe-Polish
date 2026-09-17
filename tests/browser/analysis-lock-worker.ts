import {AnalysisRepository,type StorageArea} from '../../src/analysis/repository';
const scope=globalThis as any;
let sequence=0;const waiting=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
const storage=(op:string,arg:unknown)=>new Promise<any>((resolve,reject)=>{const id=++sequence;waiting.set(id,{resolve,reject});scope.postMessage({kind:'storage',id,op,arg});});
const area:StorageArea={get:key=>storage('get',key),set:items=>storage('set',items),remove:key=>storage('remove',key)};
const repo=new AnalysisRepository(area);
scope.onmessage=async({data}:MessageEvent)=>{
 if(data.kind==='storage-result'){const item=waiting.get(data.id);waiting.delete(data.id);data.error?item?.reject(new Error(data.error)):item?.resolve(data.value);return;}
 if(data.kind!=='command')return;
 try{if(data.op==='save')await repo.savePackage(data.pkg);else if(data.op==='delete')await repo.delete(data.recordId);scope.postMessage({kind:'result',id:data.id});}
 catch(error){scope.postMessage({kind:'result',id:data.id,error:error instanceof Error?error.message:'failed'});}
};
scope.postMessage({kind:'ready',webLocks:!!navigator.locks});
