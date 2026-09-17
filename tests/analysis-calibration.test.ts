import { describe, expect, it, vi } from 'vitest';
import { CalibrationService } from '../src/analysis/calibration';
import { calibrationInputHash, configurationFingerprint, DEFAULT_CALIBRATION_THRESHOLDS, freezeCalibrationSuite } from '../src/analysis/comparison';
import { hashValue } from '../src/analysis/contracts';
import { splitSpans } from '../src/analysis/snapshot';
import { AnalysisRepository, type StorageArea } from '../src/analysis/repository';
import { ProviderError, type ChatMessage, type ChatResult, type ModelConfig } from '../src/analysis/providers';
import { examplePackage, questionDrafts } from './fixtures/analysis/package';

const config = { id: 'm1', name: '模型', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', temperature: 0, maxOutputTokens: 4096, declaredVersion: 'version-1' };
function area(seed: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = structuredClone(seed);
  return { data, get: vi.fn(async (key: string) => ({ [key]: structuredClone(data[key]) })), set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(data, structuredClone(items)); }), remove: vi.fn(async (key: string) => { delete data[key]; }) } satisfies StorageArea & { data: Record<string, unknown> };
}
async function suite(first: 'extraction' | 'rating' = 'extraction') {
  const cases = ['extraction', 'rating'].map((track, index) => {
    const reference = examplePackage(); reference.snapshot.messages[0]!.text = `第 ${index + 1} 组平均费用是多少？`;
    reference.claims[0]!.text = 'REFERENCE_CLAIM_ANSWER'; reference.evaluations[0]!.task = 'REFERENCE_RATING_ANSWER';
    for (const dim of ['R', 'E', 'L', 'B'] as const) reference.evaluations[0]!.dimensions[dim] = { applicability: 'yes', grade: dim === 'E' ? 0 : 2, reason: '参考规则判断', ruleIds: [dim], refs: structuredClone(reference.claims[0]!.spans) };
    return { id: track, track: track as 'extraction' | 'rating', stratum: track, reference };
  });
  cases.sort((a, b) => a.track === first ? -1 : b.track === first ? 1 : 0);
  return freezeCalibrationSuite({ id: 'mock-only-suite', methodVersion: '0.2.1', referenceLabel: '模拟执行测试，不构成真实模型校准', developmentInputHashes: [], thresholds: { ...DEFAULT_CALIBRATION_THRESHOLDS, repetitions: 2, minCases: 2, minCasesPerTrack: 1, minDeterminatePerDimension: 1 }, cases });
}
function model() {
  return vi.fn(async (_config: ModelConfig, messages: ChatMessage[], _signal?: AbortSignal, _limit?: number): Promise<ChatResult> => {
    const payload = JSON.parse(messages[1]!.content) as Record<string, any>; let value: unknown;
    if ('spans' in payload) {
      const claim = examplePackage().claims[0]!;
      value = { claims: [claim], coverage: payload.messages.flatMap((message: any) => splitSpans(message).map(span => ({ span, claimIds: message.kind === 'reply' ? [claim.id] : [], disposition: message.kind === 'reply' ? 'claim' : 'non_assertive', reason: '完整覆盖原文' }))) };
    } else if ('units' in payload) {
      const evaluation = examplePackage().evaluations[0]!;
      for (const dim of ['R', 'E', 'L', 'B'] as const) evaluation.dimensions[dim] = { applicability: 'yes', grade: dim === 'E' ? 0 : 2, reason: '执行规则判断', ruleIds: [dim], refs: structuredClone(examplePackage().claims[0]!.spans) };
      value = { evaluations: [evaluation] };
    } else if ('sources' in payload) value = { relations: examplePackage().relations, data: [] };
    else value = { questions: questionDrafts() };
    return { value, usage: { inputTokens: 10, outputTokens: 5 }, providerModel: 'mock-fixed-backend' };
  });
}
function setup(invoke = model(), seed: Record<string, unknown> = {}) {
  const local = area(seed); const repo = new AnalysisRepository(local);
  return { local, repo, invoke, service: new CalibrationService({ local, repo, invoke }) };
}

describe('trusted calibration batches (mock transport only)', () => {
  it('freezes complete case×repeat slots and one persisted call budget for the entire batch', async () => {
    const s = await suite(); const context = setup(); const batch = await context.service.createBatch(s, config, 2);
    expect(batch.slots.map(slot => [slot.caseId, slot.repetition])).toEqual([['extraction', 1], ['extraction', 2], ['rating', 1], ['rating', 2]]);
    expect(JSON.stringify(batch)).not.toContain('REFERENCE_CLAIM_ANSWER');
    const first = await context.service.stepBatch(s, batch.id);
    expect(first.batch.callsUsed).toBe(2); expect(first.batch.state).toBe('paused'); expect(first.batch.slots[0]!.state).toBe('paused');
    expect(first.execution?.receipt).toMatchObject({ status: 'failed', errorCode: 'budget_exhausted', output: null });
    const second = await context.service.stepBatch(s, batch.id); expect(second.execution).toBeNull(); expect(context.invoke).toHaveBeenCalledTimes(2);
    expect((await context.service.assessBatch(s, batch.id)).status).toBe('not_qualified');
  });
  it('executes fixed rating inputs, persists possibly-sent reservations, and hashes actual responses', async () => {
    const s = await suite('rating'); const context = setup(); const batch = await context.service.createBatch(s, config, 30);
    context.invoke.mockImplementationOnce(async (frozen, messages, signal, limit) => {
      const live = (await context.service.readBatch(batch.id))!; expect(live.callsUsed).toBe(1); expect(live.state).toBe('running');
      const receipt = (await context.service.readReceipt(live.slots[0]!.receiptId!))!;
      expect(receipt.usage).toEqual({ calls: 1, inputTokens: null, outputTokens: null }); expect(JSON.stringify(context.local.data)).toContain('possibly_sent');
      expect(frozen).toEqual(config); expect(limit).toBe(config.maxOutputTokens); expect(JSON.stringify(messages)).not.toContain('REFERENCE_RATING_ANSWER');
      return model()(frozen, messages, signal, limit);
    });
    const result = (await context.service.stepBatch(s, batch.id)).execution!;
    expect(result.state).toBe('completed'); expect(result.receipt.configurationHash).toBe(await configurationFingerprint(config));
    expect(result.receipt.inputHash).toBe(await calibrationInputHash(s.cases[0]!.reference, 'rating')); expect(result.receipt.outputHash).toBe(await hashValue(result.receipt.output));
    expect(result.receipt.requestIds).toHaveLength(1); expect(result.receipt.requestIds[0]).not.toBe('replies:0');
    expect(result.requests[0]).toMatchObject({ stage: 'replies', status: 'received', invoked: true, inputHash: await hashValue(context.invoke.mock.calls[0]![1]) });
    expect(result.receipt.usage).toEqual({ calls: 1, inputTokens: 10, outputTokens: 5 });
    const second = await context.service.stepBatch(s, batch.id); expect(second.execution!.receipt.requestIds[0]).not.toBe(result.receipt.requestIds[0]);
  });
  it('keeps extraction answers and derived reference data out of model inputs', async () => {
    const s = await suite(); const context = setup(); const batch = await context.service.createBatch(s, config, 30); const result = (await context.service.stepBatch(s, batch.id)).execution!;
    expect(result.state).toBe('completed'); expect(context.invoke).toHaveBeenCalledTimes(4);
    const sent = context.invoke.mock.calls.map(args => JSON.parse(args[1][1]!.content));
    expect(JSON.stringify(sent)).not.toContain('REFERENCE_CLAIM_ANSWER'); expect(JSON.stringify(sent)).not.toContain('REFERENCE_RATING_ANSWER');
    expect(sent[0]).not.toHaveProperty('claims'); expect(sent[0]).not.toHaveProperty('sources'); expect(sent.find(p => 'sources' in p).sources[0].data).toEqual([]);
  });
  it('cannot cherry-pick IDs or rerun failed slots; a new trial is an explicit complete batch', async () => {
    const s = await suite(); const context = setup(); const first = await context.service.createBatch(s, config, 30);
    context.invoke.mockRejectedValueOnce(new Error('REMOTE_SECRET_BODY')); const failure = await context.service.stepBatch(s, first.id);
    expect(failure.batch.slots[0]!.state).toBe('failed'); expect(failure.execution!.receipt.usage).toEqual({ calls: 1, inputTokens: null, outputTokens: null });
    expect(failure.execution!.requests[0]?.errorCode).toBe('execution_failed');
    const next = await context.service.stepBatch(s, first.id); expect(next.execution!.receipt.repetition).toBe(2);
    for (let i = 0; i < 2; i++) await context.service.stepBatch(s, first.id);
    expect((await context.service.stepBatch(s, first.id)).execution).toBeNull();
    const assessment = await context.service.assessBatch(s, first.id); expect(assessment.status).toBe('not_qualified'); expect(assessment.receiptIds).toContain(failure.execution!.receipt.id);
    expect((context.service as any).assess).toBeUndefined(); expect((context.service as any).runCase).toBeUndefined();
    const fresh = await context.service.createBatch(s, config, 30); expect(fresh.id).not.toBe(first.id); expect(fresh.slots.every(slot => slot.state === 'pending')).toBe(true);
    for (let i = 0; i < 4; i++) await context.service.stepBatch(s, fresh.id);
    const clean = await context.service.assessBatch(s, fresh.id); expect(clean.status).toBe('qualified_trial'); expect(clean.acceptedRuns).toBe(4);
    expect(clean.receiptIds).not.toContain(failure.execution!.receipt.id); expect((await context.service.readQualification(assessment.id))?.status).toBe('not_qualified');
    expect(JSON.stringify(context.local.data)).not.toContain('REMOTE_SECRET_BODY');
  });
  it('only qualifies the stored whole batch and preserves results across service restarts', async () => {
    const s = await suite(); const context = setup(); const batch = await context.service.createBatch(s, config, 30);
    const report = examplePackage(); report.provenance.mode = 'standard'; report.provenance.qualificationId = 'forged'; await context.repo.savePackage(report); expect(await context.service.readReceipt('forged')).toBeNull();
    const partial = await context.service.assessBatch(s, batch.id); expect(partial.status).toBe('not_qualified'); expect(partial.reasons).toContain('batch_incomplete');
    for (let i = 0; i < 4; i++) await context.service.stepBatch(s, batch.id);
    const assessment = await context.service.assessBatch(s, batch.id); expect(assessment.status).toBe('qualified_trial'); expect(assessment.referenceLabel).toContain('不构成真实模型校准');
    const other = new CalibrationService({ local: context.local, repo: context.repo, invoke: context.invoke });
    expect(await other.readQualification(assessment.id)).toEqual(assessment); expect((await other.readBatch(batch.id))?.qualificationId).toBe(assessment.id);
    expect(await other.listBatches(s.hash, { ...config, model: 'other' })).toEqual([]); expect((await other.listBatches(s.hash, config)).map(item => item.id)).toEqual([batch.id]);
  });
  it('rejects changed suites and invalid budgets before spending', async () => {
    const s = await suite(); const context = setup(); await expect(context.service.createBatch({ ...s, hash: 'tampered' }, config, 30)).rejects.toThrow('invalid_suite');
    for (const cap of [0, 501, 1.2, NaN]) await expect(context.service.createBatch(s, config, cap)).rejects.toThrow('invalid_budget');
    expect(Object.keys(context.local.data)).toHaveLength(0); const batch = await context.service.createBatch(s, config, 30);
    await expect(context.service.stepBatch(await suite('rating'), batch.id)).rejects.toThrow('batch_mismatch'); expect(context.invoke).not.toHaveBeenCalled();
  });
  it('passes each full frozen config, ignoring caller and dependency mutations', async () => {
    const s = await suite(); const context = setup(); const mutable = { ...config, apiKey: 'NEVER_STORE_KEY' };
    const creating = context.service.createBatch(s, mutable, 30); mutable.baseUrl = 'https://changed.example/v1'; mutable.model = 'changed'; const batch = await creating; batch.configuration.model = 'changed-returned-object';
    const ordinary = model(); context.invoke.mockImplementation(async (frozen, ...args) => { expect(frozen).toEqual(config); frozen.temperature = 0.9; frozen.baseUrl = 'https://mutated.example'; return ordinary(config, ...args); });
    const result = (await context.service.stepBatch(s, batch.id)).execution!; expect(result.receipt.status).toBe('completed'); expect(result.checkpoint.package.provenance.endpoint).toBe(config.baseUrl);
    expect((await context.service.readBatch(batch.id))?.configuration).toEqual(config); expect(JSON.stringify(context.local.data)).not.toContain('NEVER_STORE_KEY');
  });
  it('rejects concurrent execution and consumes cancelled slots without retry', async () => {
    const s = await suite('rating'); const context = setup(); const batch = await context.service.createBatch(s, config, 30); const other = await context.service.createBatch(s, config, 30);
    const controller = new AbortController(); let issued!: () => void; const started = new Promise<void>(resolve => { issued = resolve; });
    context.invoke.mockImplementationOnce(async () => { issued(); return new Promise<ChatResult>(() => {}); });
    const running = context.service.stepBatch(s, batch.id, controller.signal); await started;
    await expect(context.service.stepBatch(s, other.id)).rejects.toThrow('busy'); await expect(context.service.assessBatch(s, batch.id)).rejects.toThrow('busy');
    controller.abort(); const result = await running; expect(result.execution!.receipt).toMatchObject({ status: 'cancelled', usage: { calls: 1, inputTokens: null, outputTokens: null } });
    const next = await context.service.stepBatch(s, batch.id); expect(next.execution!.receipt.repetition).toBe(2); expect(next.batch.slots[0]!.state).toBe('cancelled');
  });
  it('serializes assessment with stepping so an old batch snapshot cannot overwrite a new reservation', async () => {
    const s = await suite('rating'); const context = setup(); const batch = await context.service.createBatch(s, config, 30);
    let release!: () => void; let blocked!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { blocked = resolve; });
    const get = context.local.get.getMockImplementation()!;
    context.local.get.mockImplementationOnce(async key => { blocked(); await hold; return get(key); });
    const assessing = context.service.assessBatch(s, batch.id); await entered;
    try { await expect(context.service.stepBatch(s, batch.id)).rejects.toThrow('busy'); } finally { release(); }
    await assessing; expect(context.invoke).not.toHaveBeenCalled();
    expect((await context.service.stepBatch(s, batch.id)).batch.callsUsed).toBe(1);
  });
  it('recovers a stopped worker with reserved usage, never zero or a rerun', async () => {
    const s = await suite('rating'); const context = setup(); const batch = await context.service.createBatch(s, config, 30); const controller = new AbortController();
    let capture!: (seed: Record<string, unknown>) => void; const captured = new Promise<Record<string, unknown>>(resolve => { capture = resolve; });
    context.invoke.mockImplementationOnce(async () => { capture(structuredClone(context.local.data)); return new Promise<ChatResult>(() => {}); });
    const running = context.service.stepBatch(s, batch.id, controller.signal); const seed = await captured; controller.abort(); await running;
    const recovered = setup(model(), seed); const restored = (await recovered.service.readBatch(batch.id))!;
    expect(restored.callsUsed).toBe(1); expect(restored.slots[0]!.state).toBe('interrupted');
    const receipt = (await recovered.service.readReceipt(restored.slots[0]!.receiptId!))!;
    expect(receipt).toMatchObject({ status: 'failed', errorCode: 'interrupted', usage: { calls: 1, inputTokens: null, outputTokens: null }, output: null });
    const next = await recovered.service.stepBatch(s, batch.id); expect(next.execution!.receipt.repetition).toBe(2); expect((await recovered.service.assessBatch(s, batch.id)).status).toBe('not_qualified');
  });
  it('persists possibly-sent state before transport even at the storage acknowledgement crash window', async () => {
    const s = await suite('rating'); const context = setup(); const batch = await context.service.createBatch(s, config, 30);
    let capture!: (seed: Record<string, unknown>) => void; const captured = new Promise<Record<string, unknown>>(resolve => { capture = resolve; }); const persist = context.local.set.getMockImplementation()!;
    context.local.set.mockImplementation(async items => { await persist(items); if (JSON.stringify(items).includes('possibly_sent')) { capture(structuredClone(context.local.data)); return new Promise<void>(() => {}); } });
    void context.service.stepBatch(s, batch.id); const recovered = setup(model(), await captured); const restored = (await recovered.service.readBatch(batch.id))!;
    const receipt = (await recovered.service.readReceipt(restored.slots[0]!.receiptId!))!; expect(context.invoke).not.toHaveBeenCalled(); expect(restored.callsUsed).toBe(1);
    expect(receipt.usage).toEqual({ calls: 1, inputTokens: null, outputTokens: null }); expect(receipt.status).toBe('failed');
  });
  it('serializes a blocked recovery read with stepping so stale state cannot restore a spent slot', async () => {
    const s = await suite('rating'); const original = setup(); const batch = await original.service.createBatch(s, config, 30);
    const controller = new AbortController(); let capture!: (seed: Record<string, unknown>) => void;
    const captured = new Promise<Record<string, unknown>>(resolve => { capture = resolve; });
    original.invoke.mockImplementationOnce(async () => { capture(structuredClone(original.local.data)); return new Promise<ChatResult>(() => {}); });
    const oldRun = original.service.stepBatch(s, batch.id, controller.signal); const seed = await captured; controller.abort(); await oldRun;
    const context = setup(model(), seed); let blocked!: () => void; let release!: () => void;
    const entered = new Promise<void>(resolve => { blocked = resolve; }); const hold = new Promise<void>(resolve => { release = resolve; });
    const get = context.local.get.getMockImplementation()!; let suspended = false;
    context.local.get.mockImplementation(async key => {
      if (!suspended && key.startsWith('gzk:analysis:calibration:receipt:v1:')) { suspended = true; blocked(); await hold; }
      return get(key);
    });
    const staleRead = context.service.readBatch(batch.id); await entered;
    const stepped = context.service.stepBatch(s, batch.id);
    await new Promise(resolve => setTimeout(resolve, 60)); const callsBeforeRecoveryReleased = context.invoke.mock.calls.length;
    release(); await staleRead; const result = await stepped;
    expect(callsBeforeRecoveryReleased).toBe(0);
    expect(result.execution!.receipt.repetition).toBe(2);
    const persisted = (await context.service.readBatch(batch.id))!;
    expect(persisted.callsUsed).toBe(2); expect(persisted.slots[0]!.state).toBe('interrupted'); expect(persisted.slots[1]!.state).toBe('completed');
    const next = await context.service.stepBatch(s, batch.id); expect(next.execution!.receipt.caseId).toBe('extraction'); expect(next.execution!.receipt.repetition).toBe(1);
  });
  it('keeps an active status read read-only when its execution finishes before storage returns', async () => {
    const s = await suite('rating'); const context = setup(); const batch = await context.service.createBatch(s, config, 30);
    let started!: () => void; let finishTransport!: () => void;
    const issued = new Promise<void>(resolve => { started = resolve; }); const transport = new Promise<void>(resolve => { finishTransport = resolve; });
    const ordinary = model(); context.invoke.mockImplementationOnce(async (...args) => { started(); await transport; return ordinary(...args); });
    const running = context.service.stepBatch(s, batch.id); await issued;
    let blocked!: () => void; let release!: () => void;
    const entered = new Promise<void>(resolve => { blocked = resolve; }); const hold = new Promise<void>(resolve => { release = resolve; });
    const get = context.local.get.getMockImplementation()!; let suspended = false;
    context.local.get.mockImplementation(async key => {
      const value = await get(key);
      if (!suspended && key === `gzk:analysis:calibration:batch:v1:${batch.id}`) { suspended = true; blocked(); await hold; }
      return value;
    });
    const observed = context.service.readBatch(batch.id); await entered;
    finishTransport(); const completed = await running; expect(completed.execution!.state).toBe('completed');
    const writesBeforeReadReturns = context.local.set.mock.calls.length;
    release(); await observed; expect(context.local.set).toHaveBeenCalledTimes(writesBeforeReadReturns);
    const persisted = (await context.service.readBatch(batch.id))!;
    expect(persisted.callsUsed).toBe(1); expect(persisted.slots[0]!.state).toBe('completed');
    expect((await context.service.readReceipt(persisted.slots[0]!.receiptId!))?.status).toBe('completed');
    expect(context.invoke).toHaveBeenCalledTimes(1);
  });
  it('does not invoke after pre-cancellation or failed persistence', async () => {
    const s = await suite('rating'); const context = setup(); const batch = await context.service.createBatch(s, config, 30); const controller = new AbortController(); controller.abort();
    const cancelled = await context.service.stepBatch(s, batch.id, controller.signal); expect(cancelled.execution!.receipt).toMatchObject({ status: 'cancelled', usage: { calls: 0 } }); expect(context.invoke).not.toHaveBeenCalled();
    const broken = setup(); broken.local.set.mockRejectedValue(new Error('STORAGE_SECRET_BODY'));
    await expect(broken.service.createBatch(s, config, 30)).rejects.toThrow('storage_write'); expect(broken.invoke).not.toHaveBeenCalled();
  });
  it('retains conservative reservation counts when acknowledgement fails before invoke', async () => {
    const s = await suite('rating'); const context = setup(); const batch = await context.service.createBatch(s, config, 30); let failed = false; const persist = context.local.set.getMockImplementation()!;
    context.local.set.mockImplementation(async items => { if (!failed && JSON.stringify(items).includes('possibly_sent')) { failed = true; throw new Error('QUOTA_SECRET'); } return persist(items); });
    const result = await context.service.stepBatch(s, batch.id); expect(context.invoke).not.toHaveBeenCalled(); expect(result.execution!.receipt.status).toBe('failed');
    expect(result.batch.callsUsed).toBe(1); expect(result.execution!.receipt.usage).toEqual({ calls: 1, inputTokens: null, outputTokens: null }); expect(JSON.stringify(context.local.data)).not.toContain('QUOTA_SECRET');
  });
  it('does not conceal within-case provider drift or unknown aliases', async () => {
    const s = await suite(); const context = setup(); const batch = await context.service.createBatch(s, config, 30); const ordinary = model();
    context.invoke.mockImplementationOnce(async (...args) => ({ ...await ordinary(...args), providerModel: 'different-backend' }));
    const drift = (await context.service.stepBatch(s, batch.id)).execution!; expect(drift.receipt).toMatchObject({ status: 'failed', errorCode: 'provider_model_drift', output: null });
    context.invoke.mockImplementationOnce(async (...args) => ({ ...await ordinary(...args), providerModel: null }));
    const unknown = (await context.service.stepBatch(s, batch.id)).execution!; expect(unknown.receipt.status).toBe('completed'); expect(unknown.receipt.providerModel).toBeNull(); expect(unknown.receipt.output?.provenance.providerModel).toBeNull();
  });
  it('keeps provider reasons fixed and returned data cannot mutate the ledger', async () => {
    const s = await suite('rating'); const context = setup(); const batch = await context.service.createBatch(s, config, 30); context.invoke.mockRejectedValueOnce(new ProviderError('unauthorized', 401));
    const result = (await context.service.stepBatch(s, batch.id)).execution!; expect(result.receipt.errorCode).toBe('unauthorized'); result.receipt.errorCode = 'mutated';
    expect((await context.service.readReceipt(result.receipt.id))?.errorCode).toBe('unauthorized'); expect(await context.service.listReceipts(s.hash, config)).toHaveLength(1);
  });
});

it('retains obsolete pipeline batches without letting them block or join the current trial',async()=>{
  const s=await suite();const context=setup();const old=await context.service.createBatch(s,config,30);
  const key=`gzk:analysis:calibration:batch:v1:${old.id}`;
  const raw=context.local.data[key] as any;
  raw.configurationHash=await hashValue({endpoint:config.baseUrl,model:config.model,declaredVersion:config.declaredVersion,temperature:config.temperature,maxOutputTokens:config.maxOutputTokens,transport:'chat-completions-v1',toolPolicy:'fixed-input-no-model-tools-v1'});
  const before=structuredClone(raw);
  const fresh=await context.service.createBatch(s,config,30);
  expect((await context.service.listBatches(s.hash,config)).map(b=>b.id)).toEqual([fresh.id]);
  await expect(context.service.stepBatch(s,old.id)).rejects.toThrow('configuration_changed');
  expect(context.local.data[key]).toEqual(before);expect(context.invoke).not.toHaveBeenCalled();
});
