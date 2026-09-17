import { afterEach, expect, it, vi } from 'vitest';
import { createRun, DEFAULT_BUDGET, executeRun, stageOutput, validateBudget } from '../src/analysis/engine';
import { hashValue, validatePackage } from '../src/analysis/contracts';
import { gatherEvidence } from '../src/analysis/retrieval';
import { examplePackage } from './fixtures/analysis/package';
import type { AnalysisPackage, RunCheckpoint } from '../src/analysis/types';

const config = { id:'model', name:'测试', baseUrl:'https://example.org/v1', model:'test', temperature:0, maxOutputTokens:4096, declaredVersion:'' };
const draft = () => examplePackage().questions.map(({id,claimIds,question,needed,disagreement}) => ({id,claimIds,question,needed,disagreement}));
const planned = () => stageOutput(examplePackage(), 'plan', {questions:draft()});
afterEach(() => vi.useRealTimers());

it('normalizes the cumulative source-byte budget while preserving older four-field caller objects', () => {
  const old = {maxCalls:30,maxInputCharacters:400000,maxSources:12,maxOutputTokens:4096};
  expect(validateBudget(old).maxSourceBytes).toBe(24*1024*1024);
  expect(()=>validateBudget({...old,maxSourceBytes:1023})).toThrow('invalid_budget');
  expect(()=>validateBudget({...old,maxSourceBytes:64*1024*1024+1})).toThrow('invalid_budget');
});

it('freezes exact per-claim qualifiers and a program-owned absolute search policy at plan creation', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-16T01:00:00Z'));
  const pkg = planned(); const plan = (pkg.questions[0] as any).plan;
  expect(plan).toMatchObject({
    policyVersion:'question-search-v1', frozenAt:'2026-09-16T01:00:00.000Z', deadlineAt:'2026-09-16T01:10:00.000Z',
    targets:[{claimId:'C01',qualifiers:pkg.claims[0]!.qualifiers}],
    evidenceTypes:['html','pdf','text'], maxSearches:2,
    stopConditions:['directions_completed','deadline_reached','question_budget_exhausted','run_budget_exhausted','source_limit_reached','cancelled'],
  });
  expect(plan.targets[0].qualifiers.population).toBe('not_stated');
  expect(plan.targets[0].qualifiers.time).toBe('not_stated');
  expect(plan.searches.map((s:any) => s.direction)).toEqual(['support','counter']);
  expect(validatePackage(pkg)).toEqual([]);
});

it('rejects model-authored resource controls instead of accepting or silently repairing them', () => {
  const questions = draft(); (questions[0] as any).plan = {maxSearches:5000,deadlineAt:'2099-01-01T00:00:00Z'};
  expect(() => stageOutput(examplePackage(), 'plan', {questions})).toThrow('stage_schema');
});

it('rejects omitted legacy plan fields and explicitly accepts a reference with no executable plan', () => {
  const pkg = examplePackage(); delete (pkg.questions[0] as any).plan;
  expect(validatePackage(pkg)).toEqual(expect.arrayContaining([expect.objectContaining({code:'plan_missing',path:'package.questions[0].plan'})]));
  (pkg.questions[0] as any).plan = null;
  expect(validatePackage(pkg)).toEqual([]);
});

it('rejects edited target scope, unsupported evidence types and altered program budget or stop policy', () => {
  const baseline = planned();
  expect((baseline.questions[0] as any).plan).toBeDefined();
  for (const edit of [
    (p:any) => {p.targets[0].qualifiers.population='全国配送员';},
    (p:any) => {p.evidenceTypes=['model_memory'];},
    (p:any) => {p.maxSearches=200;},
    (p:any) => {p.deadlineAt='2099-01-01T00:00:00Z';},
    (p:any) => {p.stopConditions=[];},
    (p:any) => {p.targets=[];},
    (p:any) => {p.searches[1].direction='support';},
  ]) {
    const pkg = structuredClone(baseline); edit((pkg.questions[0] as any).plan);
    expect(validatePackage(pkg).length).toBeGreaterThan(0);
  }
});

it('does not search an expired plan and identifies both unfinished question directions', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-16T01:00:00Z'));
  const pkg = planned(); pkg.sources=[];
  vi.setSystemTime(new Date('2026-09-16T01:10:01Z'));
  const search=vi.fn(async(_query:string,_signal?:AbortSignal)=>[]);
  const result=await gatherEvidence(pkg,DEFAULT_BUDGET,undefined,{checkpoint:async()=>{},search:async(_q,run)=>run()},{search,hasPermission:async()=>false,read:vi.fn()});
  expect(search).not.toHaveBeenCalled();
  expect(result.gaps.join(' ')).toMatch(/Q01.*正向.*反向/);
  expect(result.gaps.join(' ')).toContain('截止时间');
});

it('leaves an explicit gap when the reference has no executable plan', async () => {
  const pkg=examplePackage(); pkg.sources=[]; (pkg.questions[0] as any).plan=null;
  const search=vi.fn(async(_query:string,_signal?:AbortSignal)=>[]);
  const result=await gatherEvidence(pkg,DEFAULT_BUDGET,undefined,{checkpoint:async()=>{},search:async(_q,run)=>run()},{search,hasPermission:async()=>false,read:vi.fn()});
  expect(search).not.toHaveBeenCalled();
  expect(result.gaps.join(' ')).toMatch(/Q01.*核查计划/);
});

async function evidenceRun(): Promise<RunCheckpoint> {
  const pkg=planned(); pkg.sources=[]; pkg.relations=[]; pkg.evaluations=[]; pkg.status='partial';
  const job=createRun(pkg.snapshot,config); job.package=pkg; job.completedStages=['claims','plan'];
  job.package.provenance.stageHashes.claims=await hashValue({claims:pkg.claims,coverage:pkg.coverage});
  job.package.provenance.stageHashes.plan=await hashValue(pkg.questions);
  return job;
}

it('persists failed per-question searches before calling and never resets their cap on resume', async () => {
  const job=await evidenceRun(); const saved:RunCheckpoint[]=[];
  const search=vi.fn(async()=>{throw new Error('network');});
  const deps={save:async (j:RunCheckpoint)=>{saved.push(structuredClone(j));},call:vi.fn(),acquireEvidence:async (pkg:AnalysisPackage,budget:any,signal:any,controls:any)=>(await gatherEvidence(pkg,budget,signal,controls,{search,hasPermission:async()=>false,read:vi.fn()})).sources};
  const first=await executeRun(job,deps);
  expect(first.state).toBe('partial'); expect(search).toHaveBeenCalledTimes(1);
  expect((saved.find(j=>j.callsUsed===1) as any)?.searchAttempts).toHaveLength(1);
  const second=await executeRun(first,deps);
  expect(search).toHaveBeenCalledTimes(2);
  const third=await executeRun(second,deps);
  expect(search).toHaveBeenCalledTimes(2);
  expect((third as any).searchAttempts).toHaveLength(2);
  expect(third.package.questions).toEqual(job.package.questions);
  expect(third.package.unresolved.join(' ')).toMatch(/Q01.*正向.*反向/);
  expect(third.package.unresolved.join(' ')).toContain('单问题预算');
});

it('resume after the absolute deadline sends no new request and retains completed cached direction', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-16T01:00:00Z'));
  const job=await evidenceRun();
  const search=vi.fn(async(_query:string,_signal?:AbortSignal)=>[]);
  let pause=true;
  const deps={save:async()=>{},call:vi.fn(),acquireEvidence:async(pkg:AnalysisPackage,budget:any,signal:any,controls:any)=>{
    const result=await gatherEvidence(pkg,budget,signal,controls,{search:async(query,searchSignal)=>{
      if(search.mock.calls.length===1 && pause) throw new Error('network');
      return search(query,searchSignal);
    },hasPermission:async()=>false,read:vi.fn()});return result.sources;
  }};
  const partial=await executeRun(job,deps); const spent=partial.callsUsed;
  expect(search).toHaveBeenCalledTimes(1);
  pause=false; vi.setSystemTime(new Date('2026-09-16T01:10:01Z'));
  const resumed=await executeRun(partial,deps);
  expect(search).toHaveBeenCalledTimes(1); expect(resumed.callsUsed).toBeGreaterThanOrEqual(spent);
  const deadlineGaps=resumed.package.unresolved.filter(g=>g.includes('截止时间'));
  expect(deadlineGaps.join(' ')).toContain('Q01 反向');
  expect(deadlineGaps.join(' ')).not.toContain('Q01 正向');
});

it('stops waiting at the in-flight deadline even when a search adapter does not settle after abort', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-16T01:00:00Z'));
  const job=await evidenceRun(); let searchSignal:AbortSignal|undefined;
  let onStart!:()=>void; const started=new Promise<void>(resolve=>{onStart=resolve;});
  const search=vi.fn((_query:string,signal?:AbortSignal)=>{searchSignal=signal;onStart();return new Promise<[]>(()=>{});});
  const deps={save:async()=>{},call:vi.fn(async(stage:string)=>({value:stage==='relations'?{relations:[],data:[]}:{evaluations:examplePackage().evaluations},usage:{inputTokens:0,outputTokens:0},providerModel:'test'})),
    acquireEvidence:async(pkg:AnalysisPackage,budget:any,signal:any,controls:any)=>(await gatherEvidence(pkg,budget,signal,controls,{search,hasPermission:async()=>false,read:vi.fn()})).sources};
  let result:RunCheckpoint|undefined;
  void executeRun(job,deps).then(done=>{result=done;});
  await started;
  expect(search).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10*60*1000+1);
  expect(searchSignal?.aborted).toBe(true);
  await vi.waitFor(()=>expect(result?.state).toBe('completed'),{timeout:100});
  expect(result?.searchAttempts[0]?.status).toBe('failed');
  expect(result?.package.unresolved.join(' ')).toMatch(/截止时间.*Q01 正向.*Q01 反向/);
});

it('identifies each question direction when a zero-source run skips external retrieval entirely', async () => {
  const job=await evidenceRun(); job.budget.maxSources=0;
  const acquireEvidence=vi.fn();
  const result=await executeRun(job,{save:async()=>{},acquireEvidence,call:vi.fn(async(stage:string)=>({value:stage==='relations'?{relations:[],data:[]}:{evaluations:examplePackage().evaluations},usage:{inputTokens:0,outputTokens:0},providerModel:'test'}))});
  expect(acquireEvidence).not.toHaveBeenCalled();
  expect(result.package.unresolved.join(' ')).toMatch(/来源上限.*Q01 正向.*Q01 反向/);
});

it('does not dispatch a search when the user cancels while its reserved budget is being saved', async () => {
  const job=await evidenceRun(); const controller=new AbortController(); const search=vi.fn(async()=>[]);
  const result=await executeRun(job,{save:async saved=>{if(saved.callsUsed===1)controller.abort();},call:vi.fn(),
    acquireEvidence:async(pkg,budget,signal,controls)=>(await gatherEvidence(pkg,budget,signal,controls,{search,hasPermission:async()=>false,read:vi.fn()})).sources},controller.signal);
  expect(result.state).toBe('cancelled');
  expect(search).not.toHaveBeenCalled();
});

it('does not dispatch after saving the reserved budget crosses the absolute deadline', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-16T01:00:00Z'));
  const job=await evidenceRun(); job.budget.maxCalls=1;
  const frozenDeadline=job.package.questions[0]!.plan!.deadlineAt;
  const saved:RunCheckpoint[]=[]; const search=vi.fn(async()=>[]);
  const result=await executeRun(job,{
    save:async checkpoint=>{
      saved.push(structuredClone(checkpoint));
      if(checkpoint.searchAttempts[0]?.status==='started') vi.setSystemTime(new Date('2026-09-16T01:10:01Z'));
    },
    call:vi.fn(),
    acquireEvidence:async(pkg,budget,signal,controls)=>(await gatherEvidence(pkg,budget,signal,controls,{search,hasPermission:async()=>false,read:vi.fn()})).sources,
  });
  expect(search).not.toHaveBeenCalled();
  expect(result.callsUsed).toBe(1);
  expect(result.searchAttempts).toHaveLength(1);
  expect(result.searchAttempts[0]).toMatchObject({questionId:'Q01',direction:'support',status:'failed'});
  expect(saved.some(checkpoint=>checkpoint.searchAttempts[0]?.status==='failed')).toBe(true);
  expect(result.package.questions[0]!.plan!.deadlineAt).toBe(frozenDeadline);
  expect(result.package.unresolved.join(' ')).toMatch(/截止时间.*Q01 正向.*Q01 反向/);
});
