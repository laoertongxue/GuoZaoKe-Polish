import { describe, expect, it, vi } from 'vitest';
import { createRun, executeRun, stageOutput, participantSummary } from '../src/analysis/engine';
import { examplePackage, questionDrafts } from './fixtures/analysis/package';
import { splitSpans } from '../src/analysis/snapshot';
import type { RunCheckpoint } from '../src/analysis/types';

const config = { id: 'm1', name: '模型', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', temperature: 0, maxOutputTokens: 4096, declaredVersion: '' };
const extracted = () => {
  const pkg = examplePackage();
  return { claims: pkg.claims, coverage: pkg.snapshot.messages.flatMap(m => splitSpans(m).map(span => ({ span, claimIds: m.kind === 'reply' ? ['C01'] : [], disposition: m.kind === 'reply' ? 'claim' : 'non_assertive', reason: m.kind === 'reply' ? '提出费用事实' : '提问' }))) };
};
function dependencies() {
  const records: RunCheckpoint[] = [];
  return {
    records,
    save: vi.fn(async (job: RunCheckpoint) => { records.push(structuredClone(job)); }),
    call: vi.fn(async (stage: string) => ({ value: stage === 'claims' ? extracted() : stage === 'plan' ? { questions: questionDrafts() } : stage === 'relations' ? { relations: examplePackage().relations, data: [] } : { evaluations: examplePackage().evaluations }, usage: { inputTokens: 100, outputTokens: 30 }, providerModel: 'declared-alias' })),
    acquireEvidence: vi.fn(async () => examplePackage().sources),
  };
}
describe('staged resumable analysis', () => {
  it('freezes snapshot, validates each stage and saves before spending calls', async () => {
    const source = examplePackage().snapshot;
    const job = createRun(source, config); source.title = 'mutated outside';
    const deps = dependencies(); const done = await executeRun(job, deps);
    expect(done.state).toBe('completed');
    expect(done.package.snapshot.title).toBe('测试讨论');
    expect(done.completedStages).toEqual(['claims', 'plan', 'evidence', 'relations', 'replies', 'report']);
    expect(done.package.evaluations[0]?.dimensions.E.grade).toBe(0);
    expect(done.requests).toHaveLength(4);
    expect(done.callsUsed).toBe(4);
    expect(done.inputTokens).toBe(400);
    expect(deps.save.mock.invocationCallOrder[1]).toBeLessThan(deps.call.mock.invocationCallOrder[0]!);
  });
  it('rejects silent extraction omissions and invented claim ownership before freezing', () => {
    const job = createRun(examplePackage().snapshot, config);
    const value = extracted(); value.coverage.pop();
    expect(() => stageOutput(job.package, 'claims', value, job.package.snapshot.messages)).toThrow('coverage');
    const other = extracted(); other.claims[0]!.authorId = 'P01';
    expect(() => stageOutput(job.package, 'claims', other, job.package.snapshot.messages)).toThrow('ownership');
  });
  it('pauses on budget exhaustion and resumes without repeating completed calls', async () => {
    const job = createRun(examplePackage().snapshot, config, { maxCalls: 1, maxInputCharacters: 100000, maxSources: 10, maxOutputTokens: 4096 });
    const deps = dependencies(); const paused = await executeRun(job, deps);
    expect(paused.state).toBe('paused'); expect(paused.completedStages).toEqual(['claims']);
    paused.budget.maxCalls = 5;
    const done = await executeRun(paused, deps);
    expect(done.state).toBe('completed');
    expect(deps.call.mock.calls.filter(c => c[0] === 'claims')).toHaveLength(1);
  });
  it('records partial failure and counts failed calls towards retries', async () => {
    const job = createRun(examplePackage().snapshot, config); const deps = dependencies();
    deps.call.mockRejectedValueOnce(new Error('server included secret'));
    const failed = await executeRun(job, deps);
    expect(failed.state).toBe('partial'); expect(failed.callsUsed).toBe(1);
    expect(JSON.stringify(failed)).not.toContain('secret');
    const done = await executeRun(failed, deps);
    expect(done.state).toBe('completed'); expect(done.callsUsed).toBe(5);
  });
  it('does not call a provider after cancellation or persistence failure', async () => {
    const deps = dependencies(); const job = createRun(examplePackage().snapshot, config);
    const controller = new AbortController(); controller.abort();
    expect((await executeRun(job, deps, controller.signal)).state).toBe('cancelled');
    expect(deps.call).not.toHaveBeenCalled();
    deps.save.mockRejectedValueOnce(new Error('storage_write'));
    await expect(executeRun(job, deps)).rejects.toThrow('storage_write');
    expect(deps.call).not.toHaveBeenCalled();
  });
  it('does not grant author credit for sources discovered later; summaries use separate denominators', async () => {
    const job = createRun(examplePackage().snapshot, config); const deps = dependencies();
    const done = await executeRun(job, deps); const summary = participantSummary(done.package);
    expect(summary.find(p => p.authorId === 'P02')).toMatchObject({ replies: 1, evaluationUnits: 1, introducedSources: 0, dimensions: { E: { applicable: 1, graded: 1, unknown: 0, notApplicable: 0, pending: 0 } } });
    expect(JSON.stringify(summary)).not.toMatch(/overall|rank|score|personality/);
  });
  it('refuses changed frozen claims and preserves unknown usage across later requests', async () => {
    const deps = dependencies(); const job = createRun(examplePackage().snapshot, config, { maxCalls: 1, maxInputCharacters: 100000, maxSources: 10, maxOutputTokens: 4096 });
    const paused = await executeRun(job, deps); paused.budget.maxCalls = 5;
    paused.package.claims[0]!.text = 'changed after freeze';
    await expect(executeRun(paused, deps)).rejects.toThrow('frozen_input_changed');
    const unknown = dependencies(); unknown.call.mockResolvedValueOnce({ value: extracted(), usage: { inputTokens: null, outputTokens: null }, providerModel: 'alias' } as any);
    const done = await executeRun(createRun(examplePackage().snapshot, config), unknown);
    expect(done.state).toBe('completed'); expect(done.inputTokens).toBeNull(); expect(done.outputTokens).toBeNull();
  });
});

it('detects tampering in a successful batch even when its stage never completed', async () => {
  const pkg = examplePackage();const topic=pkg.snapshot.messages[0]!;
  pkg.snapshot.messages=[topic,...Array.from({length:7},(_,i)=>({...pkg.snapshot.messages[1]!,id:`reply-${i+10}`,floor:i+1,text:`问候${i}。`}))];
  pkg.snapshot.expectedReplies=7;pkg.snapshot.pages[0]!.messageIds=pkg.snapshot.messages.map(m=>m.id);
  const deps={save:vi.fn(async()=>{}),call:vi.fn(async (_stage:string,input:any)=>({value:{claims:[],coverage:input.messages.flatMap((m:any)=>splitSpans(m).map(span=>({span,claimIds:[],disposition:'non_assertive',reason:'社交'})))},usage:{inputTokens:1,outputTokens:1},providerModel:'alias'}))};
  const success=deps.call.getMockImplementation()!;let calls=0;
  deps.call.mockImplementation(async(stage,input)=>{if(++calls===2)throw new Error('network');return success(stage,input);});
  const partial=await executeRun(createRun(pkg.snapshot,config),deps);
  expect(partial.completedStages).toEqual([]);expect(partial.requests).toHaveLength(1);
  partial.package.coverage[0]!.reason='modified saved batch';
  await expect(executeRun(partial,deps)).rejects.toThrow('frozen_input_changed');
});
