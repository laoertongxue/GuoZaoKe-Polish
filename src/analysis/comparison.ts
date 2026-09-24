import { assertPackage, comparableInputs, hashValue } from './contracts';
import { createRun, evaluationUnits } from './engine';
import { normalizeModelConfig, type ModelConfig } from './providers';
import { METHOD_VERSION, type AnalysisBudget, type AnalysisPackage, type Claim, type Dimension, type ReplyEvaluation, type RunCheckpoint, type Stage, type TextSpan } from './types';

export type ReplayTrack = 'extraction' | 'rating';
export type DimensionKey = 'R' | 'E' | 'L' | 'B';
export type DimensionState = 'NA' | 'P' | 'U' | '0' | '1' | '2';
const DIMENSIONS: DimensionKey[] = ['R', 'E', 'L', 'B'];
const FROZEN_STAGES: Stage[] = ['claims', 'plan', 'evidence', 'relations'];
const sorted = (values: string[]) => [...values].sort();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const spanKey = (span: TextSpan) => JSON.stringify([span.messageId, span.start, span.end]);
const claimSpans = (claim: Claim) => sorted(claim.spans.map(spanKey));
const overlaps = (a: Claim, b: Claim) => a.spans.some(x => b.spans.some(y => x.messageId === y.messageId && x.start < y.end && y.start < x.end));
export function dimensionState(dimension: Dimension): DimensionState {
  if (dimension.applicability === 'no') return 'NA';
  if (dimension.applicability === 'uncertain') return 'P';
  if (dimension.grade === 'U' || typeof dimension.grade === 'number') return String(dimension.grade) as DimensionState;
  throw new Error('dimension: 适用性或等级无效');
}
export interface ExtractionGroup {
  kind: 'matched' | 'split' | 'merge' | 'complex'; leftClaimIds: string[]; rightClaimIds: string[];
  changes: string[];
}
export interface ExtractionComparison {
  comparable: boolean; differences: string[]; groups: ExtractionGroup[]; leftOnly: string[]; rightOnly: string[];
  counts: { leftClaims: number; rightClaims: number; alignedGroups: number };
  note: string;
}
/** Location overlap aligns candidates for review; it never proves semantic equivalence. */
export async function compareExtractions(left: AnalysisPackage, right: AnalysisPackage): Promise<ExtractionComparison> {
  assertPackage(left); assertPackage(right);
  const differences: string[] = [];
  if (left.methodVersion !== right.methodVersion) differences.push('method');
  if (await hashValue(left.snapshot) !== await hashValue(right.snapshot)) differences.push('snapshot');
  const result: ExtractionComparison = { comparable: !differences.length, differences, groups: [], leftOnly: [], rightOnly: [], counts: { leftClaims: left.claims.length, rightClaims: right.claims.length, alignedGroups: 0 }, note: '原文位置对齐用于定位拆分、合并和范围差异；文案不同不等于语义错误，未对齐项也不自动判定为遗漏。模型间一致不证明事实正确。' };
  if (differences.length) return result;
  const visitedLeft = new Set<number>(); const visitedRight = new Set<number>();
  for (let start = 0; start < left.claims.length; start++) {
    if (visitedLeft.has(start)) continue;
    const ls = new Set<number>([start]); const rs = new Set<number>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const i of ls) right.claims.forEach((claim, j) => { if (!rs.has(j) && overlaps(left.claims[i]!, claim)) { rs.add(j); changed = true; } });
      for (const j of rs) left.claims.forEach((claim, i) => { if (!ls.has(i) && overlaps(claim, right.claims[j]!)) { ls.add(i); changed = true; } });
    }
    ls.forEach(i => visitedLeft.add(i)); rs.forEach(i => visitedRight.add(i));
    if (!rs.size) { result.leftOnly.push(left.claims[start]!.id); continue; }
    const a = [...ls].map(i => left.claims[i]!); const b = [...rs].map(i => right.claims[i]!);
    const changes: string[] = [];
    for (const field of ['authorId', 'kind', 'adoption', 'qualifiers', 'contextRefs', 'uncertainty', 'text'] as const) {
      const values = (claims: Claim[]) => [...new Set(claims.map(c => JSON.stringify(field === 'contextRefs' ? sorted(c.contextRefs) : field === 'qualifiers' ? Object.entries(c.qualifiers).sort() : c[field])))].sort();
      if (!same(values(a), values(b))) changes.push(field === 'text' ? 'wording_needs_review' : field);
    }
    if (!same(a.map(claimSpans).sort(), b.map(claimSpans).sort())) changes.push('spans');
    result.groups.push({ kind: a.length === 1 && b.length === 1 ? 'matched' : a.length === 1 ? 'split' : b.length === 1 ? 'merge' : 'complex', leftClaimIds: a.map(c => c.id), rightClaimIds: b.map(c => c.id), changes });
  }
  result.rightOnly = right.claims.filter((_, i) => !visitedRight.has(i)).map(c => c.id); result.counts.alignedGroups = result.groups.length;
  return result;
}

export interface RatingUnitComparison {
  id: string; messageId: string; claimIds: string[];
  status: 'compared' | 'missing_left' | 'missing_right' | 'missing_both' | 'duplicate' | 'invalid_task';
  dimensions: Partial<Record<DimensionKey, { left: DimensionState; right: DimensionState; same: boolean; explanationChanged: boolean }>>;
  expressionChanged: boolean | null; contributionsChanged: boolean | null;
}
export interface RatingComparison {
  comparable: boolean; differences: string[]; units: RatingUnitComparison[];
  unexpectedLeft: string[]; unexpectedRight: string[];
  counts: { expectedUnits: number; comparedUnits: number; comparedDimensions: number; equalDimensions: number; missingLeft: number; missingRight: number; invalidUnits: number };
  note: string;
}
const unitKey = (item: Pick<ReplyEvaluation, 'messageId' | 'claimIds'>) => JSON.stringify([item.messageId, sorted(item.claimIds)]);
/** Only a frozen shared task can be compared dimension by dimension. Missing outputs are not zero. */
export async function compareRatings(left: AnalysisPackage, right: AnalysisPackage): Promise<RatingComparison> {
  assertPackage(left); assertPackage(right);
  const gate = await comparableInputs(left, right);
  if (await hashValue(left.coverage) !== await hashValue(right.coverage)) gate.differences.push('coverage');
  gate.comparable = !gate.differences.length;
  const result: RatingComparison = { ...gate, units: [], unexpectedLeft: [], unexpectedRight: [], counts: { expectedUnits: 0, comparedUnits: 0, comparedDimensions: 0, equalDimensions: 0, missingLeft: 0, missingRight: 0, invalidUnits: 0 }, note: '逐维报告一致与差异，不合成用户分数，不使用多数票裁定真值。缺失、失败与 NA/P/U 分开统计。' };
  if (!gate.comparable) return result;
  const expected = evaluationUnits(left, left.snapshot.messages.filter(m => m.kind === 'reply'));
  const expectedKeys = new Set(expected.map(unitKey)); result.counts.expectedUnits = expected.length;
  result.unexpectedLeft = left.evaluations.filter(e => !expectedKeys.has(unitKey(e))).map(e => e.id);
  result.unexpectedRight = right.evaluations.filter(e => !expectedKeys.has(unitKey(e))).map(e => e.id);
  for (const item of expected) {
    const a = left.evaluations.filter(e => unitKey(e) === unitKey(item)); const b = right.evaluations.filter(e => unitKey(e) === unitKey(item));
    const row: RatingUnitComparison = { id: item.id, messageId: item.messageId, claimIds: [...item.claimIds], status: 'compared', dimensions: {}, expressionChanged: null, contributionsChanged: null };
    if (!a.length) result.counts.missingLeft++;
    if (!b.length) result.counts.missingRight++;
    if (a.length > 1 || b.length > 1) row.status = 'duplicate';
    else if (!a.length && !b.length) row.status = 'missing_both';
    else if (!a.length) row.status = 'missing_left';
    else if (!b.length) row.status = 'missing_right';
    else if (!same(sorted(a[0]!.targetMessageIds), sorted(item.targetMessageIds)) || !same(sorted(b[0]!.targetMessageIds), sorted(item.targetMessageIds))) row.status = 'invalid_task';
    if (row.status === 'compared') {
      for (const key of DIMENSIONS) {
        const da = a[0]!.dimensions[key]; const db = b[0]!.dimensions[key]; const sa = dimensionState(da); const sb = dimensionState(db);
        row.dimensions[key] = { left: sa, right: sb, same: sa === sb, explanationChanged: !same(da, db) };
        result.counts.comparedDimensions++; if (sa === sb) result.counts.equalDimensions++;
      }
      row.expressionChanged = !same(a[0]!.expression, b[0]!.expression); row.contributionsChanged = !same(sorted(a[0]!.contributions), sorted(b[0]!.contributions)); result.counts.comparedUnits++;
    } else if (row.status === 'duplicate' || row.status === 'invalid_task') result.counts.invalidUnits++;
    result.units.push(row);
  }
  return result;
}

function frozenStageData(pkg: AnalysisPackage, stage: Stage): unknown {
  if (stage === 'claims') return { claims: pkg.claims, coverage: pkg.coverage };
  if (stage === 'plan') return pkg.questions;
  if (stage === 'evidence') return pkg.sources.map(({ data: _derived, ...source }) => source);
  if (stage === 'relations') return { data: pkg.sources.map(s => ({ id: s.id, data: s.data })), relations: pkg.relations };
  throw new Error('invalid_stage');
}
/** A replay is a fresh exploratory run, never an imported qualification or spent budget. */
export async function createReplayRun(pkg: AnalysisPackage, config: ModelConfig, track: ReplayTrack, budget?: AnalysisBudget): Promise<RunCheckpoint> {
  assertPackage(pkg);
  if (track !== 'extraction' && track !== 'rating') throw new Error('invalid_track');
  if (pkg.methodVersion !== METHOD_VERSION) throw new Error('method_changed');
  const relevant = track === 'rating' ? FROZEN_STAGES : [];
  for (const key of ['snapshot', ...relevant]) {
    const declared = pkg.provenance.stageHashes[key];
    if (declared && declared !== await hashValue(key === 'snapshot' ? pkg.snapshot : frozenStageData(pkg, key as Stage))) throw new Error('frozen_input_changed');
  }
  const job = createRun(pkg.snapshot, config, budget);
  job.package.provenance.stageHashes.snapshot = await hashValue(pkg.snapshot);
  if (track === 'rating') {
    for (const key of ['claims', 'coverage', 'questions', 'sources', 'relations'] as const) Object.assign(job.package, { [key]: structuredClone(pkg[key]) });
    for (const stage of FROZEN_STAGES) job.package.provenance.stageHashes[stage] = await hashValue(frozenStageData(job.package, stage));
    job.completedStages = [...FROZEN_STAGES]; job.stage = 'replies';
  }
  assertPackage(job.package); return job;
}

export interface CalibrationThresholds {
  repetitions: number; minCases: number; minCasesPerTrack: number; minDeterminatePerDimension: number;
  minReferenceAgreement: number; minDeterminateAgreement: number; minDeterminateCoverage: number;
  minExtractionSpanRecall: number; minExtractionSpanPrecision: number; minExtractionStructureAgreement: number;
  minRepeatAgreement: number; maxFailedRuns: number;
}
/** Trial starting thresholds, not a claim of statistical sufficiency or independent expert validation. */
export const DEFAULT_CALIBRATION_THRESHOLDS: CalibrationThresholds = {
  repetitions: 3, minCases: 6, minCasesPerTrack: 3, minDeterminatePerDimension: 3,
  minReferenceAgreement: 0.9, minDeterminateAgreement: 0.9, minDeterminateCoverage: 0.9,
  minExtractionSpanRecall: 0.95, minExtractionSpanPrecision: 0.95, minExtractionStructureAgreement: 0.9,
  minRepeatAgreement: 0.9, maxFailedRuns: 0,
};
export interface CalibrationCase { id: string; track: ReplayTrack; stratum: string; reference: AnalysisPackage }
export interface CalibrationSuiteInput { id: string; methodVersion: string; referenceLabel: string; developmentInputHashes: string[]; thresholds: CalibrationThresholds; cases: CalibrationCase[] }
export interface FrozenCalibrationSuite extends CalibrationSuiteInput { hash: string; frozenAt: string }
export async function configurationFingerprint(input: ModelConfig): Promise<string> {
  const config = normalizeModelConfig(input);
  return hashValue({ endpoint: config.baseUrl, model: config.model, declaredVersion: config.declaredVersion, temperature: config.temperature, maxOutputTokens: config.maxOutputTokens, transport: 'chat-completions-v1', toolPolicy: 'fixed-input-no-model-tools-v1', pipelineVersion: 'trial-source-structure-v4' });
}
export async function calibrationInputHash(pkg: AnalysisPackage, track: ReplayTrack): Promise<string> {
  assertPackage(pkg);
  if (track === 'extraction') return hashValue({ method: pkg.methodVersion, snapshot: pkg.snapshot });
  if (track === 'rating') return hashValue({ method: pkg.methodVersion, snapshot: pkg.snapshot, claims: pkg.claims, coverage: pkg.coverage, questions: pkg.questions, sources: pkg.sources, relations: pkg.relations });
  throw new Error('invalid_track');
}
/** Store this hash for development materials so renaming a case or changing tracks cannot turn it into holdout data. */
export async function calibrationMaterialHash(pkg: AnalysisPackage): Promise<string> {
  assertPackage(pkg);
  return hashValue(pkg.snapshot.messages.map(m => ({ kind: m.kind, text: m.text.replace(/\s+/g, ' ').trim(), links: m.links, imageCount: m.imageCount })));
}
const suitePayload = (input: CalibrationSuiteInput, frozenAt: string): CalibrationSuiteInput & { frozenAt: string } => ({ id: input.id, methodVersion: input.methodVersion, referenceLabel: input.referenceLabel, developmentInputHashes: structuredClone(input.developmentInputHashes), thresholds: structuredClone(input.thresholds), cases: structuredClone(input.cases), frozenAt });
function validateThresholds(t: CalibrationThresholds) {
  for (const key of ['repetitions', 'minCases', 'minCasesPerTrack', 'minDeterminatePerDimension', 'maxFailedRuns'] as const) if (!Number.isSafeInteger(t[key]) || t[key] < (key === 'maxFailedRuns' ? 0 : key === 'repetitions' || key === 'minCases' ? 2 : 1) || t[key] > 500) throw new Error('invalid_thresholds');
  for (const key of ['minReferenceAgreement', 'minDeterminateAgreement', 'minDeterminateCoverage', 'minExtractionSpanRecall', 'minExtractionSpanPrecision', 'minExtractionStructureAgreement', 'minRepeatAgreement'] as const) if (!Number.isFinite(t[key]) || t[key] <= 0 || t[key] > 1) throw new Error('invalid_thresholds');
}
/** Answers and thresholds are frozen before executions; changing either invalidates the suite hash. */
async function validateSuite(input: CalibrationSuiteInput): Promise<void> {
  validateThresholds(input.thresholds);
  if (!input.id.trim() || !input.referenceLabel.trim() || input.methodVersion !== METHOD_VERSION || !input.cases.length || input.cases.length > 500) throw new Error('invalid_suite');
  const ids = new Set<string>(); const materialHashes = new Set<string>();
  for (const item of input.cases) {
    assertPackage(item.reference);
    if (!item.id.trim() || !item.stratum.trim() || ids.has(item.id)) throw new Error('duplicate_case'); ids.add(item.id);
    if (item.reference.methodVersion !== input.methodVersion) throw new Error('method_changed');
    const inputHash = await calibrationInputHash(item.reference, item.track);
    const materialHash = await calibrationMaterialHash(item.reference);
    if (materialHashes.has(materialHash)) throw new Error('duplicate_material'); materialHashes.add(materialHash);
    if (input.developmentInputHashes.includes(inputHash) || input.developmentInputHashes.includes(materialHash) || input.developmentInputHashes.includes(await calibrationInputHash(item.reference, 'extraction')) || input.developmentInputHashes.includes(await calibrationInputHash(item.reference, 'rating'))) throw new Error('development_overlap');
    if (item.track === 'rating') {
      const self = await compareRatings(item.reference, item.reference);
      if (self.counts.missingLeft || self.counts.invalidUnits || self.unexpectedLeft.length) throw new Error('reference_incomplete');
    }
  }
  if (input.cases.length < input.thresholds.minCases || (['extraction', 'rating'] as const).some(track => input.cases.filter(c => c.track === track).length < input.thresholds.minCasesPerTrack)) throw new Error('insufficient_cases');
}
export async function freezeCalibrationSuite(input: CalibrationSuiteInput): Promise<FrozenCalibrationSuite> {
  await validateSuite(input);
  const payload = suitePayload(input, new Date().toISOString());
  return { ...payload, hash: await hashValue(payload) };
}

/** Stored only by the trusted background transport after real calls; never decoded from an imported report. */
export interface CalibrationExecutionReceipt {
  id: string; suiteHash: string; caseId: string; repetition: number; configurationHash: string;
  inputHash: string; outputHash: string | null; output: AnalysisPackage | null; runId: string;
  methodVersion: string; startedAt: string; finishedAt: string;
  status: 'completed' | 'failed' | 'cancelled'; providerModel: string | null; transport: 'chat-completions-v1';
  requestIds: string[]; usage: { calls: number; inputTokens: number | null; outputTokens: number | null }; errorCode: string | null;
}
/** This callback must read the background-only local receipt ledger, not history/imported AnalysisPackage data. */
export type ReadTrustedCalibrationReceipt = (receiptId: string) => Promise<CalibrationExecutionReceipt | null>;
function receiptShape(value: unknown): value is CalibrationExecutionReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const fields = ['id', 'suiteHash', 'caseId', 'repetition', 'configurationHash', 'inputHash', 'outputHash', 'output', 'runId', 'methodVersion', 'startedAt', 'finishedAt', 'status', 'providerModel', 'transport', 'requestIds', 'usage', 'errorCode'];
  if (!same(Object.keys(item).sort(), fields.sort())) return false;
  if (!['id', 'suiteHash', 'caseId', 'configurationHash', 'inputHash', 'runId', 'methodVersion', 'startedAt', 'finishedAt'].every(k => typeof item[k] === 'string')) return false;
  if (typeof item.repetition !== 'number' || !['completed', 'failed', 'cancelled'].includes(item.status as string)) return false;
  if (!['outputHash', 'providerModel', 'errorCode'].every(k => item[k] === null || typeof item[k] === 'string')) return false;
  if (!Array.isArray(item.requestIds) || !item.requestIds.every(id => typeof id === 'string') || !item.usage || typeof item.usage !== 'object' || Array.isArray(item.usage)) return false;
  const usage = item.usage as Record<string, unknown>;
  return same(Object.keys(usage).sort(), ['calls', 'inputTokens', 'outputTokens']) && typeof usage.calls === 'number' && ['inputTokens', 'outputTokens'].every(k => usage[k] === null || typeof usage[k] === 'number');
}

export interface Fraction { numerator: number; denominator: number; rate: number | null }
const fraction = (numerator = 0, denominator = 0): Fraction => ({ numerator, denominator, rate: denominator ? numerator / denominator : null });
const add = (value: Fraction, numerator: number, denominator: number) => { value.numerator += numerator; value.denominator += denominator; value.rate = value.denominator ? value.numerator / value.denominator : null; };
export interface QualificationRecord {
  id: string; status: 'qualified_trial' | 'not_qualified'; createdAt: string; configurationHash: string; methodVersion: string; suiteHash: string; providerModel: string | null;
  referenceLabel: string; thresholds: CalibrationThresholds; expectedRuns: number; acceptedRuns: number; receiptIds: string[];
  failures: { receiptId: string; caseId: string | null; repetition: number | null; code: string }[]; reasons: string[];
  metrics: {
    dimensions: Record<DimensionKey, { referenceAgreement: Fraction; determinateAgreement: Fraction; determinateCoverage: Fraction; repeatAgreement: Fraction }>;
    extraction: { spanRecall: Fraction; spanPrecision: Fraction; structureAgreement: Fraction; repeatAgreement: Fraction };
    strata: Record<string, { cases: number; expectedRuns: number; acceptedRuns: number; referenceAgreement: Fraction }>;
    usage: { calls: number; inputTokens: number | null; outputTokens: number | null };
  };
  limitations: string[];
}
function spanCovered(span: TextSpan, claims: Claim[]): boolean {
  const ranges = claims.flatMap(c => c.spans).filter(s => s.messageId === span.messageId && s.end > span.start && s.start < span.end).sort((a, b) => a.start - b.start);
  let end = span.start;
  for (const range of ranges) { if (range.start > end) return false; end = Math.max(end, range.end); if (end >= span.end) return true; }
  return false;
}
function extractionMetrics(reference: AnalysisPackage, output: AnalysisPackage) {
  const covers = (a: Claim, bs: Claim[]) => a.spans.every(span => spanCovered(span, bs.filter(b => b.authorId === a.authorId)));
  const structural = (a: Claim, b: Claim) => same(claimSpans(a), claimSpans(b)) && a.authorId === b.authorId && a.kind === b.kind && a.adoption === b.adoption && same(Object.entries(a.qualifiers).sort(), Object.entries(b.qualifiers).sort()) && same(sorted(a.contextRefs), sorted(b.contextRefs));
  return { recall: reference.claims.filter(c => covers(c, output.claims)).length, recallTotal: reference.claims.length, precision: output.claims.filter(c => covers(c, reference.claims)).length, precisionTotal: output.claims.length, structure: reference.claims.filter(c => output.claims.some(other => structural(c, other))).length, structureTotal: reference.claims.length };
}
/** Semantic agreement is against the frozen labelled reference, independently of cross-model agreement. */
export async function assessQualification(suite: FrozenCalibrationSuite, input: ModelConfig, receiptIds: string[], readTrustedReceipt: ReadTrustedCalibrationReceipt): Promise<QualificationRecord> {
  if (await hashValue(suitePayload(suite, suite.frozenAt)) !== suite.hash) throw new Error('suite_integrity');
  await validateSuite(suite);
  if (suite.methodVersion !== METHOD_VERSION) throw new Error('method_changed');
  const config = normalizeModelConfig(input); const configurationHash = await configurationFingerprint(config);
  const result: QualificationRecord = {
    id: crypto.randomUUID(), status: 'not_qualified', createdAt: new Date().toISOString(), configurationHash, methodVersion: suite.methodVersion, suiteHash: suite.hash, providerModel: null,
    referenceLabel: suite.referenceLabel, thresholds: structuredClone(suite.thresholds), expectedRuns: suite.cases.length * suite.thresholds.repetitions, acceptedRuns: 0, receiptIds: [], failures: [], reasons: [],
    metrics: { dimensions: Object.fromEntries(DIMENSIONS.map(d => [d, { referenceAgreement: fraction(), determinateAgreement: fraction(), determinateCoverage: fraction(), repeatAgreement: fraction() }])) as QualificationRecord['metrics']['dimensions'], extraction: { spanRecall: fraction(), spanPrecision: fraction(), structureAgreement: fraction(), repeatAgreement: fraction() }, strata: Object.create(null), usage: { calls: 0, inputTokens: 0, outputTokens: 0 } },
    limitations: ['本机回执由受信后台保管；导入文件中的 standard 标记不构成本机准入。', '参考一致率衡量规则执行，不代表事实正确率；该参考标签不证明独立人工专家审阅。', '样本规模与预设阈值仅覆盖本轮留出集，不能保证所有新帖可靠。', '服务返回的模型名称和版本声明不能证明聚合平台隐藏后端恒定；发现路由或参数变化须重新校准。'],
  };
  const seenReceiptIds = new Set<string>(); const seenRunIds = new Set<string>(); const seenRequestIds = new Set<string>(); const seenSlots = new Set<string>(); const outputs = new Map<string, AnalysisPackage>(); const backends = new Set<string>();
  const fail = (receiptId: string, receipt: CalibrationExecutionReceipt | null, code: string) => result.failures.push({ receiptId, caseId: receipt?.caseId ?? null, repetition: receipt?.repetition ?? null, code });
  for (const receiptId of receiptIds) {
    if (seenReceiptIds.has(receiptId)) { fail(receiptId, null, 'duplicate_receipt'); continue; } seenReceiptIds.add(receiptId);
    const receipt = await readTrustedReceipt(receiptId);
    if (!receipt) { fail(receiptId, null, 'receipt_missing'); continue; }
    if (!receiptShape(receipt)) { fail(receiptId, null, 'receipt_structure'); continue; }
    const item = suite.cases.find(c => c.id === receipt.caseId);
    let code = '';
    if (receipt.id !== receiptId) code = 'receipt_identity';
    else if (receipt.suiteHash !== suite.hash) code = 'suite_mismatch';
    else if (!item || !Number.isInteger(receipt.repetition) || receipt.repetition < 1 || receipt.repetition > suite.thresholds.repetitions) code = 'case_mismatch';
    else if (receipt.configurationHash !== configurationHash || receipt.transport !== 'chat-completions-v1') code = 'configuration_mismatch';
    else if (receipt.methodVersion !== suite.methodVersion) code = 'method_mismatch';
    else if (receipt.inputHash !== await calibrationInputHash(item.reference, item.track)) code = 'input_mismatch';
    else if (!Number.isFinite(Date.parse(receipt.startedAt)) || !Number.isFinite(Date.parse(receipt.finishedAt)) || Date.parse(receipt.startedAt) < Date.parse(suite.frozenAt) || Date.parse(receipt.finishedAt) < Date.parse(receipt.startedAt)) code = 'execution_time';
    else if (!receipt.runId || seenRunIds.has(receipt.runId) || !receipt.requestIds.length || new Set(receipt.requestIds).size !== receipt.requestIds.length || receipt.requestIds.some(id => !id || seenRequestIds.has(id))) code = 'reused_execution';
    else if (!Number.isSafeInteger(receipt.usage.calls) || receipt.usage.calls < 1 || receipt.usage.calls < receipt.requestIds.length || [receipt.usage.inputTokens, receipt.usage.outputTokens].some(n => n !== null && (!Number.isSafeInteger(n) || n < 0))) code = 'invalid_usage';
    const slot = `${receipt.caseId}:${receipt.repetition}`;
    if (!code && seenSlots.has(slot)) code = 'duplicate_slot';
    if (code) { fail(receiptId, receipt, code); continue; }
    seenSlots.add(slot); seenRunIds.add(receipt.runId); receipt.requestIds.forEach(id => seenRequestIds.add(id)); result.receiptIds.push(receiptId);
    result.metrics.usage.calls += receipt.usage.calls;
    for (const key of ['inputTokens', 'outputTokens'] as const) result.metrics.usage[key] = result.metrics.usage[key] === null || receipt.usage[key] === null ? null : result.metrics.usage[key]! + receipt.usage[key]!;
    if (receipt.status !== 'completed') { fail(receiptId, receipt, 'execution_failed'); continue; }
    if (!receipt.output || !receipt.outputHash || await hashValue(receipt.output) !== receipt.outputHash) { fail(receiptId, receipt, 'output_integrity'); continue; }
    try { assertPackage(receipt.output); } catch { fail(receiptId, receipt, 'output_structure'); continue; }
    const p = receipt.output.provenance;
    if (receipt.output.id !== receipt.runId || receipt.output.methodVersion !== suite.methodVersion || receipt.output.status !== 'completed' || p.endpoint !== config.baseUrl || p.model !== config.model || p.declaredVersion !== config.declaredVersion || p.parameters.temperature !== config.temperature || p.parameters.maxOutputTokens !== config.maxOutputTokens || p.providerModel !== receipt.providerModel) { fail(receiptId, receipt, 'output_configuration'); continue; }
    if (await calibrationInputHash(receipt.output, item!.track) !== receipt.inputHash) { fail(receiptId, receipt, 'output_input_changed'); continue; }
    if (item!.track === 'rating') {
      const comparison = await compareRatings(item!.reference, receipt.output);
      if (comparison.counts.missingRight || comparison.counts.invalidUnits || comparison.unexpectedRight.length) { fail(receiptId, receipt, 'output_incomplete'); continue; }
    }
    if (receipt.providerModel) backends.add(receipt.providerModel); else result.reasons.push('provider_model_unknown');
    outputs.set(slot, receipt.output); result.acceptedRuns++;
  }
  for (const item of suite.cases) {
    const stratum = result.metrics.strata[item.stratum] ??= { cases: 0, expectedRuns: 0, acceptedRuns: 0, referenceAgreement: fraction() };
    stratum.cases++; stratum.expectedRuns += suite.thresholds.repetitions;
    const referenceUnits = item.track === 'rating' ? item.reference.evaluations : [];
    for (let repetition = 1; repetition <= suite.thresholds.repetitions; repetition++) {
      const slot = `${item.id}:${repetition}`; const output = outputs.get(slot);
      if (!seenSlots.has(slot)) fail('', null, `missing_run:${slot}`);
      if (output) stratum.acceptedRuns++;
      if (item.track === 'rating') {
        for (const evaluation of referenceUnits) for (const dim of DIMENSIONS) {
          const candidate = output?.evaluations.find(e => unitKey(e) === unitKey(evaluation)); const expected = dimensionState(evaluation.dimensions[dim]); const observed = candidate ? dimensionState(candidate.dimensions[dim]) : null;
          add(result.metrics.dimensions[dim].referenceAgreement, expected === observed ? 1 : 0, 1); add(stratum.referenceAgreement, expected === observed ? 1 : 0, 1);
          if (/^[012]$/.test(expected)) {
            add(result.metrics.dimensions[dim].determinateCoverage, observed !== null && /^[012]$/.test(observed) ? 1 : 0, 1);
            // Correct NA/P/U labels cannot dilute errors on reference items that require a numeric grade.
            add(result.metrics.dimensions[dim].determinateAgreement, expected === observed ? 1 : 0, 1);
          }
          if (repetition > 1) {
            const first = outputs.get(`${item.id}:1`)?.evaluations.find(e => unitKey(e) === unitKey(evaluation));
            add(result.metrics.dimensions[dim].repeatAgreement, observed !== null && first && dimensionState(first.dimensions[dim]) === observed ? 1 : 0, 1);
          }
        }
      } else {
        const score = output ? extractionMetrics(item.reference, output) : { recall: 0, recallTotal: item.reference.claims.length, precision: 0, precisionTotal: item.reference.claims.length, structure: 0, structureTotal: item.reference.claims.length };
        add(result.metrics.extraction.spanRecall, score.recall, score.recallTotal); add(result.metrics.extraction.spanPrecision, score.precision, score.precisionTotal); add(result.metrics.extraction.structureAgreement, score.structure, score.structureTotal); add(stratum.referenceAgreement, score.structure, score.structureTotal);
        if (repetition > 1) {
          const first = outputs.get(`${item.id}:1`); const repeat = first && output ? await compareExtractions(first, output) : null;
          const sameExtraction = repeat?.comparable && !repeat.leftOnly.length && !repeat.rightOnly.length && repeat.groups.every(g => g.kind === 'matched' && g.changes.every(c => c === 'wording_needs_review'));
          add(result.metrics.extraction.repeatAgreement, sameExtraction ? 1 : 0, 1);
        }
      }
    }
  }
  if (!config.declaredVersion.trim()) result.reasons.push('declared_version_missing');
  const threshold = (metric: Fraction, minimum: number, reason: string) => { if (metric.rate === null || metric.rate < minimum) result.reasons.push(reason); };
  for (const dim of DIMENSIONS) {
    const metric = result.metrics.dimensions[dim];
    if (metric.determinateCoverage.denominator / suite.thresholds.repetitions < suite.thresholds.minDeterminatePerDimension) result.reasons.push(`insufficient_determinate:${dim}`);
    threshold(metric.referenceAgreement, suite.thresholds.minReferenceAgreement, `reference_agreement:${dim}`);
    threshold(metric.determinateCoverage, suite.thresholds.minDeterminateCoverage, `determinate_coverage:${dim}`);
    threshold(metric.determinateAgreement, suite.thresholds.minDeterminateAgreement, `determinate_agreement:${dim}`);
    threshold(metric.repeatAgreement, suite.thresholds.minRepeatAgreement, `repeat_agreement:${dim}`);
  }
  threshold(result.metrics.extraction.spanRecall, suite.thresholds.minExtractionSpanRecall, 'extraction_recall');
  threshold(result.metrics.extraction.spanPrecision, suite.thresholds.minExtractionSpanPrecision, 'extraction_precision');
  threshold(result.metrics.extraction.structureAgreement, suite.thresholds.minExtractionStructureAgreement, 'extraction_structure');
  threshold(result.metrics.extraction.repeatAgreement, suite.thresholds.minRepeatAgreement, 'extraction_repeat');
  if (result.failures.length > suite.thresholds.maxFailedRuns) result.reasons.push('failed_runs');
  if (result.acceptedRuns !== result.expectedRuns) result.reasons.push('incomplete_matrix');
  if (backends.size > 1) result.reasons.push('provider_model_drift');
  result.providerModel = backends.size === 1 ? [...backends][0]! : null;
  result.reasons = [...new Set(result.reasons)]; if (!result.reasons.length) result.status = 'qualified_trial';
  return result;
}
/** Convenience invalidation check only: callers must obtain this record from the local trusted ledger. */
export async function qualificationMatches(record: QualificationRecord, config: ModelConfig, methodVersion: string, suiteHash: string): Promise<boolean> {
  try {
    return record.status === 'qualified_trial' && record.methodVersion === methodVersion && record.methodVersion === METHOD_VERSION && record.suiteHash === suiteHash && record.configurationHash === await configurationFingerprint(config);
  } catch { return false; }
}
