import { describe, expect, it } from 'vitest';
import { compareExtractions, compareRatings, createReplayRun, freezeCalibrationSuite, assessQualification, qualificationMatches, calibrationInputHash, configurationFingerprint, DEFAULT_CALIBRATION_THRESHOLDS, type CalibrationExecutionReceipt, type FrozenCalibrationSuite } from '../src/analysis/comparison';
import { executeRun } from '../src/analysis/engine';
import { hashValue } from '../src/analysis/contracts';
import { examplePackage } from './fixtures/analysis/package';
import type { AnalysisPackage } from '../src/analysis/types';

const config = { id: 'm1', name: '模型', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', temperature: 0, maxOutputTokens: 4096, declaredVersion: 'version-1' };
function renamed(pkg: AnalysisPackage): AnalysisPackage {
  const copy = structuredClone(pkg); copy.claims[0]!.id = 'different-id'; copy.questions[0]!.claimIds = ['different-id']; copy.relations[0]!.claimId = 'different-id'; copy.evaluations[0]!.claimIds = ['different-id']; return copy;
}
describe('same input comparisons', () => {
  it('matches extractions by original Unicode spans, not model-generated IDs', async () => {
    const left = examplePackage(); const right = renamed(left);
    const result = await compareExtractions(left, right);
    expect(result.comparable).toBe(true); expect(result.groups[0]?.leftClaimIds).toEqual(['C01']); expect(result.groups[0]?.rightClaimIds).toEqual(['different-id']);
    expect(result.groups[0]?.changes).toEqual([]); expect(result.leftOnly).toEqual([]); expect(result.rightOnly).toEqual([]);
  });
  it('reports split, merge, changed qualifiers and unaligned claims without deciding which model is true', async () => {
    const left = examplePackage(); const right = renamed(left);
    right.claims[0]!.spans = [{ messageId: 'reply-123', start: 1, end: 6, quote: '平均每单是' }];
    const second = structuredClone(right.claims[0]!); second.id = 'part-2'; second.spans = [{ messageId: 'reply-123', start: 6, end: 10, quote: '10元。' }]; second.qualifiers.population = '所有订单'; right.claims.push(second);
    const result = await compareExtractions(left, right);
    expect(result.groups[0]?.kind).toBe('split'); expect(result.groups[0]?.changes).toContain('qualifiers');
    expect((await compareExtractions(right, left)).groups[0]?.kind).toBe('merge');
    const absent = examplePackage(); absent.claims = []; absent.questions = []; absent.relations = []; absent.evaluations = [];
    expect((await compareExtractions(left, absent)).leftOnly).toEqual(['C01']);
    expect(JSON.stringify(result)).not.toMatch(/winner|majority|accuracy/);
  });
  it('refuses changed snapshots and rules even when the URL is the same', async () => {
    const left = examplePackage(); const right = examplePackage(); right.snapshot.title = 'new topic title';
    expect((await compareExtractions(left, right)).differences).toContain('snapshot');
    right.snapshot = structuredClone(left.snapshot); right.methodVersion = '0.2.0';
    expect((await compareExtractions(left, right)).differences).toContain('method');
  });
  it('refuses rating comparison when claims, questions, coverage, source text or relations change', async () => {
    const left = examplePackage();
    for (const mutate of [
      (p: AnalysisPackage) => { p.claims[0]!.qualifiers.population = 'different'; },
      (p: AnalysisPackage) => { p.questions[0]!.needed.push('additional'); },
      (p: AnalysisPackage) => { p.coverage.push({ span: p.claims[0]!.spans[0]!, claimIds: ['C01'], disposition: 'claim', reason: 'covered' }); },
      (p: AnalysisPackage) => { p.sources[0]!.text += 'additional'; },
      (p: AnalysisPackage) => { p.relations[0]!.reason = 'different relation'; },
    ]) {
      const right = examplePackage(); mutate(right); const result = await compareRatings(left, right); expect(result.comparable).toBe(false); expect(result.units).toEqual([]);
    }
  });
  it('keeps NA, P, U and zero separate and counts missing outputs outside matched denominators', async () => {
    const left = examplePackage(); const right = examplePackage();
    right.evaluations[0]!.dimensions.L = { applicability: 'uncertain', grade: null, reason: 'context missing', ruleIds: ['P'], refs: [] };
    right.evaluations[0]!.dimensions.B = { applicability: 'yes', grade: 0, reason: 'scope violation', ruleIds: ['B0'], refs: [structuredClone(right.claims[0]!.spans[0]!)] };
    const result = await compareRatings(left, right);
    expect(result.units[0]!.dimensions.L).toMatchObject({ left: 'NA', right: 'P', same: false });
    expect(result.units[0]!.dimensions.B).toMatchObject({ left: 'U', right: '0', same: false });
    right.evaluations = []; const missing = await compareRatings(left, right);
    expect(missing.units[0]?.status).toBe('missing_right'); expect(missing.counts.comparedDimensions).toBe(0); expect(missing.counts.missingRight).toBe(1);
  });
  it('does not silently accept changed targets or duplicate evaluation units', async () => {
    const left = examplePackage(); const right = examplePackage(); right.evaluations[0]!.targetMessageIds = [];
    expect((await compareRatings(left, right)).units[0]?.status).toBe('invalid_task');
    right.evaluations = [structuredClone(left.evaluations[0]!), { ...structuredClone(left.evaluations[0]!), id: 'V-duplicate' }];
    expect((await compareRatings(left, right)).units[0]?.status).toBe('duplicate');
  });
});

describe('replay isolation', () => {
  it('creates a new extraction run and clears outputs, budgets and claimed qualifications', async () => {
    const source = examplePackage(); source.provenance.mode = 'standard'; source.provenance.qualificationId = 'imported-claim';
    const job = await createReplayRun(source, config, 'extraction');
    expect(job.id).not.toBe(source.id); expect(job.package.snapshot).toEqual(source.snapshot); expect(job.package.claims).toEqual([]);
    expect(job.completedStages).toEqual([]); expect(job.callsUsed).toBe(0); expect(job.requests).toEqual([]); expect(job.package.provenance.mode).toBe('exploratory'); expect(job.package.provenance.qualificationId).toBe(null);
    job.package.snapshot.title = 'mutated'; expect(source.snapshot.title).toBe('测试讨论');
  });
  it('creates an engine-compatible frozen rating run, preserves source hashes and only calls replies', async () => {
    const source = examplePackage(); const job = await createReplayRun(source, config, 'rating'); const stages: string[] = [];
    expect(job.completedStages).toEqual(['claims', 'plan', 'evidence', 'relations']); expect(job.package.evaluations).toEqual([]); expect(job.package.sources).toEqual(source.sources);
    const done = await executeRun(job, { save: async () => {}, call: async stage => { stages.push(stage); return { value: { evaluations: source.evaluations }, usage: { inputTokens: 1, outputTokens: 1 }, providerModel: 'fixed-backend' }; } });
    expect(done.state).toBe('completed'); expect(stages).toEqual(['replies']); expect((await compareRatings(source, done.package)).comparable).toBe(true);
  });
  it('rejects stale declared frozen hashes, stale method and unsupported track', async () => {
    const source = examplePackage(); source.provenance.stageHashes.claims = '0'.repeat(64);
    await expect(createReplayRun(source, config, 'rating')).rejects.toThrow('frozen_input_changed');
    source.provenance.stageHashes = {}; source.methodVersion = '0.1'; await expect(createReplayRun(source, config, 'rating')).rejects.toThrow('method_changed');
    await expect(createReplayRun(examplePackage(), config, 'invalid' as 'rating')).rejects.toThrow('invalid_track');
  });
});

function packageAt(index: number): AnalysisPackage {
  const pkg = examplePackage(); pkg.snapshot.title = `不同留出讨论 ${index}`;
  pkg.snapshot.messages[0]!.text = `第 ${index} 种口径的平均费用是多少？`;
  for (const dim of ['R', 'E', 'L', 'B'] as const) pkg.evaluations[0]!.dimensions[dim] = { applicability: 'yes', grade: dim === 'E' ? 0 : 2, reason: '本地参考判断', ruleIds: [dim + '2'], refs: [structuredClone(pkg.claims[0]!.spans[0]!)] };
  return pkg;
}
const thresholds = { ...DEFAULT_CALIBRATION_THRESHOLDS, repetitions: 2, minCases: 4, minCasesPerTrack: 2, minDeterminatePerDimension: 2 };
async function suite() {
  return freezeCalibrationSuite({ id: 'held-out-v1', methodVersion: '0.2.1', referenceLabel: 'AI 辅助方法参考，未经独立专家审阅', developmentInputHashes: [], thresholds, cases: [
    { id: 'extract-1', track: 'extraction', stratum: 'empirical', reference: packageAt(1) },
    { id: 'extract-2', track: 'extraction', stratum: 'scope', reference: packageAt(2) },
    { id: 'rate-1', track: 'rating', stratum: 'empirical', reference: packageAt(3) },
    { id: 'rate-2', track: 'rating', stratum: 'scope', reference: packageAt(4) },
  ] });
}
async function receipts(s: FrozenCalibrationSuite): Promise<CalibrationExecutionReceipt[]> {
  const out: CalibrationExecutionReceipt[] = [];
  for (const item of s.cases) for (let repetition = 1; repetition <= s.thresholds.repetitions; repetition++) {
    const output = structuredClone(item.reference); output.id = `run-${item.id}-${repetition}`; output.provenance = { ...output.provenance, modelConfigId: config.id, endpoint: config.baseUrl, model: config.model, declaredVersion: config.declaredVersion, parameters: { temperature: config.temperature, maxOutputTokens: config.maxOutputTokens }, providerModel: 'fixed-backend' };
    out.push({ id: `receipt-${item.id}-${repetition}`, suiteHash: s.hash, caseId: item.id, repetition, configurationHash: await configurationFingerprint(config), inputHash: await calibrationInputHash(item.reference, item.track), outputHash: await hashValue(output), output, runId: output.id, methodVersion: '0.2.1', startedAt: s.frozenAt, finishedAt: s.frozenAt, status: 'completed', providerModel: 'fixed-backend', transport: 'chat-completions-v1', requestIds: [`request-${item.id}-${repetition}`], usage: { calls: 1, inputTokens: 50, outputTokens: 50 }, errorCode: null });
  }
  return out;
}
const store = (items: CalibrationExecutionReceipt[]) => async (id: string) => structuredClone(items.find(x => x.id === id) ?? null);

describe('frozen local qualification', () => {
  it('uses referenced semantics on two tracks, exact denominators and verified local receipt IDs', async () => {
    const s = await suite(); const runs = await receipts(s); const result = await assessQualification(s, config, runs.map(x => x.id), store(runs));
    expect(result.status).toBe('qualified_trial'); expect(result.expectedRuns).toBe(8); expect(result.acceptedRuns).toBe(8);
    expect(result.metrics.dimensions.R.referenceAgreement).toMatchObject({ numerator: 4, denominator: 4, rate: 1 });
    expect(result.metrics.extraction.spanRecall).toMatchObject({ numerator: 4, denominator: 4, rate: 1 });
    expect(result.referenceLabel).toContain('未经独立专家'); expect(result.receiptIds).toHaveLength(8);
  });
  it('rejects duplicate material, development leakage and post-freeze threshold edits', async () => {
    const s = await suite(); const input = { ...s, cases: [{ ...s.cases[0]! }, { ...s.cases[0]!, id: 'renamed-case' }], thresholds: { ...thresholds, minCases: 2, minCasesPerTrack: 1 } };
    await expect(freezeCalibrationSuite(input)).rejects.toThrow('duplicate');
    await expect(freezeCalibrationSuite({ ...s, developmentInputHashes: [await calibrationInputHash(s.cases[0]!.reference, 'extraction')] })).rejects.toThrow('development_overlap');
    const runs = await receipts(s); s.thresholds.minReferenceAgreement = 0;
    await expect(assessQualification(s, config, runs.map(x => x.id), store(runs))).rejects.toThrow('suite_integrity');
  });
  it('does not qualify all abstention, or agreement between identically wrong models', async () => {
    const s = await suite(); const runs = await receipts(s);
    for (const r of runs.filter(r => r.caseId.startsWith('rate'))) { for (const dim of Object.values(r.output!.evaluations[0]!.dimensions)) dim.grade = 'U'; r.outputHash = await hashValue(r.output); }
    const result = await assessQualification(s, config, runs.map(x => x.id), store(runs));
    expect(result.status).toBe('not_qualified'); expect(result.reasons).toContain('determinate_coverage:R'); expect(result.metrics.dimensions.R.determinateCoverage.rate).toBe(0);
    for (const r of runs.filter(r => r.caseId.startsWith('rate'))) { for (const dim of Object.values(r.output!.evaluations[0]!.dimensions)) dim.grade = 1; r.outputHash = await hashValue(r.output); }
    expect((await assessQualification(s, config, runs.map(x => x.id), store(runs))).reasons).toContain('reference_agreement:R');
  });
  it('reports missing, failed, reused, mismatched and tampered execution receipts separately', async () => {
    const s = await suite(); const runs = await receipts(s);
    runs[0]!.status = 'failed'; runs[0]!.errorCode = 'timeout'; runs[0]!.output = null; runs[0]!.outputHash = null;
    runs[1]!.outputHash = 'bad'; runs[2]!.inputHash = 'bad'; runs[3]!.suiteHash = 'other-suite';
    const result = await assessQualification(s, config, [...runs.map(x => x.id), runs[4]!.id, 'absent'], store(runs));
    expect(result.status).toBe('not_qualified'); expect(result.failures.map(x => x.code)).toEqual(expect.arrayContaining(['execution_failed', 'output_integrity', 'input_mismatch', 'suite_mismatch', 'duplicate_receipt', 'receipt_missing']));
    expect(result.acceptedRuns).toBeLessThan(8);
  });
  it('does not accept imported standard flags as trusted execution receipts', async () => {
    const s = await suite(); const imported = packageAt(1); imported.provenance.mode = 'standard'; imported.provenance.qualificationId = 'looks-official';
    const result = await assessQualification(s, config, [imported.provenance.qualificationId], async () => null);
    expect(result.status).toBe('not_qualified'); expect(result.acceptedRuns).toBe(0); expect(result.failures[0]?.code).toBe('receipt_missing');
  });
  it('invalidates endpoint/model/version/parameters/rules/suite changes and backend drift', async () => {
    const s = await suite(); const runs = await receipts(s); const result = await assessQualification(s, config, runs.map(x => x.id), store(runs));
    expect(await qualificationMatches(result, config, '0.2.1', s.hash)).toBe(true);
    for (const changed of [{ ...config, baseUrl: 'https://other.example/v1' }, { ...config, model: 'different' }, { ...config, declaredVersion: '2' }, { ...config, temperature: 0.1 }, { ...config, maxOutputTokens: 2048 }]) expect(await qualificationMatches(result, changed, '0.2.1', s.hash)).toBe(false);
    expect(await qualificationMatches(result, config, 'old', s.hash)).toBe(false); expect(await qualificationMatches(result, config, '0.2.1', 'changed')).toBe(false);
    runs[0]!.providerModel = 'different-backend'; runs[0]!.output!.provenance.providerModel = 'different-backend'; runs[0]!.outputHash = await hashValue(runs[0]!.output);
    expect((await assessQualification(s, config, runs.map(x => x.id), store(runs))).reasons).toContain('provider_model_drift');
  });
});

describe('calibration adversarial boundaries', () => {
  it('returns false for invalid configurations instead of surfacing a stale qualification', async () => {
    const s = await suite(); const runs = await receipts(s); const record = await assessQualification(s, config, runs.map(r => r.id), store(runs));
    expect(await qualificationMatches(record, { ...config, baseUrl: 'http://localhost/v1' }, '0.2.1', s.hash)).toBe(false);
  });
  it('does not count a replayed request/run as a new independent repetition', async () => {
    const s = await suite(); const runs = await receipts(s); runs[1]!.requestIds = [...runs[0]!.requestIds];
    const result = await assessQualification(s, config, runs.map(r => r.id), store(runs));
    expect(result.failures.some(f => f.code === 'reused_execution')).toBe(true); expect(result.status).toBe('not_qualified');
  });
  it('distinguishes changed attribution/scope from similar text in extraction calibration', async () => {
    const s = await suite(); const runs = await receipts(s);
    for (const r of runs.filter(r => r.caseId.startsWith('extract'))) { r.output!.claims[0]!.qualifiers.population = '所有订单'; r.outputHash = await hashValue(r.output); }
    const result = await assessQualification(s, config, runs.map(r => r.id), store(runs));
    expect(result.metrics.extraction.spanRecall.rate).toBe(1); expect(result.metrics.extraction.structureAgreement.rate).toBe(0); expect(result.reasons).toContain('extraction_structure');
  });
  it('keeps unknown usage unknown and rejects negative usage', async () => {
    const s = await suite(); const runs = await receipts(s); runs[0]!.usage.inputTokens = null;
    expect((await assessQualification(s, config, runs.map(r => r.id), store(runs))).metrics.usage.inputTokens).toBe(null);
    runs[1]!.usage.outputTokens = -5;
    expect((await assessQualification(s, config, runs.map(r => r.id), store(runs))).failures.some(f => f.code === 'invalid_usage')).toBe(true);
  });
  it('rejects reference evidence with incomplete grading, duplicated material under new IDs, and hidden prototype-like strata', async () => {
    const s = await suite(); s.cases[2]!.reference.evaluations = [];
    await expect(freezeCalibrationSuite(s)).rejects.toThrow('reference_incomplete');
    const other = await suite(); other.cases[1]!.reference.snapshot.messages = structuredClone(other.cases[0]!.reference.snapshot.messages);
    await expect(freezeCalibrationSuite(other)).rejects.toThrow('duplicate_material');
    const special = await suite(); special.cases[0]!.stratum = '__proto__'; const frozen = await freezeCalibrationSuite(special); const runs = await receipts(frozen);
    const result = await assessQualification(frozen, config, runs.map(r => r.id), store(runs));
    expect(Object.hasOwn(result.metrics.strata, '__proto__')).toBe(true); expect(result.metrics.strata['__proto__']!.cases).toBe(1);
  });
  it('does not accept malformed or pre-freeze receipts', async () => {
    const s = await suite(); const runs = await receipts(s); runs[0]!.startedAt = '2020-01-01T00:00:00Z';
    expect((await assessQualification(s, config, runs.map(r => r.id), store(runs))).failures.some(f => f.code === 'execution_time')).toBe(true);
    const result = await assessQualification(s, config, ['malformed'], async () => ({ id: 'malformed' } as CalibrationExecutionReceipt));
    expect(result.status).toBe('not_qualified'); expect(result.failures[0]?.code).toBe('receipt_structure');
  });
  it('rejects reuse of development extraction material on the rating track', async () => {
    const s = await suite();
    await expect(freezeCalibrationSuite({ ...s, developmentInputHashes: [await calibrationInputHash(s.cases[2]!.reference, 'extraction')] })).rejects.toThrow('development_overlap');
  });
  it('cannot qualify when declared model version is missing', async () => {
    const s = await suite(); const runs = await receipts(s);
    const configWithoutVersion = { ...config, declaredVersion: '' };
    for (const r of runs) { r.configurationHash = await configurationFingerprint(configWithoutVersion); r.output!.provenance.declaredVersion = ''; r.outputHash = await hashValue(r.output); }
    expect((await assessQualification(s, configWithoutVersion, runs.map(r => r.id), store(runs))).reasons).toContain('declared_version_missing');
  });

});

describe('determinate grading admission', () => {
  it('does not let many correct NA labels hide every determinate grade being wrong', async () => {
    const input = await suite();
    for (const item of input.cases.filter(c => c.track === 'rating')) {
      const pkg = item.reference; const firstMessage = structuredClone(pkg.snapshot.messages[1]!);
      const firstClaim = structuredClone(pkg.claims[0]!); const firstEvaluation = structuredClone(pkg.evaluations[0]!);
      pkg.snapshot.messages = [pkg.snapshot.messages[0]!]; pkg.claims = []; pkg.evaluations = [];
      for (let index = 0; index < 30; index++) {
        const message = { ...structuredClone(firstMessage), id: index ? `reply-extra-${index}` : firstMessage.id, floor: index + 1 };
        const claim = { ...structuredClone(firstClaim), id: index ? `extra-C${index}` : firstClaim.id, messageId: message.id };
        claim.spans = claim.spans.map(span => ({ ...span, messageId: message.id }));
        const evaluation = { ...structuredClone(firstEvaluation), id: `V-${claim.id}`, messageId: message.id, claimIds: [claim.id] };
        for (const dim of ['R', 'E', 'L', 'B'] as const) evaluation.dimensions[dim] = index < 3
          ? { applicability: 'yes', grade: 2, reason: '确定参考等级', ruleIds: [dim + '2'], refs: structuredClone(claim.spans) }
          : { applicability: 'no', grade: null, reason: '不适用参考项', ruleIds: [dim + '-NA'], refs: [] };
        pkg.snapshot.messages.push(message); pkg.claims.push(claim); pkg.evaluations.push(evaluation);
      }
      pkg.snapshot.expectedReplies = 30; pkg.snapshot.pages[0]!.messageIds = pkg.snapshot.messages.map(m => m.id);
    }
    const frozen = await freezeCalibrationSuite(input); const runs = await receipts(frozen);
    for (const receipt of runs.filter(r => r.caseId.startsWith('rate'))) {
      for (const evaluation of receipt.output!.evaluations) for (const dim of Object.values(evaluation.dimensions)) if (typeof dim.grade === 'number') dim.grade = 1;
      receipt.outputHash = await hashValue(receipt.output);
    }
    const result = await assessQualification(frozen, config, runs.map(r => r.id), store(runs));
    expect(result.metrics.dimensions.R.referenceAgreement).toEqual({ numerator: 108, denominator: 120, rate: 0.9 });
    expect(result.metrics.dimensions.R.determinateCoverage).toEqual({ numerator: 12, denominator: 12, rate: 1 });
    expect(result.metrics.dimensions.R.repeatAgreement.rate).toBe(1);
    expect(result.status).toBe('not_qualified');
    expect(result.metrics.dimensions.R.determinateAgreement).toEqual({ numerator: 0, denominator: 12, rate: 0 });
    expect(result.reasons).toEqual(expect.arrayContaining(['determinate_agreement:R', 'determinate_agreement:E', 'determinate_agreement:L', 'determinate_agreement:B']));
  });
});

function withCommaClaimIds(pkg: AnalysisPackage): AnalysisPackage {
  const original = structuredClone(pkg.claims[0]!); const evaluation = structuredClone(pkg.evaluations[0]!);
  pkg.claims = ['A', 'B', 'A,B'].map(id => ({ ...structuredClone(original), id }));
  pkg.questions[0]!.claimIds = ['A', 'B', 'A,B']; pkg.relations[0]!.claimId = 'A';
  pkg.evaluations = pkg.claims.map(claim => ({ ...structuredClone(evaluation), id: `V-${claim.id}`, claimIds: [claim.id] }));
  return pkg;
}
describe('structural identity keys', () => {
  it('cannot replace one comma-containing claim ID with two IDs and retain a compared unit', async () => {
    const left = withCommaClaimIds(examplePackage()); const right = structuredClone(left);
    right.evaluations[2]!.claimIds = ['A', 'B'];
    const comparison = await compareRatings(left, right);
    expect(comparison.counts.comparedUnits).toBe(2); expect(comparison.counts.comparedDimensions).toBe(8);
    expect(comparison.units[2]!.status).toBe('missing_right'); expect(comparison.unexpectedRight).toEqual(['V-A,B']);
  });
  it('rejects a same-delimiter substitution in trusted calibration outputs', async () => {
    const input = await suite();
    for (const item of input.cases.filter(c => c.track === 'rating')) item.reference = withCommaClaimIds(item.reference);
    const frozen = await freezeCalibrationSuite(input); const runs = await receipts(frozen);
    for (const receipt of runs.filter(r => r.caseId.startsWith('rate'))) { receipt.output!.evaluations[2]!.claimIds = ['A', 'B']; receipt.outputHash = await hashValue(receipt.output); }
    const result = await assessQualification(frozen, config, runs.map(r => r.id), store(runs));
    expect(result.status).toBe('not_qualified'); expect(result.failures.filter(f => f.code === 'output_incomplete')).toHaveLength(4);
  });
});
