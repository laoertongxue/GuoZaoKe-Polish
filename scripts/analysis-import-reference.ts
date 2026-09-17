/** Development-only adapter. The reference ledger is not a held-out set or an evidence archive. */
import { createHash } from 'node:crypto';
import { assertPackage, hashValue } from '../src/analysis/contracts';
import { METHOD_VERSION, type AnalysisPackage, type Claim, type EvidenceSource, type TextSpan } from '../src/analysis/types';

interface LegacyReply { id: string; participant_id: string; text: string; floor_at_snapshot: number; sha256: string }
export interface LegacySnapshot {
  snapshot_id: string; url: string; title: string; freeze_recorded_at: string; content_sha256: string;
  original_post_date: string | null; date_limitation: string;
  op: { participant_id: string; text: string }; replies: LegacyReply[]; current_reply_count: number; completeness: string;
  external_links_in_replies: { reply_id: string; url: string; access: string }[];
  cache_discrepancy?: { web_cache_count: number; current_dom_count: number; policy: string };
}
interface LegacySpan { reply_id?: string; start: number; end: number; sha256: string }
interface ScopeSlot { state: string; value: string | null }
export interface LegacyClaim {
  id: string; reply_id: string; participant: string; type: string; question: string; claim: string;
  status: string; reason: string; evidence_ids: string[]; modality: string;
  span_start: number; span_end: number; span_sha256: string; anchor_span: LegacySpan; supporting_spans: LegacySpan[];
  scope: Record<string, ScopeSlot>;
}
export interface LegacyAnalysis {
  id: string; rules_version: string; snapshot_id: string; snapshot_sha256: string; purpose: string;
  claims: LegacyClaim[];
  questions: Record<string, { question: string; required: string; target: string; stop: string; display: string }>;
  evidence: { id: string; title: string; date: string | null; url: string; source_type: string; access: string; limits: string; locator: string; independence_group: string; methods: string }[];
  facts: { id: string; metric: string; source_id: string }[];
  remaining_gaps: string[];
}
export interface ReferenceImportAudit {
  use: 'development-regression-not-independent-holdout'; referenceId: string; snapshotContentHash: string;
  inputFingerprints: { snapshot: string; analysis: string }; packageHash: string;
  messagesImported: number; claimsImported: number; sourceStatusCounts: Record<EvidenceSource['status'], number>;
  numericFactsOmitted: string[]; ratingsImported: 0; unMappedNonWhitespaceSpans: number;
  warnings: string[];
}

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
// The legacy Python freeze used ensure_ascii=False, sort_keys=True and default separators.
function pythonJSON(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pythonJSON).join(', ')}]`;
  if (typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}: ${pythonJSON((value as Record<string, unknown>)[k])}`).join(', ')}}`;
  throw new Error('reference_structure: unsupported legacy value');
}
export function legacySnapshotHash(snapshot: LegacySnapshot): string {
  return sha(pythonJSON({ op: snapshot.op, replies: snapshot.replies }));
}

function classification(claim: LegacyClaim): Pick<Claim, 'kind' | 'adoption'> {
  if (['question', 'reasoning_question', 'wish_and_question'].includes(claim.modality)) return { kind: 'question', adoption: 'questioned' };
  if (claim.modality === 'value_judgment') return { kind: 'value', adoption: 'asserted' };
  if (['prediction', 'tentative'].includes(claim.modality)) return { kind: 'hypothesis', adoption: 'uncertain' };
  if (claim.modality === 'conditional_test' || ['推理检验', '口径澄清', '机制论证', '条件推导', '推论', '推论数值', '模式推断', '因果解释', '因果断言'].includes(claim.type)) return { kind: 'reasoning', adoption: 'asserted' };
  if (['个人习惯', '个人经历', '个人观察', '个案数值', '个案数量', '体验判断', '经验比较'].includes(claim.type)) return { kind: 'experience', adoption: 'asserted' };
  if (['asserted', 'estimate_or_reported_value'].includes(claim.modality)) return { kind: 'empirical', adoption: 'asserted' };
  return { kind: 'uncertain', adoption: 'uncertain' };
}

export async function convertReference(raw: LegacySnapshot, legacy: LegacyAnalysis): Promise<{ package: AnalysisPackage; audit: ReferenceImportAudit }> {
  if (legacySnapshotHash(raw) !== raw.content_sha256) throw new Error('snapshot_fingerprint: frozen original text changed');
  if (legacy.snapshot_id !== raw.snapshot_id || legacy.snapshot_sha256 !== raw.content_sha256) throw new Error('reference_snapshot: ledger belongs to another snapshot');
  if (legacy.rules_version !== METHOD_VERSION) throw new Error('reference_method: explicit migration needed for this method version');
  if (raw.original_post_date !== null) throw new Error('reference_date: this adapter only covers the undated 121894 snapshot');
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw.freeze_recorded_at) || !Number.isFinite(Date.parse(raw.freeze_recorded_at))) throw new Error('reference_date: invalid freeze date');
  const rawMessages = [{ id: 'OP', participant_id: raw.op.participant_id, text: raw.op.text, floor_at_snapshot: null }, ...raw.replies];
  const messageMap = new Map(rawMessages.map(m => [m.id, m]));
  if (messageMap.size !== rawMessages.length) throw new Error('reference_identity: duplicate message id');
  for (const reply of raw.replies) if (sha(reply.text) !== reply.sha256) throw new Error(`reply_fingerprint: ${reply.id}`);
  const participant = (id: string) => id === 'OP' ? 'P00' : id;
  const idFor = (id: string) => id === 'OP' ? 'topic-121894' : `reply-${id}`;
  const messages: AnalysisPackage['snapshot']['messages'] = rawMessages.map(message => ({
    id: idFor(message.id), authorId: participant(message.participant_id), kind: message.id === 'OP' ? 'topic' : 'reply',
    floor: message.floor_at_snapshot, text: message.text, publishedAt: null,
    displayedTime: message.id === 'OP' ? '1年前（旧快照仅记录此相对时间）' : '',
    links: raw.external_links_in_replies.filter(link => link.reply_id === message.id).map(link => ({ url: link.url, label: '' })),
    imageCount: 0, stableId: true,
  }));
  for (const link of raw.external_links_in_replies) {
    if (!messageMap.get(link.reply_id)?.text.includes(link.url)) throw new Error(`reference_link: ${link.reply_id}`);
  }
  const checkedSpan = (claim: LegacyClaim, span: LegacySpan): TextSpan => {
    const message = messageMap.get(claim.reply_id);
    const chars = Array.from(message?.text ?? '');
    const quote = chars.slice(span.start, span.end).join('');
    if (!message || (span.reply_id && span.reply_id !== claim.reply_id) || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)
      || span.start < 0 || span.end <= span.start || span.end > chars.length || sha(quote) !== span.sha256) throw new Error(`span_integrity: ${claim.id}`);
    return { messageId: idFor(claim.reply_id), start: span.start, end: span.end, quote };
  };
  const claims: Claim[] = legacy.claims.map(claim => {
    const message = messageMap.get(claim.reply_id);
    if (!message || message.participant_id !== claim.participant) throw new Error(`claim_owner: ${claim.id}`);
    if (!claim.supporting_spans.length) throw new Error(`span_integrity: ${claim.id} has no supporting span`);
    const support = claim.supporting_spans.map(span => checkedSpan(claim, span));
    const anchor = checkedSpan(claim, claim.anchor_span);
    checkedSpan(claim, { start: claim.span_start, end: claim.span_end, sha256: claim.span_sha256 });
    if (claim.anchor_span.start !== claim.span_start || claim.anchor_span.end !== claim.span_end || claim.anchor_span.sha256 !== claim.span_sha256
      || !support.some(span => span.start <= anchor.start && span.end >= anchor.end)) throw new Error(`span_integrity: ${claim.id} anchor outside supporting text`);
    const spans = support.some(span => span.start === anchor.start && span.end === anchor.end) ? support : [...support, anchor];
    const slot = (key: string) => claim.scope[key]?.state === 'not_stated' ? '' : claim.scope[key]?.value ?? '';
    return {
      id: claim.id, authorId: participant(claim.participant), messageId: idFor(claim.reply_id), text: claim.claim,
      ...classification(claim), spans,
      qualifiers: { population: [slot('subject'), slot('region') && `地区：${slot('region')}`].filter(Boolean).join('；'), time: slot('time'), metric: slot('metric'), unit: slot('unit'), quantifier: slot('quantifier'), conditions: slot('conditions') },
      contextRefs: [],
      uncertainty: ['沿用旧样板的主张归纳与范围字段，未重新运行模型或独立语义审阅。', `原类型：${claim.type}；语气：${claim.modality}；极性：${slot('polarity') || '未标注'}`, `原样板处置（非本次核验结论）：${claim.status}。${claim.reason}`],
    };
  });
  const coverage: AnalysisPackage['coverage'] = [];
  for (const message of messages) {
    const localClaims = claims.filter(claim => claim.messageId === message.id);
    const length = Array.from(message.text).length;
    const bounds = [...new Set([0, length, ...localClaims.flatMap(c => c.spans.flatMap(s => [s.start, s.end]))])].sort((a, b) => a - b);
    for (let i = 0; i < bounds.length - 1; i++) {
      const start = bounds[i]!; const end = bounds[i + 1]!; const quote = Array.from(message.text).slice(start, end).join('');
      if (!quote.trim()) continue;
      const claimIds = localClaims.filter(c => c.spans.some(s => s.start <= start && s.end >= end)).map(c => c.id);
      coverage.push({ span: { messageId: message.id, start, end, quote }, claimIds, disposition: claimIds.length ? 'claim' : 'uncertain', reason: claimIds.length ? '由旧样板完整支持范围覆盖；跨度相同不代表语义等价。' : '旧样板没有为该片段提供可验证映射，保留待审。' });
    }
  }
  const sources: EvidenceSource[] = legacy.evidence.map(source => {
    const occurrences = messages.filter(message => message.links.some(link => link.url === source.url));
    const owner = occurrences[0];
    return {
      id: source.id, url: source.url, title: source.title, publisher: source.source_type, publishedAt: source.date,
      retrievedAt: raw.freeze_recorded_at, status: /未取得|访问失败|不可核验|不可读/.test(source.access) ? 'unreadable' : 'lead',
      kind: /\.pdf(?:$|\?)/i.test(source.url) ? 'pdf' : 'html', text: '', locator: source.locator,
      rootId: source.id, introducedBy: owner?.authorId ?? 'system', introducedAtMessageId: owner?.id ?? null,
      limitations: ['本次仅导入旧来源登记，未读取或保存原件正文；旧“已读”说明不是可复现的读取凭据。', 'retrievedAt 沿用材料冻结时间，不代表本次远程访问时间。', source.limits, `旧访问记录：${source.access}`, `旧来源分组：${source.independence_group}；没有可比原件，未自动认定独立或同源。`, source.methods],
      data: [],
    };
  });
  const sourceMap = new Map(sources.map(s => [s.id, s]));
  const relations: AnalysisPackage['relations'] = legacy.claims.flatMap(claim => claim.evidence_ids.map((sourceId, index) => {
    if (!sourceMap.has(sourceId)) throw new Error(`reference_source: ${claim.id} ${sourceId}`);
    return { id: `${claim.id}-${sourceId}-${index}`, claimId: claim.id, sourceId, status: 'unresolved', excerpt: '', reason: '旧样板曾关联此来源，本次没有可重读的原件正文及精确摘录，不迁移原支持/反驳结论。' };
  }));
  const unknownCoverage = coverage.filter(c => c.disposition === 'uncertain').length;
  const warnings = [
    '这是已用于方法开发的真实帖回归材料，不是独立留出、人工专家认证或跨模型实测。',
    '未执行任何模型、搜索、网页或 PDF 请求；未迁移旧样板回复评级。',
    '全部外部来源没有原件正文，数据表为空；旧事实及来源支持关系不能作为本次已核验结论。',
    '回复正文保留原始提及与链接以验证坐标；作者字段为本帖代号，不宣称正文完全匿名。',
    '旧快照没有图片数量清单；imageCount=0 仅代表此次没有导入图片，不证明原帖不存在图片。',
    '主张范围与分类沿用旧样板；没有固定语境关系的机器可复现映射，因此 contextRefs 留空并待复核。',
  ];
  const gaps = [raw.completeness, raw.date_limitation, warnings[4]!, ...(raw.cache_discrepancy ? [`旧缓存 ${raw.cache_discrepancy.web_cache_count} 条，当前采集 ${raw.cache_discrepancy.current_dom_count} 条；${raw.cache_discrepancy.policy}`] : [])];
  if (raw.replies.length !== raw.current_reply_count) gaps.push(`本材料仅含 ${raw.replies.length}/${raw.current_reply_count} 条当前页面回复。`);
  const pkg: AnalysisPackage = {
    formatVersion: 1, methodVersion: METHOD_VERSION, id: `development-${legacy.id}`, createdAt: raw.freeze_recorded_at,
    snapshot: { id: raw.snapshot_id, topicId: '121894', url: raw.url, title: raw.title, capturedAt: raw.freeze_recorded_at, messages,
      pages: [{ url: raw.url, status: 'read', messageIds: messages.map(m => m.id), error: null }], expectedReplies: raw.current_reply_count, completeness: 'partial', gaps },
    claims, coverage,
    questions: Object.entries(legacy.questions).map(([id, question]) => ({ id, claimIds: claims.filter(c => legacy.claims.find(l => l.id === c.id)?.question === id).map(c => c.id), question: question.question, needed: [question.target, question.required, `停止条件：${question.stop}`], disagreement: 'insufficient_context',plan:null })),
    sources, relations, evaluations: [],
    provenance: { mode: 'exploratory', modelConfigId: 'development-reference-import', endpoint: 'https://example.invalid/no-model-invocation', model: 'not-run', providerModel: null, declaredVersion: 'legacy-reference-adapter-1', parameters: { temperature: 0, maxOutputTokens: 0 }, stageHashes: {}, qualificationId: null },
    status: 'partial', unresolved: [...legacy.remaining_gaps, ...warnings, `未迁移旧事实 ${legacy.facts.map(f => f.id).join('、') || '无'}：缺少可校验的原件与摘录。`, `未映射原文 ${unknownCoverage} 个非空片段；未将其擅自标为无主张或无意义。`],
  };
  pkg.provenance.stageHashes.snapshot = await hashValue(pkg.snapshot);
  pkg.provenance.stageHashes.claims = await hashValue({ claims: pkg.claims, coverage: pkg.coverage });
  assertPackage(pkg);
  return { package: pkg, audit: {
    use: 'development-regression-not-independent-holdout', referenceId: legacy.id, snapshotContentHash: raw.content_sha256,
    inputFingerprints: { snapshot: await hashValue(raw), analysis: await hashValue(legacy) }, packageHash: await hashValue(pkg),
    messagesImported: messages.length, claimsImported: claims.length,
    sourceStatusCounts: { read: 0, lead: sources.filter(s => s.status === 'lead').length, unreadable: sources.filter(s => s.status === 'unreadable').length },
    numericFactsOmitted: legacy.facts.map(f => f.id), ratingsImported: 0, unMappedNonWhitespaceSpans: unknownCoverage, warnings,
  } };
}
