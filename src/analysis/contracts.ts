import type { AnalysisPackage, Snapshot, TextSpan, ValidationIssue } from './types';
import { conversionsFor } from './conversions';
import { createQuestionPlan } from './planning';

type Check = (value: unknown, path: string, issues: ValidationIssue[]) => void;
const issue = (issues: ValidationIssue[], code: string, path: string, message: string) => issues.push({ code, path, message });
const string: Check = (v, p, e) => { if (typeof v !== 'string' || v.length > 2_000_000) issue(e, 'structure', p, '需要有长度上限的文字'); };
const finite: Check = (v, p, e) => { if (typeof v !== 'number' || !Number.isFinite(v)) issue(e, 'structure', p, '需要有限数值'); };
const integer: Check = (v, p, e) => { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) issue(e, 'structure', p, '需要非负整数'); };
const bool: Check = (v, p, e) => { if (typeof v !== 'boolean') issue(e, 'structure', p, '需要布尔值'); };
const nullable = (check: Check): Check => (v, p, e) => { if (v !== null) check(v, p, e); };
const choices = (...values: unknown[]): Check => (v, p, e) => { if (!values.includes(v)) issue(e, 'structure', p, '不在允许的值中'); };
const list = (check: Check): Check => (v, p, e) => {
  if (!Array.isArray(v) || v.length > 20_000) { issue(e, 'structure', p, '需要有限长度的列表'); return; }
  v.forEach((item, index) => check(item, `${p}[${index}]`, e));
};
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const shape = (fields: Record<string, Check>): Check => (v, p, e) => {
  if (!isRecord(v)) { issue(e, 'structure', p, '需要对象'); return; }
  for (const key of Object.keys(v)) if (!Object.hasOwn(fields, key)) issue(e, 'unknown_field', `${p}.${key}`, '不允许的字段');
  for (const [key, check] of Object.entries(fields)) check(v[key], `${p}.${key}`, e);
};
const strings = list(string);
const spanCheck = shape({ messageId: string, start: integer, end: integer, quote: string });
const messageCheck = shape({ id: string, authorId: string, kind: choices('topic', 'reply'), floor: nullable(integer), text: string, publishedAt: nullable(string), displayedTime: string, links: list(shape({ url: string, label: string })), imageCount: integer, stableId: bool });
const snapshotCheck = shape({ id: string, topicId: string, url: string, title: string, capturedAt: string, messages: list(messageCheck), pages: list(shape({ url: string, status: choices('read', 'failed', 'skipped'), messageIds: strings, error: nullable(string) })), expectedReplies: nullable(integer), completeness: choices('complete', 'partial', 'unknown'), gaps: strings });
const qualifiersCheck = shape({ population: string, time: string, metric: string, unit: string, quantifier: string, conditions: string });
const claimCheck = shape({ id: string, authorId: string, messageId: string, text: string, kind: choices('empirical', 'experience', 'value', 'hypothesis', 'reasoning', 'question', 'quotation', 'uncertain'), adoption: choices('asserted', 'quoted', 'questioned', 'uncertain'), spans: list(spanCheck), qualifiers: qualifiersCheck, contextRefs: strings, uncertainty: strings });
const planCheck = shape({ policyVersion: choices('question-search-v1'), frozenAt:string, deadlineAt:string,
  targets:list(shape({claimId:string,qualifiers:qualifiersCheck})), evidenceTypes:list(choices('html','pdf','text')),
  searches:list(shape({direction:choices('support','counter'),query:string})), maxSearches:integer,
  stopConditions:list(choices('directions_completed','deadline_reached','question_budget_exhausted','run_budget_exhausted','source_limit_reached','cancelled')) });
const requiredPlan: Check = (v,p,e) => {
  if(v===undefined) issue(e,'plan_missing',p,'旧分析包缺少核查计划字段，不能按当前合同导入；参考材料须显式标记无计划，重新检索需建立新分析');
  else nullable(planCheck)(v,p,e);
};
const questionCheck = shape({ id: string, claimIds: strings, question: string, needed: strings, disagreement: choices('none_observed', 'fact', 'scope', 'value', 'mixed', 'insufficient_context'), plan: requiredPlan });
const datumCheck = shape({ label: string, value: nullable(finite), unit: string, population: string, period: nullable(string), excerpt: string });
const sourceCheck = shape({ id: string, url: nullable(string), title: string, publisher: string, publishedAt: nullable(string), retrievedAt: string, status: choices('read', 'lead', 'unreadable'), kind: choices('html', 'pdf', 'text'), text: string, locator: string, rootId: string, introducedBy: string, introducedAtMessageId: nullable(string), limitations: strings, data: list(datumCheck) });
const relationCheck = shape({ id: string, claimId: string, sourceId: string, status: choices('supports', 'partial', 'contradicts', 'incomparable', 'unresolved'), excerpt: string, reason: string });
const dimensionCheck = shape({ applicability: choices('yes', 'no', 'uncertain'), grade: choices(0, 1, 2, 'U', null), reason: string, ruleIds: strings, refs: list(spanCheck) });
const evaluationCheck = shape({ id: string, messageId: string, claimIds: strings, targetMessageIds: strings, task: string, dimensions: shape({ R: dimensionCheck, E: dimensionCheck, L: dimensionCheck, B: dimensionCheck }), expression: shape({ emotion: choices('present', 'absent', 'uncertain'), attack: choices('present', 'absent', 'uncertain'), emotionOnly: nullable(bool), refs: list(spanCheck) }), contributions: list(choices('evidence', 'reuse', 'source_lead', 'clarification', 'question', 'reasoning_check', 'correction', 'social')), sourceIds: strings, localEvidenceRefs: strings, issues: strings });
const hashes: Check = (v, p, e) => {
  if (!isRecord(v)) { issue(e, 'structure', p, '需要指纹字典'); return; }
  for (const [key, value] of Object.entries(v)) {
    if (!['snapshot', 'claims', 'plan', 'evidence', 'relations', 'replies', 'report'].includes(key)) issue(e, 'unknown_field', `${p}.${key}`, '未知阶段');
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) issue(e, 'structure', `${p}.${key}`, '需要 SHA-256');
  }
};
const packageCheck = shape({ formatVersion: choices(1), methodVersion: string, id: string, createdAt: string, snapshot: snapshotCheck, claims: list(claimCheck), coverage: list(shape({ span: spanCheck, claimIds: strings, disposition: choices('claim', 'non_assertive', 'uncertain'), reason: string })), questions: list(questionCheck), sources: list(sourceCheck), relations: list(relationCheck), evaluations: list(evaluationCheck), provenance: shape({ mode: choices('exploratory', 'standard'), modelConfigId: string, endpoint: string, model: string, providerModel: nullable(string), declaredVersion: string, parameters: shape({ temperature: finite, maxOutputTokens: integer }), stageHashes: hashes, qualificationId: nullable(string) }), status: choices('partial', 'completed'), unresolved: strings });

function unique<T extends { id: string }>(items: T[], path: string, issues: ValidationIssue[]): Map<string, T> {
  const result = new Map<string, T>();
  items.forEach((item, i) => {
    if (!item.id || result.has(item.id)) issue(issues, 'duplicate_id', `${path}[${i}].id`, '标识为空或重复');
    result.set(item.id, item);
  });
  return result;
}

export function validateSnapshot(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []; snapshotCheck(value, 'snapshot', issues);
  if (issues.length) return issues;
  const snap = value as Snapshot;
  const messages = unique(snap.messages, 'snapshot.messages', issues);
  try {
    const url = new URL(snap.url);
    if (url.protocol !== 'https:' || !['guozaoke.com', 'www.guozaoke.com'].includes(url.hostname) || url.pathname !== `/t/${snap.topicId}` || !/^\d+$/.test(snap.topicId)) throw new Error();
    for (const page of snap.pages) {
      const pageUrl = new URL(page.url);
      if (pageUrl.origin !== url.origin || pageUrl.pathname !== url.pathname) throw new Error();
      page.messageIds.forEach(id => { if (!messages.has(id)) issue(issues, 'reference', 'snapshot.pages', '页面引用了不存在的回复'); });
    }
  } catch { issue(issues, 'topic_url', 'snapshot.url', '快照只允许同一过早客主题'); }
  for (const [i, message] of snap.messages.entries()) {
    if (!/^P\d+$/.test(message.authorId)) issue(issues, 'alias', `snapshot.messages[${i}].authorId`, '导出只使用本帖参与者代号');
  }
  const replies = snap.messages.filter(x => x.kind === 'reply').length;
  if (snap.completeness === 'complete' && (snap.expectedReplies !== replies || snap.pages.some(x => x.status !== 'read') || snap.gaps.length)) issue(issues, 'coverage', 'snapshot.completeness', '有采集缺口不能声明完整');
  return issues;
}

/** Validation is deterministic. It does not turn source reputation or schema validity into truth. */
export function validatePackage(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []; packageCheck(value, 'package', issues);
  if (issues.length) return issues;
  const pkg = value as AnalysisPackage;
  issues.push(...validateSnapshot(pkg.snapshot));
  const messages = new Map(pkg.snapshot.messages.map(m => [m.id, m]));
  const claims = unique(pkg.claims, 'claims', issues);
  const sources = unique(pkg.sources, 'sources', issues);
  unique(pkg.questions, 'questions', issues); unique(pkg.relations, 'relations', issues); unique(pkg.evaluations, 'evaluations', issues);
  const checkRefs = (ids: string[], set: Map<string, unknown>, path: string) => ids.forEach(id => { if (!set.has(id)) issue(issues, 'reference', path, `找不到引用 ${id}`); });
  const checkSpan = (span: TextSpan, path: string) => {
    const message = messages.get(span.messageId);
    if (!message || span.end <= span.start || Array.from(message.text).slice(span.start, span.end).join('') !== span.quote || span.end > Array.from(message.text).length) issue(issues, 'span', path, '原文引用或 Unicode 字符位置不匹配');
  };
  for (const [i, claim] of pkg.claims.entries()) {
    const message = messages.get(claim.messageId);
    if (!message) issue(issues, 'reference', `claims[${i}]`, '原回复不存在');
    if (message?.authorId !== claim.authorId) issue(issues, 'ownership', `claims[${i}]`, '主张的作者必须与原回复一致');
    if (!claim.spans.length) issue(issues, 'span', `claims[${i}]`, '主张必须有原文位置');
    claim.spans.forEach(span => {
      checkSpan(span, `claims[${i}].spans`);
      if (span.messageId !== claim.messageId) issue(issues, 'ownership', `claims[${i}].spans`, '主张原文必须来自本人消息，语境单独引用');
    });
    checkRefs(claim.contextRefs, messages, `claims[${i}].contextRefs`);
  }
  pkg.questions.forEach((q, i) => {
    const path=`questions[${i}]`; checkRefs(q.claimIds, claims, path);
    if (!q.claimIds.length || new Set(q.claimIds).size!==q.claimIds.length || !q.question.trim()) issue(issues,'plan',path,'核查问题必须有唯一的主张引用和问题文字');
    if (q.plan === null) return;
    const frozen=Date.parse(q.plan.frozenAt);
    if (!Number.isFinite(frozen) || new Date(frozen).toISOString()!==q.plan.frozenAt) {issue(issues,'plan',`${path}.plan.frozenAt`,'计划建立时间必须是绝对 ISO 时间');return;}
    if (q.claimIds.some(id=>!claims.has(id))) return;
    const expected=createQuestionPlan(q,pkg.claims,q.plan.frozenAt);
    if (canonical(q.plan)!==canonical(expected)) issue(issues,'plan',`${path}.plan`,'目标口径必须逐项沿用对应主张；期限、次数、材料类型及停止条件必须符合固定程序政策');
  });
  pkg.coverage.forEach((unit, i) => {
    checkSpan(unit.span, `coverage[${i}].span`); checkRefs(unit.claimIds, claims, `coverage[${i}]`);
    if (unit.disposition === 'claim' && !unit.claimIds.length) issue(issues, 'coverage', `coverage[${i}]`, '标为主张的句段必须定位到提取结果');
    unit.claimIds.forEach(id => { if (claims.get(id)?.messageId !== unit.span.messageId) issue(issues, 'ownership', `coverage[${i}]`, '句段和主张所属回复不一致'); });
  });
  pkg.sources.forEach((source, i) => {
    const path = `sources[${i}]`;
    if (!sources.has(source.rootId)) issue(issues, 'reference', `${path}.rootId`, '同源组必须有来源登记');
    else if (sources.get(source.rootId)?.rootId !== source.rootId) issue(issues, 'source_root', `${path}.rootId`, '来源组须直接指向自身为根的来源，不能循环或串联');
    if (source.status === 'read' && !source.text.trim()) issue(issues, 'unread_evidence', path, '空内容不能登记为已读取');
    if (source.status !== 'read' && source.data.length) issue(issues, 'unread_evidence', path, '未读取材料不能产生已核对的数据');
    if (source.introducedBy !== 'system') {
      const authorMessage = source.introducedAtMessageId ? messages.get(source.introducedAtMessageId) : null;
      if (authorMessage?.authorId !== source.introducedBy) issue(issues, 'source_attribution', path, '资料引入者与本帖原文不匹配');
    } else if (source.introducedAtMessageId !== null) issue(issues, 'source_attribution', path, '系统补证不绑定作者引入事件');
    source.data.forEach((datum, j) => {
      if (!datum.excerpt || !source.text.includes(datum.excerpt)) issue(issues, 'excerpt', `${path}.data[${j}]`, '数据必须附材料内的精确摘录');
      // Accept original values only; conversions require a separate formula record.
      const normalized = datum.excerpt.normalize('NFKC').replace(/−/g, '-');
      const numbers = [...normalized.matchAll(/(?<![\d.,])[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\d.,])/g)].map(m => Number(m[0].replaceAll(',', '')));
      if (datum.value !== null && !numbers.includes(datum.value)) issue(issues, 'numeric_provenance', `${path}.data[${j}]`, '数值必须是摘录中的原值，不得猜测或隐式换算');
      if (datum.unit.trim() && !normalized.includes(datum.unit.normalize('NFKC').trim())) issue(issues, 'unit_provenance', `${path}.data[${j}]`, '单位必须出现在同一原文摘录；不能猜测或替换');
    });
    if (source.url !== null) { try { const url=new URL(source.url); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(); } catch { issue(issues, 'source_url', path, '来源 URL 无效或包含凭据'); } }
  });
  pkg.relations.forEach((relation, i) => {
    const path = `relations[${i}]`; const source = sources.get(relation.sourceId);
    checkRefs([relation.claimId], claims, path); checkRefs([relation.sourceId], sources, path);
    if (source && relation.status !== 'unresolved') {
      if (source.status !== 'read') issue(issues, 'unread_evidence', path, '读取失败或搜索线索不能作为支持/反驳证据');
      if (!relation.excerpt || !source.text.includes(relation.excerpt)) issue(issues, 'excerpt', path, '支持关系必须有材料中的精确摘录');
    }
  });
  pkg.evaluations.forEach((evaluation, i) => {
    const path = `evaluations[${i}]`; const message = messages.get(evaluation.messageId);
    checkRefs([evaluation.messageId, ...evaluation.targetMessageIds, ...evaluation.localEvidenceRefs], messages, path);
    checkRefs(evaluation.claimIds, claims, path); checkRefs(evaluation.sourceIds, sources, path);
    evaluation.claimIds.forEach(id => { if (claims.get(id)?.messageId !== evaluation.messageId) issue(issues, 'ownership', path, '不得将其他回复的主张归入当前评价'); });
    for (const [dimensionId, dimension] of Object.entries(evaluation.dimensions)) {
      if ((dimension.applicability !== 'yes' && dimension.grade !== null) || (dimension.applicability === 'yes' && dimension.grade === null)) issue(issues, 'dimension', `${path}.${dimensionId}`, 'NA/P 必须为 null；已适用但无法判断为 U');
      if (!dimension.reason || !dimension.ruleIds.length) issue(issues, 'dimension', `${path}.${dimensionId}`, '各维度必须给出具体理由与规则');
      if (typeof dimension.grade === 'number' && !dimension.refs.length) issue(issues, 'dimension', `${path}.${dimensionId}`, '确定评级必须提供可定位的原文依据');
      dimension.refs.forEach(span => checkSpan(span, `${path}.${dimensionId}.refs`));
    }
    evaluation.expression.refs.forEach(span => { checkSpan(span, `${path}.expression.refs`); if(span.messageId!==evaluation.messageId)issue(issues,'ownership',`${path}.expression.refs`,'表达行为必须来自被评价回复，不能归责他人的语句'); });
    if (evaluation.expression.emotionOnly === true && (evaluation.expression.emotion !== 'present' || evaluation.expression.attack === 'present' || evaluation.claimIds.length)) issue(issues, 'expression', path, '有具体主张或攻击时不得标为纯情绪');
    if ((evaluation.expression.attack === 'present' || evaluation.expression.emotion === 'present') && !evaluation.expression.refs.length) issue(issues, 'span', path, '表达行为必须有可定位的原文');
    evaluation.sourceIds.forEach(id => {
      const source = sources.get(id);
      const referred = source?.url && message?.links.some(link => link.url === source.url);
      if (source?.introducedBy === 'system' && !referred) issue(issues, 'source_attribution', path, '系统资料不能自动计作参与者原始举证');
      if(source && source.introducedBy!=='system' && source.introducedAtMessageId!==evaluation.messageId && !referred) {
        const introduction=source.introducedAtMessageId;
        const ownBasis=evaluation.dimensions.E.refs.some(span=>span.messageId===evaluation.messageId);
        if(!introduction || !evaluation.localEvidenceRefs.includes(introduction) || !ownBasis)issue(issues,'source_attribution',path,'援用他人资料必须定位引入消息，并保留本回复援用语句；来源存在不代表当前作者已经举证');
      }
    });
    if (evaluation.contributions.includes('evidence') && !evaluation.sourceIds.some(id => { const s = sources.get(id); return s?.introducedAtMessageId === evaluation.messageId && s.status === 'read'; })) issue(issues, 'source_attribution', path, '引入资料需有本条首次提供的可读材料');
  });
  if (pkg.provenance.mode === 'standard' && !pkg.provenance.qualificationId) issue(issues, 'qualification', 'provenance', '标准分析需有可核对的准入记录');
  return issues;
}

export function assertPackage(value: unknown): asserts value is AnalysisPackage {
  const issues = validatePackage(value);
  if (issues.length) throw new Error(`${issues[0]!.code}: ${issues[0]!.path} ${issues[0]!.message}`);
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  throw new Error('canonical: unsupported value');
}

export async function hashValue(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonical(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function exportPackage(value: unknown): Promise<string> {
  assertPackage(value);
  // A closed schema makes secrets and extra model fields impossible to export implicitly.
  const copy: AnalysisPackage = JSON.parse(JSON.stringify(value));
  const payload = { package: copy, conversions: conversionsFor(copy.sources) };
  return JSON.stringify({ format: 'gzk-analysis-package', sha256: await hashValue(payload), ...payload }, null, 2);
}

export async function importPackage(text: string): Promise<AnalysisPackage> {
  if (text.length > 12_000_000) throw new Error('too_large: 分析包超过限制');
  const envelope: unknown = JSON.parse(text);
  if (!isRecord(envelope) || envelope.format !== 'gzk-analysis-package' || !['format,package,sha256','conversions,format,package,sha256'].includes(Object.keys(envelope).sort().join(','))) throw new Error('structure: 分析包格式错误');
  const payload = Object.hasOwn(envelope,'conversions') ? {package:envelope.package,conversions:envelope.conversions} : envelope.package;
  if (await hashValue(payload) !== envelope.sha256) throw new Error('integrity: 分析包内容已发生变化');
  assertPackage(envelope.package);
  if (Object.hasOwn(envelope,'conversions') && await hashValue(envelope.conversions) !== await hashValue(conversionsFor(envelope.package.sources))) throw new Error('conversion_integrity: 换算规则或结果不匹配');
  return envelope.package;
}

export async function inputFingerprints(pkg: AnalysisPackage) {
  return { snapshot: await hashValue(pkg.snapshot), claims: await hashValue({ claims: pkg.claims, questions: pkg.questions }), evidence: await hashValue({ sources: pkg.sources, relations: pkg.relations }) };
}

export async function comparableInputs(left: AnalysisPackage, right: AnalysisPackage): Promise<{ comparable: boolean; differences: string[] }> {
  const differences: string[] = [];
  if (left.methodVersion !== right.methodVersion) differences.push('method');
  const [a, b] = await Promise.all([inputFingerprints(left), inputFingerprints(right)]);
  for (const key of ['snapshot', 'claims', 'evidence'] as const) if (a[key] !== b[key]) differences.push(key);
  return { comparable: differences.length === 0, differences };
}
