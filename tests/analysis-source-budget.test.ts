import {expect,it,vi} from 'vitest';
import {SourceBudgetError,SourceReadBudget,sourceBudgetKey} from '../src/analysis/source-budget';
import {fetchEvidenceBytes,readEvidence} from '../src/analysis/evidence';
import {createAnalysisHandler} from '../src/analysis/background';
import {createRun} from '../src/analysis/engine';
import {AnalysisRepository} from '../src/analysis/repository';
import {examplePackage} from './fixtures/analysis/package';
const memory=()=>{const values:Record<string,unknown>={};return {values,area:{get:async(key:string)=>({[key]:structuredClone(values[key])}),set:async(next:Record<string,unknown>)=>{Object.assign(values,structuredClone(next));},remove:async(key:string)=>{delete values[key];}}};};
it('reserves before reading, refunds only confirmed unused bytes and cannot refund twice',async()=>{
  const {area}=memory();const budget=new SourceReadBudget(area);
  const first=await budget.reserve('job',2048,3);expect(first.maxBytes).toBe(2048);
  await budget.complete(first,1024);
  const second=await budget.reserve('job',2048,3);expect(second.maxBytes).toBe(1024);
  await expect(budget.reserve('job',2048,3)).rejects.toThrow('source_budget_exhausted');
  await expect(budget.complete(first,0)).rejects.toThrow('source_budget_corrupt');
});
it('keeps failed or interrupted reservations charged across restart and enforces concurrent allocation',async()=>{
  const {area}=memory();const budget=new SourceReadBudget(area);
  const reservations=await Promise.allSettled([budget.reserve('job',1024,3),budget.reserve('job',1024,3)]);
  expect(reservations.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  await expect(new SourceReadBudget(area).reserve('job',1024,3)).rejects.toThrow('source_budget_exhausted');
  await expect(budget.reserve('job',2048,3)).rejects.toThrow('source_budget_changed');
});
it('counts empty/failed attempts so retries cannot avoid a frozen attempt limit',async()=>{
  const {area}=memory();const budget=new SourceReadBudget(area);
  const first=await budget.reserve('job',1024,1);await budget.complete(first,0);
  await expect(budget.reserve('job',1024,1)).rejects.toThrow('source_budget_exhausted');
});
it('rejects corrupted ledgers instead of resetting their allowance',async()=>{
  const {area,values}=memory();const budget=new SourceReadBudget(area);await budget.reserve('job',1024,1);
  const key=Object.keys(values)[0]!;values[key]={};
  await expect(budget.reserve('job',1024,1)).rejects.toThrow('source_budget_corrupt');
});
it('applies the remaining allowance to both announced and streamed source bodies',async()=>{
  const cancelled=vi.fn();
  const response=()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(1025));},cancel:cancelled}),{headers:{'content-type':'application/pdf'}});
  await expect(fetchEvidenceBytes('https://example.org/report',{maxBytes:1024,fetch:vi.fn(async()=>response())})).rejects.toMatchObject({code:'too_large'});
  expect(cancelled).toHaveBeenCalled();
  await expect(fetchEvidenceBytes('https://example.org/report',{maxBytes:1024,fetch:vi.fn(async()=>new Response('',{headers:{'content-type':'text/html','content-length':'2048'}}))})).rejects.toMatchObject({code:'too_large'});
});
it('shows a read-budget gap without presenting an unavailable source as no evidence',async()=>{
  const source=await readEvidence('https://example.org/report',{fetch:vi.fn(async()=>{throw new SourceBudgetError('source_budget_exhausted');})});
  expect(source.status).toBe('unreadable');expect(source.text).toBe('');expect(source.limitations.join('')).toContain('累计读取预算');expect(source.limitations.join('')).toContain('不能据此认定没有证据');
});
it('bounds actual source transport by the remaining job allowance and preserves the budget on failure',async()=>{
  const {area}=memory();const config={id:'m1',name:'AI',baseUrl:'https://api.example.org/v1',model:'example',temperature:0,maxOutputTokens:4096,declaredVersion:''};
  const job=createRun(examplePackage().snapshot,config,{maxCalls:30,maxInputCharacters:400000,maxSources:12,maxOutputTokens:4096,maxSourceBytes:2048});job.state='running';job.stage='evidence';await new AnalysisRepository(area).saveJob(job);
  const readSource=vi.fn(async(url:string,_signal:AbortSignal,maxBytes?:number)=>{expect(maxBytes).toBe(2048);throw new Error('private response');});
  const api={runtime:{id:'ours',getURL:(path:string)=>`chrome-extension://ours${path}`},storage:{local:area,session:area},permissions:{contains:async()=>true},tabs:{create:async()=>({})}};
  const handle=createAnalysisHandler(api,{readSource});const sender={id:'ours',url:'chrome-extension://ours/analysis.html'};
  const message={type:'analysis:source:bytes',scope:'job',url:'https://example.org/report',requestId:job.id};
  await expect(handle(message,sender)).rejects.toThrow('source_unavailable');
  await expect(createAnalysisHandler(api,{readSource})(message,sender)).rejects.toThrow('source_budget_exhausted');
  expect(readSource).toHaveBeenCalledTimes(1);
});
it('preserves the budget-error category if the read ledger disappears during transport',async()=>{
  const {area}=memory();const config={id:'m1',name:'AI',baseUrl:'https://api.example.org/v1',model:'example',temperature:0,maxOutputTokens:4096,declaredVersion:''};
  const job=createRun(examplePackage().snapshot,config);job.state='running';job.stage='evidence';await new AnalysisRepository(area).saveJob(job);
  const readSource=vi.fn(async(url:string)=>{await area.remove(sourceBudgetKey(job.id));return {url,bytes:new Uint8Array(2),contentType:'text/plain'};});
  const api={runtime:{id:'ours',getURL:(path:string)=>`chrome-extension://ours${path}`},storage:{local:area,session:area},permissions:{contains:async()=>true},tabs:{create:async()=>({})}};
  const message={type:'analysis:source:bytes',scope:'job',url:'https://example.org/report',requestId:job.id};const sender={id:'ours',url:'chrome-extension://ours/analysis.html'};
  await expect(createAnalysisHandler(api,{readSource})(message,sender)).rejects.toThrow('source_budget_corrupt');
  // A new worker must not recreate a missing ledger and award the same job a new allowance.
  await expect(createAnalysisHandler(api,{readSource})(message,sender)).rejects.toThrow('source_budget_corrupt');
  expect(readSource).toHaveBeenCalledTimes(1);
});

it('never downgrades an automatic source read to manual when the job is deleted during permission lookup',async()=>{
  const {area}=memory();const repo=new AnalysisRepository(area);
  const job=createRun(examplePackage().snapshot,{id:'m1',name:'AI',baseUrl:'https://api.example.org/v1',model:'example',temperature:0,maxOutputTokens:4096,declaredVersion:''},{maxCalls:30,maxInputCharacters:400000,maxSources:12,maxOutputTokens:4096,maxSourceBytes:1024});job.state='running';job.stage='evidence';await repo.saveJob(job);
  const readSource=vi.fn(async(url:string)=>({url,bytes:new Uint8Array(1025),contentType:'text/plain'}));
  const api={runtime:{id:'ours',getURL:(path:string)=>`chrome-extension://ours${path}`},storage:{local:area,session:area},permissions:{contains:async()=>{await repo.delete(job.id);return true;}},tabs:{create:async()=>({})}};
  await expect(createAnalysisHandler(api,{readSource})({type:'analysis:source:bytes',scope:'job',url:'https://example.org/report',requestId:job.id},{id:'ours',url:'chrome-extension://ours/analysis.html'})).rejects.toThrow('invalid_reservation');
  expect(readSource).not.toHaveBeenCalled();
});
it('requires an explicit source scope and still allows deliberate manual URL reads',async()=>{
  const {area}=memory();const readSource=vi.fn(async(url:string,_signal:AbortSignal,maxBytes?:number)=>{expect(maxBytes).toBe(8*1024*1024);return {url,bytes:new Uint8Array(1),contentType:'text/plain'};});
  const api={runtime:{id:'ours',getURL:(path:string)=>`chrome-extension://ours${path}`},storage:{local:area,session:area},permissions:{contains:async()=>true},tabs:{create:async()=>({})}};
  const handle=createAnalysisHandler(api,{readSource});const message={type:'analysis:source:bytes',url:'https://example.org/report',requestId:'manual-request'};const sender={id:'ours',url:'chrome-extension://ours/analysis.html'};
  await expect(handle(message,sender)).rejects.toThrow('invalid_request');
  expect(readSource).not.toHaveBeenCalled();
  expect(await handle({...message,scope:'manual'},sender)).toMatchObject({base64:'AA=='});
});
