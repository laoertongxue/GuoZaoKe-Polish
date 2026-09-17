import { el, button, link } from '../shared/app-ui';
import { AnalysisRepository } from './repository';
import { assertPackage, exportPackage, hashValue, importPackage } from './contracts';
import { AnalysisPause, createRun, DEFAULT_BUDGET, executeRun, participantSummary, type EvidenceControls } from './engine';
import { normalizeModelConfig, validatePublicUrl, type ModelConfig } from './providers';
import { collectSnapshot, snapshotDiff } from './snapshot';
import { gatherEvidence } from './retrieval';
import { compareExtractions, compareRatings, createReplayRun, type ReplayTrack } from './comparison';
import type { Fraction, QualificationRecord } from './comparison';
import type { CalibrationBatch } from './calibration';
import { conversionsFor, datumUnitBinding } from './conversions';
import {DEFAULT_SOURCE_BYTES} from './source-budget';
import { topicUrl } from '../site/urls';
import type { AnalysisBudget, AnalysisPackage, AnalysisQuestion, Claim, EvidenceSource, RunCheckpoint, ReportQualification } from './types';

type View = 'overview' | 'evidence' | 'replies' | 'settings' | 'history' | 'compare' | 'calibration';
const VIEW_NAMES: Record<View, string> = { overview: '概览', evidence: '主张与证据', replies: '回复观察', settings: '模型设置', history: '历史', compare: '复跑与对比', calibration: '模型校准' };
const STAGE_NAMES: Record<string, string> = { claims: '提取并固定主张', plan: '建立核查问题', evidence: '检索与读取材料', relations: '核对材料关系', replies: '评价本帖回复', report: '生成报告' };
const DIMENSIONS = { R: '回应覆盖', E: '举证关系', L: '推导连接', B: '范围边界' };
const RELATIONS = { supports: '材料支持', partial: '部分支持', contradicts: '材料冲突', incomparable: '口径不可比', unresolved: '待核' };
const DISAGREEMENTS = { none_observed: '未观察到分歧', fact: '事实分歧', scope: '口径分歧', value: '价值分歧', mixed: '混合分歧', insufficient_context: '语境不足' };
const STATE_NAMES = { ready: '待开始', running: '执行中', paused: '等待继续', partial: '部分完成', completed: '本轮完成', failed: '执行失败', cancelled: '已取消' };
const USER_ERRORS: Record<string,string> = {configuration_changed:'配置或流程版本已变化，请建立新分析；旧结果仍然保留。',qualification_changed:'原有试验资格已失效，请重新校准并建立新分析。',qualification_model_changed:'服务返回的模型标识发生变化，已停止调用并使旧试验资格失效。',configuration_invalidated:'模型标识变化后，旧批次已失效，需要新建整轮校准。'};
Object.assign(USER_ERRORS, { missing_key: '本次会话的 Key 不可用，请到模型设置重新填写。', network: '无法连接模型服务，请检查网络和 API 地址。', unauthorized: '模型服务拒绝认证，请检查 Key。', rate_limited: '模型服务限流，请稍后继续。', timeout: '模型请求超时，已保存完成的步骤。', permission_required: '等待读取来源权限。', budget_exhausted: '已达到本次调用上限，已完成的结果仍然保留。' });
const note = (text: string) => el('p', 'analysis-note', text);
const dimensionState = (d: AnalysisPackage['evaluations'][number]['dimensions']['R']) => d.applicability === 'no' ? '不适用（NA）' : d.applicability === 'uncertain' ? '适用性待确定（P）' : d.grade === 'U' ? '无法判断（U）' : `等级 ${d.grade}`;
function section(title: string, ...children: Node[]) { const card = el('section', 'analysis-card'); card.append(el('h2', '', title), ...children); return card; }
function table(headers: string[], rows: (string | Node)[][]) {
  const wrap = el('div', 'analysis-table-wrap'); const result = el('table', 'analysis-table'); const head = el('thead'); const tr = el('tr');
  headers.forEach(h => { const th = el('th', '', h); th.scope = 'col'; tr.append(th); }); head.append(tr); result.append(head);
  const body = el('tbody'); rows.forEach(row => { const tr = el('tr'); row.forEach(value => { const td = el('td'); td.append(typeof value === 'string' ? document.createTextNode(value) : value); tr.append(td); }); body.append(tr); });
  result.append(body); wrap.append(result); return wrap;
}
function disclosure(title: string, content: Node, open = false) { const details = el('details', 'analysis-disclosure'); details.open = open; details.append(el('summary', '', title), content); return details; }
function originalLink(pkg: AnalysisPackage, messageId: string, label = '查看原回复') {
  if (pkg.snapshot.id.startsWith('calibration-')) return note('合成测试材料，没有真实帖子链接。');
  const reply = pkg.snapshot.messages.find(m => m.id === messageId); const stable = messageId.match(/^reply-(\d+)$/)?.[1];
  const suffix = stable ? `#gzk-reply-${stable}` : reply?.floor ? `#reply${reply.floor}` : '';
  const page = pkg.snapshot.pages.find(p => p.status === 'read' && p.messageIds.includes(messageId));
  return link(label, `${(page?.url || pkg.snapshot.url).split('#')[0]}${suffix}`);
}
const datumValue = (value: number | null) => value === null ? '未知' : String(value);
function claimExcerpts(claim: Claim) {
  const excerpts=el('div');
  for(const span of claim.spans)excerpts.append(el('blockquote','',span.quote),note(`${span.messageId} · 字符 ${span.start}–${span.end}`));
  return disclosure('核对主张摘录',excerpts);
}
function questionPlan(question:AnalysisQuestion) {
  if(!question.plan)return note('没有可执行的冻结检索计划；这份材料不会自动补查，请建立新分析。');
  const plan=question.plan;const body=el('div');
  body.append(note(`固定时间：${plan.frozenAt}；截止时间：${plan.deadlineAt}。单问题最多 ${plan.maxSearches} 次检索，失败也计入，恢复不会重置期限或次数。`),note('范围逐项沿用主张的人群、时期、指标、单位和条件；未说明的字段保持未说明。支持 HTML、文字 PDF 和文本材料。'),table(['方向','冻结检索问题'],plan.searches.map(s=>[s.direction==='support'?'正向':'反向',s.query])),note('正反方向完成、到期、达到问题或整轮预算、来源已满或主动取消时停止；停止只记录本次缺口。'));
  return disclosure('查看冻结核查计划',body);
}

/** Summarize existing bounded records, not an extra model-generated verdict. */
function reportConclusions(pkg: AnalysisPackage) {
  const card = section('本帖分析结论', note('以下判断来自本轮已保存的主张与材料关系；待核不等于错误，材料支持也不等于独立事实认证。'));
  if (!pkg.claims.length) card.append(note(pkg.status === 'partial' ? '尚未产生分析结论。请先开始或继续分析，不能用空结果判断本帖。' : '本轮未提取出可核查主张；请结合覆盖范围与回复观察阅读。'));
  for (const claim of pkg.claims.slice(0, 6)) {
    const item = el('article', 'analysis-conclusion');
    item.append(el('h3', '', claim.text), note(`帖子中的主张 · ${claim.id} · ${claim.authorId}`));
    const relations = pkg.relations.filter(r => r.claimId === claim.id);
    if (!relations.length) item.append(note('待核：尚未取得支持或反驳这项主张的可核对材料关系。'));
    for (const relation of relations) {
      const source = pkg.sources.find(s => s.id === relation.sourceId);
      item.append(el('strong', '', RELATIONS[relation.status]), note(relation.reason));
      if (source) {
        item.append(source.url ? link(`${source.id} · ${source.title}`, source.url) : note(`${source.id} · ${source.title}`));
        item.append(note(`${source.status === 'read' ? '已读取原件' : '原件尚未读到'} · ${source.introducedBy === 'system' ? '系统补查，不计入原回复举证' : '帖内提供的资料'}`));
        const basis = el('div'); basis.append(el('blockquote', '', relation.excerpt || '暂无可定位摘录'), note(`定位：${source.locator || '未说明'}`), ...source.limitations.map(note));
        item.append(disclosure('查看结论依据与限制', basis));
      }
    }
    item.append(...claim.uncertainty.map(note), originalLink(pkg, claim.messageId, '对照原文'), claimExcerpts(claim)); card.append(item);
  }
  if (pkg.claims.length > 6) card.append(note(`此处展示前 6 项主张，共 ${pkg.claims.length} 项；“主张与证据”中可查看全部。`));
  return card;
}
function replyConclusions(pkg: AnalysisPackage) {
  const card = section('回复分析摘要', note('只评价本帖中的具体表达；情绪表达与事实、推理分别观察，不据此评价一个人的整体能力。'));
  const messages = pkg.snapshot.messages.filter(m => m.kind === 'reply');
  const assessed = messages.filter(m => pkg.evaluations.some(e => e.messageId === m.id));
  card.append(note(`已评价 ${assessed.length}/${messages.length} 条已采集回复；未评价部分不能推断为表现差。`));
  if (!assessed.length) card.append(note('尚无回复评价结果。'));
  for (const message of assessed.slice(0, 4)) {
    const item = el('article', 'analysis-conclusion'); item.append(el('h3', '', `${message.floor === null ? '楼层未知' : `#${message.floor}`} · ${message.authorId}`));
    for (const evaluation of pkg.evaluations.filter(e => e.messageId === message.id)) {
      item.append(el('strong', '', evaluation.task));
      for (const key of ['R', 'E', 'L', 'B'] as const) { const d = evaluation.dimensions[key]; item.append(note(`${DIMENSIONS[key]} · ${dimensionState(d)}：${d.reason}`)); }
      if (evaluation.expression.emotionOnly === true) item.append(note('这段仅观察到情绪表达，未识别到实质讨论任务。'));
      if (evaluation.expression.attack === 'present') item.append(note('观察到攻击性表达：' + evaluation.expression.refs.map(r => r.quote).join('；')));
      item.append(...evaluation.issues.map(note));
    }
    item.append(originalLink(pkg, message.id)); card.append(item);
  }
  if (assessed.length > 4) card.append(note('此处展示前 4 条已评价回复，其余内容及逐段原文依据可在“回复观察”中查看。'));
  return card;
}

/** Shared by the full page and read-only report preview; no generated HTML is ever inserted. */
export function renderReport(root: HTMLElement, pkg: AnalysisPackage, view: 'overview' | 'evidence' | 'replies', qualification?: ReportQualification) {
  root.replaceChildren();
  const heading = el('div', 'analysis-report-heading'); heading.append(el('h1', '', pkg.snapshot.title), note(`${pkg.status === 'partial' ? '部分完成' : pkg.unresolved.length ? '本轮完成 · 有待核事项' : '本轮完成'} · ${qualification?.state === 'qualified_trial' ? '标准分析试用' : pkg.provenance.mode === 'standard' ? '准入未核实' : '探索分析'} · 规则 ${pkg.methodVersion}`)); root.append(heading);
  const structureValid = (()=>{try{assertPackage(pkg);return true;}catch{return false;}})();
  if(qualification?.state==='qualified_trial') root.append(note(`配置通过本轮试验校准 · ${qualification.assessedAt} · ${qualification.referenceLabel}。不代表每条结论已经核验。`));
  else if(qualification?.state==='expired') root.append(note('原有试验资格已失效或模型标识变化。当前结果保留供复核，重新校准后再建立新分析。'));
  else if(pkg.provenance.mode==='standard') root.append(note('报告声明的准入尚未由本机运行记录核实；导入标记不能证明已经通过校准。'));
  root.append(note(`${structureValid?'结构校验通过':'结构校验未通过'}；采集覆盖与材料支持另列，结构通过不等于事实正确。`));
  if (view === 'overview') {
    root.append(reportConclusions(pkg), replyConclusions(pkg));
    const counts = el('div', 'analysis-counts');
    for (const [number, label] of [[pkg.snapshot.messages.filter(m => m.kind === 'reply').length, '已采集回复'], [pkg.claims.length, '固化主张'], [pkg.sources.filter(s => s.status === 'read').length, '已读取来源'], [pkg.evaluations.length, '评价单元']]) {
      const item = el('div'); item.append(el('strong', '', String(number)), el('span', '', String(label))); counts.append(item);
    }
    root.append(counts, section('这份分析的范围', note(`采集时间：${pkg.snapshot.capturedAt}。${pkg.snapshot.expectedReplies === null ? '页面没有提供可确认的回复总数。' : `页面声明 ${pkg.snapshot.expectedReplies} 条回复。`}采集状态：${pkg.snapshot.completeness === 'complete' ? '文字范围完整' : pkg.snapshot.completeness === 'partial' ? '存在覆盖缺口' : '完整性未知'}。`), note('评价仅限本帖中可观察的表达和举证。材料支持关系与参与者原先是否举证分开显示。'), originalLink(pkg, pkg.snapshot.messages[0]?.id || '')));
    const gaps = [...new Set([...pkg.snapshot.gaps, ...pkg.unresolved])];
    root.append(section('待核与限制', ...(gaps.length ? gaps.map(note) : [note('程序未记录额外缺口；这不代表事实核查已获独立认证。')])));
    root.append(section('核查问题', ...(pkg.questions.length ? pkg.questions.map(q => { const row = el('div', 'analysis-question'); row.append(el('strong', '', q.question), note(`${DISAGREEMENTS[q.disagreement]} · ${q.claimIds.join('、')}`), note(`需要：${q.needed.join('；') || '待补充'}`),questionPlan(q)); return row; }) : [note('尚未形成核查问题。')])));
    root.append(section('本次运行依据', note(`模型：${pkg.provenance.model} · 服务地址：${pkg.provenance.endpoint}`), note(`服务端返回型号：${pkg.provenance.providerModel ?? '未知'}；用户声明版本：${pkg.provenance.declaredVersion || '未声明'}。这些名称不能保证服务商后端版本不变。`), note(`原文指纹：${pkg.provenance.stageHashes.snapshot || '尚未执行'}。报告 ID：${pkg.id}`)));
  } else if (view === 'evidence') {
    root.append(note('按主张与统计口径查看资料。未观察到分歧不等于共识；来源数量不等于独立证据数量。'));
    for (const question of pkg.questions) {
      const rows = question.claimIds.map(id => {
        const claim = pkg.claims.find(c => c.id === id); if (!claim) return [];
        const statement = el('div'); statement.append(el('strong', '', claim.text), note(`${claim.id} · ${claim.authorId}`), originalLink(pkg, claim.messageId));
        statement.append(claimExcerpts(claim));
        const evidence = el('div'); const relations = pkg.relations.filter(r => r.claimId === id);
        if (!relations.length) evidence.append(note('尚未取得可核对的材料关系。'));
        relations.forEach(relation => { const source = pkg.sources.find(s => s.id === relation.sourceId); evidence.append(el('strong', '', RELATIONS[relation.status]), note(relation.reason), el('blockquote', '', relation.excerpt || '尚无可核对摘录'), note(`${relation.sourceId} · ${source?.title || '来源缺失'}`)); });
        return [statement, Object.entries(claim.qualifiers).map(([key, value]) => `${({ population: '对象', time: '时期', metric: '指标', unit: '单位', quantifier: '量词', conditions: '条件' } as Record<string, string>)[key]}：${({ not_stated: '未说明', ambiguous: '不明确', not_applicable: '不适用' } as Record<string, string>)[value] || value}`).join('\n'), evidence];
      }).filter(row => row.length);
      root.append(section(`${DISAGREEMENTS[question.disagreement]} · ${question.question}`,questionPlan(question), table(['固化主张', '口径与范围', '材料关系'], rows)));
    }
    const planned=new Set(pkg.questions.flatMap(q=>q.claimIds));const unplanned=pkg.claims.filter(c=>!planned.has(c.id));
    if(unplanned.length)root.append(section('尚未列入核查的主张',note('这些主张尚无核查问题，保留摘录供复核，不能据此确定事实。'),...unplanned.map(claim=>{const item=el('div');item.append(el('strong','',`${claim.id} · ${claim.text}`),note(`${claim.authorId} · ${claim.kind}`),originalLink(pkg,claim.messageId),claimExcerpts(claim));return item;})));
    const row = (s:EvidenceSource,d:EvidenceSource['data'][number]) => [d.label, datumValue(d.value), d.unit || '未说明', d.population || '未说明', d.period ?? '未知', `${s.id} · ${s.title}`, d.excerpt];
    const dataRows = pkg.sources.flatMap(s => s.data.filter(d=>datumUnitBinding(d)==='explicit_pair').map(d=>row(s,d)));
    const pendingData = pkg.sources.flatMap(s => s.data.filter(d=>datumUnitBinding(d)!=='explicit_pair').map(d=>row(s,d)));
    const headers=['指标', '原值', '原始单位', '统计对象', '时期', '来源', '原文摘录'];
    root.append(section('可追溯数据表', note('程序已检查摘录、原值及相邻单位；指标、人群、时期与主张的语义关系仍需核对，不表示事实认证。'), ...(dataRows.length ? [table(headers, dataRows)] : [note('暂无数值与单位已明确配对的数据。缺值不会补成 0。')])));
    if(pendingData.length)root.append(section('数据待核',note('原值未知、单位缺失或文本中不能确认数值与单位配对，保留摘录，不自动换算。表格跨行表头也需要额外核对。'),table(headers,pendingData)));
    const conversions = conversionsFor(pkg.sources);
    if (conversions.items.length) root.append(section('明确单位的换算', note('只换算已明确的单位尺度，保留原值与统计范围。单位相同不代表人群、时期或方法可比；不自动换汇或将月值推成年值。'), table(['指标','原值','换算结果','公式','规则与来源'],conversions.items.map(c=>[c.label,`${datumValue(c.originalValue)} ${c.originalUnit}`,`${datumValue(c.value)} ${c.unit}`,c.formula,`${conversions.version} / ${c.ruleId}\n${c.sourceId} 第${c.dataIndex+1}项\n${c.rounding}`]))));
    root.append(section('来源登记', ...pkg.sources.map(source => {
      const body = el('div'); body.append(note(`${source.status === 'read' ? '已读取' : source.status === 'lead' ? '检索线索，尚未读取原件' : '未能读取'} · ${source.publisher || '发布者未知'} · 发布日期：${source.publishedAt ?? '未知'} · 读取：${source.retrievedAt}`), note(`来源组 ${source.rootId} · ${source.introducedBy === 'system' ? '系统补充材料' : `${source.introducedBy} 在本帖提供`} · 定位：${source.locator || '尚未定位'}`));
      if (source.url) body.append(link('打开原始来源', source.url));
      source.limitations.forEach(text => body.append(note(text)));
      if (source.text) body.append(disclosure('查看保存的来源正文', el('pre', 'analysis-source-text', source.text)));
      return disclosure(`${source.id} · ${source.title}`, body);
    })));
  } else {
    root.append(note('同一回复的不同主张分别评价。2 / 1 / 0 是各维度操作定义；不适用、待确定适用性和无法判断分开保留。'));
    const people = participantSummary(pkg);
    root.append(section('本帖参与者观察', table(['本帖代号', '采集回复', '评价单元', '引入可读资料组', '明确纠正事件', '含攻击表达的回复'], people.map(p => [p.authorId, String(p.replies), String(p.evaluationUnits), String(p.introducedSources), String(p.corrections), String(p.attackMessages)]))));
    for (const message of pkg.snapshot.messages.filter(m => m.kind === 'reply')) {
      const evaluations = pkg.evaluations.filter(e => e.messageId === message.id); const body = el('div');
      body.append(el('blockquote', '', message.text), originalLink(pkg, message.id));
      if (!evaluations.length) body.append(note('尚未评价；不能据此得出负面判断。'));
      for (const evaluation of evaluations) {
        body.append(el('h3', '', evaluation.claimIds.map(id => pkg.claims.find(c => c.id === id)?.text || id).join('；') || '非主张表达'), note(`回应任务：${evaluation.task}`));
        body.append(table(['维度', '状态', '依据与规则'], (['R', 'E', 'L', 'B'] as const).map(key => {
          const d = evaluation.dimensions[key]; const state = d.applicability === 'no' ? '不适用（NA）' : d.applicability === 'uncertain' ? '适用性待确定（P）' : d.grade === 'U' ? '无法判断（U）' : String(d.grade);
          const basis = el('div'); basis.append(note(d.reason), note(`规则：${d.ruleIds.join('、')}`));
          if (d.refs.length) basis.append(disclosure('查看原文依据', el('blockquote', '', d.refs.map(ref => ref.quote).join('\n'))));
          return [DIMENSIONS[key], state, basis];
        })));
        if (evaluation.expression.attack === 'present') body.append(note('观察到攻击性表达：' + evaluation.expression.refs.map(r => r.quote).join('；')));
        if (evaluation.expression.emotionOnly === true) body.append(note('该段仅观察到情绪表达，未识别到实质讨论任务。'));
        evaluation.issues.forEach(text => body.append(note(text)));
      }
      root.append(disclosure(`${message.authorId} · ${message.floor === null ? '楼层未知' : `#${message.floor}`} · ${evaluations.length} 个评价单元`, body));
    }
  }
}

export interface WorkspaceServices {
  request(message: Record<string, unknown>): Promise<any>;
  repo: AnalysisRepository;
  loadTopic(url: string): Promise<Document>;
  permissions: { contains(origin: string): Promise<boolean>; request(origins: string[]): Promise<boolean> };
  readSource?(url: string, requestId: string, scope: 'job'|'manual', signal?: AbortSignal): Promise<EvidenceSource>;
  importFile?(file: File): Promise<EvidenceSource>;
}
export async function mountWorkspace(root: HTMLElement, services: WorkspaceServices, initialTopic?: string, initialView: View = 'overview', options: { compact?: boolean } = {}): Promise<() => void> {
  root.classList.toggle('analysis-compact', !!options.compact);
  let view: View = initialView; let configurations: (ModelConfig & { hasKey: boolean })[] = []; let hasSearchKey = false;
  let current: RunCheckpoint | null = null; let report: AnalysisPackage | null = null; let topic = initialTopic || '';
  let busy = false; let controller: AbortController | null = null; let disposed = false; let modelId = '';
  let queueActive = false; let queueCancelled = false; let calibrationId: string | null = null;
  let calibrationResult: QualificationRecord | null = null;
  let budget = { ...DEFAULT_BUDGET }; let importedSources: EvidenceSource[] = []; let pendingOrigins: string[] = [];
  let identities: Record<string, string> = {}; let selectedConfiguration: string | null = null;
  const nav = el('nav', 'analysis-nav'); nav.setAttribute('aria-label', '讨论分析导航');
  const content = el('main', 'analysis-main'); const status = el('p', 'analysis-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const brand = el('header', 'analysis-brand'); brand.append(el('strong', '', 'GuoZaoKe Polish'), el('span', '', '讨论分析'), note('从原文到主张，从材料到判断。'));
  const progressText = note(''); const savedText = note('');
  const cancelRun = button('取消分析', 'button', () => {
    if (!controller || !current) return;
    if (queueActive) queueCancelled = true;
    controller.abort(); cancelRun.disabled = true;
    void perform(async () => { await services.request({ type: 'analysis:cancel', jobId: current!.id }); });
  });
  const showSaved = button('查看已保存结果', 'button', () => setView('overview'));
  const progress = section('本轮分析进度', progressText, savedText, showSaved, cancelRun);
  progress.setAttribute('aria-label', '本轮分析进度'); progress.hidden = true;
  let refreshVisibleReport: (() => void) | null = null;
  let readingVisibleReport = () => false;
  root.replaceChildren(brand, nav, status, progress, content);
  const say = (text: string, error = false) => { status.textContent = text; status.dataset.error = String(error); };
  const perform = async (action: () => Promise<void>) => { try { await action(); } catch (error) { say(error instanceof Error ? USER_ERRORS[error.message] || error.message : '操作未完成', true); } };
  const refreshConfigurations = async () => {
    const data = await services.request({ type: 'analysis:config:get' }); configurations = (data.configs || []).map((c: any) => ({ ...normalizeModelConfig(c), hasKey: c.hasKey === true })); hasSearchKey = data.hasSearchKey === true;
    if (!configurations.some(c => c.id === modelId)) modelId = configurations[0]?.id || '';
  };
  const setView = (next: View) => { view = next; render(); };
  function updateProgress() {
    progress.hidden = !current;
    if (!current) return;
    progressText.textContent = `${STATE_NAMES[current.state]} · ${STAGE_NAMES[current.stage]} · 已保存 ${current.completedStages.length}/6 个步骤 · 已占用 ${current.callsUsed}/${current.budget.maxCalls} 次调用`;
    savedText.textContent = `已保存 ${current.package.claims.length} 项主张、${current.package.sources.filter(s => s.status === 'read').length} 份可读材料、${current.package.evaluations.length} 个评价单元。未完成步骤不代表已核验。`;
    cancelRun.disabled = !controller || controller.signal.aborted;
    showSaved.disabled = !report;
  }
  function refreshAfterTask() {
    if (disposed) return;
    updateProgress();
    if (readingVisibleReport()) {
      const hint = '当前展开内容保持原样，可点击“查看已保存结果”刷新。';
      if (!status.textContent?.endsWith(hint)) say(`${status.textContent} ${hint}`);
    } else render();
  }
  const download = (text: string, name: string) => { const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  async function save(job: RunCheckpoint) {
    await services.repo.saveJob(job); await services.repo.savePackage(job.package);
    current = job; report = job.package;
  }
  async function acquire(pkg: AnalysisPackage, limits: AnalysisBudget, signal: AbortSignal | undefined, controls: EvidenceControls): Promise<EvidenceSource[]> {
    const result = await gatherEvidence(pkg, limits, signal, controls, {
      search: hasSearchKey ? async(query,searchSignal) => {
        const jobId=current!.id;
        const abort=()=>{void services.request({type:'analysis:cancel',jobId});};
        if(searchSignal?.aborted)throw new Error('cancelled');
        searchSignal?.addEventListener('abort',abort,{once:true});
        try{return await services.request({type:'analysis:search',jobId,ticket:current!.callsUsed,query});}
        finally{searchSignal?.removeEventListener('abort',abort);}
      } : undefined,
      hasPermission: origin => services.permissions.contains(origin),
      read: (url, signal) => { if (!services.readSource) throw new Error('retrieval_unavailable'); return services.readSource(url, current!.id, 'job', signal); },
    });
    pendingOrigins = result.pendingOrigins;
    if (pendingOrigins.length) throw new AnalysisPause('permission_required');
    return result.sources;
  }

  async function run() {
    if (!current || busy || current.state === 'completed') return;
    const jobId = current.id; const maxCalls = current.budget.maxCalls;
    if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 500) throw new Error('调用上限须为 1–500 的整数。');
    busy = true;
    try {
      const start = async () => {
        if (disposed) return;
        // Another workspace may have finished since this panel was opened.
        const latest = await services.repo.getJob(jobId);
        if (!latest) throw new Error('分析任务已不存在，请重新采集本帖。');
        current = latest; report = latest.package;
        if (latest.state === 'completed') { say('本轮已在其他分析窗口完成，已展示保存结果，不会重复调用。'); return; }
        // Keep the cap the user just saw while retaining the latest spent budget.
        current.budget.maxCalls = maxCalls;
        busy = false; await runUnlocked();
      };
      if (navigator.locks) await navigator.locks.request(`gzk-analysis-run:${jobId}`, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) { say('本帖任务正在其他分析窗口执行，请在那里查看或取消，避免重复调用。'); return; }
        await start();
      });
      else if (/^(chrome|moz)-extension:$/.test(location.protocol)) throw new Error('浏览器不支持安全的任务锁，未发起调用。');
      else await start(); // Injected local test harness; production always requires Web Locks.
    } finally { busy = false; refreshAfterTask(); }
  }
  async function runUnlocked() {
    if (!current || current.state === 'completed') return;
    const cfg = configurations.find(c => c.id === current!.package.provenance.modelConfigId);
    if (!cfg?.hasKey) { setView('settings'); say('请先填写本次会话的模型 Key。'); return; }
    busy = true; controller = new AbortController(); refreshAfterTask();
    try {
      await services.repo.saveJob(current);
      current = await services.request({type:'analysis:run:prepare',jobId:current.id}) as RunCheckpoint;
      report=current.package;
      if(controller.signal.aborted)return;
      const result = await executeRun(current, {
        save,
        call: (stage, input) => services.request({ type: 'analysis:call', jobId: current!.id, ticket: current!.callsUsed, stage, input }),
        acquireEvidence: acquire,
        onProgress: job => {
          say(`${STATE_NAMES[job.state]} · ${STAGE_NAMES[job.stage]} · 已使用 ${job.callsUsed}/${job.budget.maxCalls} 次调用`);
          if (!disposed) { updateProgress(); refreshVisibleReport?.(); }
        },
      }, controller.signal);
      current = result; report = result.package;
      say(`${STATE_NAMES[result.state]}${result.errors.length ? ` · ${USER_ERRORS[result.errors.at(-1)!.code] || result.errors.at(-1)!.code}` : ''}。已完成的步骤保存在本机。`);
    } finally {
      busy = false; controller = null;
      refreshAfterTask();
    }
  }
  function inputField(label: string, value = '', type = 'text') {
    const row = el('label', 'analysis-field'); row.append(el('span', '', label)); const input = el('input'); input.type = type; input.value = value; row.append(input); return { row, input };
  }
  async function captureTopic(url: string, review?: {messageId:string;reason:string;reportId:string}) {
    if(busy || queueActive)return;
    const cfg=configurations.find(c=>c.id===modelId);
    if(!cfg){setView('settings');say('先添加一个模型配置。采集不会调用 AI。');return;}
    topic=url;busy=true;say('读取主题和分页…');render();
    try {
      const old=report?.snapshot;const page=await services.loadTopic(topic);
      const result=await collectSnapshot(page,topic,{fetchPage:services.loadTopic,identities});identities=result.identities;
      if(review){
        result.snapshot.gaps.push(`用户标记旧报告 ${review.reportId} 的 ${review.messageId} 需要复核：${review.reason}。重新采集不代表该问题已被证明修复，相关解释仍需核对。`);
        if(result.snapshot.completeness==='complete')result.snapshot.completeness='unknown';
      }
      const next=createRun(result.snapshot,cfg,{...budget,maxOutputTokens:cfg.maxOutputTokens});next.package.sources=structuredClone(importedSources);
      await save(next);view='overview';pendingOrigins=[];
      if(review)say('已建立带复核标记的新快照；旧报告保留在历史中。请核对原文，再主动开始新分析。');
      else if(old && old.topicId===result.snapshot.topicId){const diff=snapshotDiff(old,result.snapshot);say(`新快照：新增 ${diff.added.length}、修改 ${diff.changed.length}、当前缺失 ${diff.removed.length} 条。将重新核查相关语境。`);}
      else say('采集完成。请查看发送范围后开始分析。');
    } finally {busy=false;render();}
  }
  function renderExcerptReview(shown: AnalysisPackage) {
    if(shown.snapshot.id.startsWith('calibration-'))return;
    const body=el('div');const choose=el('select');choose.setAttribute('aria-label','需要复核的发言');
    for(const message of shown.snapshot.messages){const option=el('option','',`${message.kind==='topic'?'主楼':`#${message.floor??'?'} 回复`} · ${message.id}`);option.value=message.id;choose.append(option);}
    const excerpt=el('blockquote');const original=el('div');
    const update=()=>{const message=shown.snapshot.messages.find(m=>m.id===choose.value);excerpt.textContent=message?.text??'';original.replaceChildren(originalLink(shown,choose.value));};choose.onchange=update;update();
    const reason=el('select');reason.setAttribute('aria-label','摘录复核原因');
    for(const text of ['摘录与原文不符','主张解释或归属有误','缺少上下文或遗漏内容'])reason.append(el('option','',text));
    const recapture=button('重新采集并保留复核标记','button',()=>void perform(()=>captureTopic(shown.snapshot.url,{messageId:choose.value,reason:reason.value,reportId:shown.id})));recapture.disabled=busy||queueActive;
    body.append(note('选择需要复核的发言，对照保存的原文。重新采集会建立新版本并保留待核标记，原报告和评价不被覆盖；不会自动调用 AI。'),choose,excerpt,original,reason,recapture);
    content.append(disclosure('指出摘录错误',body));
  }
  function renderStart() {
    const url = inputField('过早客帖子地址', topic, 'url'); url.input.placeholder = 'https://www.guozaoke.com/t/…';
    const choose = el('select'); choose.setAttribute('aria-label', '分析模型'); configurations.forEach(c => { const option = el('option', '', `${c.name} · ${c.model}${c.hasKey ? '' : '（需填写 Key）'}`); option.value = c.id; choose.append(option); }); choose.value = modelId; choose.onchange = () => { modelId = choose.value; };
    const capture = button(report ? '重新采集本帖' : '采集帖子', 'button primary', () => void perform(()=>captureTopic(url.input.value.trim()))); capture.disabled = busy || queueActive;
    const setup = section(options.compact ? '分析当前帖子' : '从一篇帖子开始', url.row, choose, capture, note('主动采集主题正文和回复分页；编辑器草稿、菜单及账户设置不在采集范围内。'));
    const selected = configurations.find(c => c.id === modelId);
    if (!selected?.hasKey) setup.append(note(selected ? '模型配置已保存，但本次会话没有可用的 Key。扩展重载或浏览器重启后需要重新填写。' : '尚未配置分析模型。请先填写自己的 API 地址、模型和 Key。'), button('配置模型', 'button primary', () => setView('settings')));
    if (options.compact && initialTopic) setup.append(button('打开完整工作区', 'button', () => void perform(async () => { await services.request({ type: 'analysis:open', url: initialTopic }); })));
    content.append(report?.status === 'completed' ? disclosure('更新分析或调整模型', setup) : setup);
    if (current) {
      const receiver = current.package.provenance.endpoint;
      const consent = el('input'); consent.type = 'checkbox'; consent.id = 'analysis-consent';
      const consentLabel = el('label', 'analysis-consent'); consentLabel.append(consent, document.createTextNode(`将本帖文字、链接、主张和读取材料发送至 ${new URL(receiver).origin}${hasSearchKey ? '；核查问题发送至 api.tavily.com' : ''}。参与者以本帖代号展示，原文中的用户名仍可能被服务商处理。`));
      const start = button(current.state === 'completed' ? '本轮已完成' : current.state === 'ready' ? '开始分析' : '继续未完成步骤', 'button primary', () => void perform(run)); start.disabled = true; consent.onchange = () => { start.disabled = busy || queueActive || current?.state === 'completed' || !consent.checked; };
      const maxCalls = inputField('本次调用上限（含模型、检索与重试）', String(current.budget.maxCalls), 'number'); maxCalls.input.min = '1'; maxCalls.input.max = '500';
      maxCalls.input.disabled = busy || queueActive || current.state === 'completed';
      maxCalls.input.oninput = maxCalls.input.onchange = () => { if (current && !busy && !queueActive) current.budget.maxCalls = Number(maxCalls.input.value); };
      const scope = section('发送范围与预算', note(`本轮模型：${current.package.provenance.model} · ${new URL(receiver).origin}`), note(`已采集 ${current.package.snapshot.messages.filter(m => m.kind === 'reply').length} 条回复；${current.package.snapshot.gaps.length} 项覆盖限制。`), note(`输入字符总上限 ${current.budget.maxInputCharacters.toLocaleString()}；每次输出最多 ${current.budget.maxOutputTokens} Token；最多读取 ${current.budget.maxSources} 个来源。原件累计读取额度 ${((current.budget.maxSourceBytes??DEFAULT_SOURCE_BYTES)/1024/1024).toLocaleString()} MiB，每文件最多 8 MiB，读取尝试最多 ${current.budget.maxSources*3} 次；失败或中断保守计入预留额度，恢复不重置。额度限制正文读取，不代表底层网络流量或账单。费率未知，不估算金额。`), maxCalls.row, consentLabel, start);
      if (pendingOrigins.length) {
        scope.append(note(`等待读取权限：${pendingOrigins.join('、')}`), button('授权这些来源并继续', 'button', () => void perform(async () => { if (await services.permissions.request(pendingOrigins)) await run(); else say('未获得来源权限，已读取的结果仍然保留。'); })));
        scope.append(button('保留资料缺口，继续评价', 'button', () => void perform(async () => {
          if (!current) return; current.package.sources = current.package.sources.map(s => s.status === 'lead' ? { ...s, status: 'unreadable', limitations: [...s.limitations, '用户选择保留读取缺口。'] } : s); pendingOrigins = []; await save(current); await run();
        })));
      }
      content.append(current.state === 'completed' ? disclosure('本轮调用与发送范围', scope) : scope);
    }
  }
  function renderSettings() {
    const old = configurations.find(c => c.id === selectedConfiguration); const form = el('form', 'analysis-form');
    const name = inputField('配置名称', old?.name || '我的模型'); const base = inputField('API 地址（兼容 Chat Completions）', old?.baseUrl || 'https://api.deepseek.com/v1', 'url');
    const model = inputField('模型 ID', old?.model || 'deepseek-chat'); const key = inputField('API Key（仅本次浏览器会话）', '', 'password'); key.input.autocomplete = 'off'; key.input.spellcheck = false;
    const version = inputField('服务商版本说明（可留空）', old?.declaredVersion || ''); const output = inputField('单次最大输出 Token', String(old?.maxOutputTokens || 4096), 'number');
    const submit = button(old ? '保存配置' : '添加配置', 'button primary'); submit.type = 'submit'; submit.disabled = busy || queueActive;
    form.append(name.row, base.row, model.row, key.row, version.row, output.row, note('温度固定为 0。Key 不进入同步存储、分析报告或导出包；浏览器重启或扩展重载后需重新填写。请自行确认服务商的数据处理方式。'), submit);
    form.onsubmit = event => { event.preventDefault(); void perform(async () => {
      if (busy || queueActive) { say('当前任务使用已固定的配置，请完成或取消后再修改。'); return; }
      const cfg = normalizeModelConfig({ id: old?.id || crypto.randomUUID(), name: name.input.value, baseUrl: base.input.value.trim(), model: model.input.value, temperature: 0, maxOutputTokens: Number(output.input.value), declaredVersion: version.input.value });
      if (!await services.permissions.request([new URL(cfg.baseUrl).origin])) { say('未获得模型服务访问权限，配置尚未保存。'); return; }
      await services.request({ type: 'analysis:config:save', config: cfg, key: key.input.value }); key.input.value = ''; selectedConfiguration = null; await refreshConfigurations(); modelId = cfg.id; say('模型配置已保存，Key 仅保留在本次会话。'); render();
    }); };
    content.append(section('接入你自己的模型', form));
    for (const cfg of configurations) {
      const row = el('div', 'analysis-config-row'); row.append(el('strong', '', cfg.name), note(`${cfg.model} · ${cfg.baseUrl} · ${cfg.hasKey ? '本次会话已配置 Key' : '尚未填写 Key'}`), button('编辑', 'button', () => { selectedConfiguration = cfg.id; render(); }), button('测试连接与 JSON 结构', 'button', () => void perform(async () => {
        if (busy || queueActive) return; busy=true;
        try { say('发送一次最小测试请求…'); const result = await services.request({ type: 'analysis:probe', configId: cfg.id, structure: true }); say(`连接通过；JSON 结构${result.structure ? '通过' : '未通过'}。这不代表语义校准通过。`); }
        finally { busy=false; render(); }
      })), button('校准此配置', 'button', () => { if(busy || queueActive)return; modelId = cfg.id; setView('calibration'); }), button('删除配置', 'button', () => void perform(async () => { if (busy || queueActive) return; await services.request({ type: 'analysis:config:delete', configId: cfg.id }); await refreshConfigurations(); render(); })));
      content.append(section('已保存配置', row));
    }
    const search = inputField('Tavily 检索 Key（可选，仅本次会话）', '', 'password'); search.input.autocomplete = 'off';
    content.append(section('公开资料检索', search.row, note(hasSearchKey ? '本次会话已配置检索 Key。' : '没有检索 Key 时，可以读取帖内来源链接或自行补充材料。'), button('保存检索配置', 'button', () => void perform(async () => {
      if (busy || queueActive) return;
      if (!await services.permissions.request(['https://api.tavily.com'])) { say('未获得检索权限。'); return; }
      await services.request({ type: 'analysis:search:configure', key: search.input.value }); search.input.value = ''; await refreshConfigurations(); say('检索 Key 已保存至本次会话。'); render();
    })), button('清除本次会话的全部 Key', 'button', () => void perform(async () => { await services.request({ type: 'analysis:key:clear' }); await refreshConfigurations(); say('全部会话 Key 已清除。'); render(); }))));
  }
  function renderMaterials() {
    const file = el('input'); file.type = 'file'; file.accept = '.json,.pdf,.txt,.html'; file.setAttribute('aria-label', '导入分析包或证据材料');
    file.onchange = () => void perform(async () => {
      const selected = file.files?.[0]; if (!selected || busy || queueActive) return;
      if (selected.size > 12_000_000) throw new Error('文件超过 12 MB 限制。');
      busy = true;
      try {
      if (selected.name.endsWith('.json')) { const pkg = await importPackage(await selected.text()); await services.repo.savePackage(pkg); report = pkg; current = null; topic = pkg.snapshot.url; say('已导入分析包。导入记录不自动取得标准分析资格。'); }
      else { if(importedSources.length>=budget.maxSources)throw new Error(`已达到 ${budget.maxSources} 份补充材料上限。`); if (!services.importFile) throw new Error('材料读取暂不可用。'); const source = await services.importFile(selected); importedSources.push(source); say(`已加入材料：${source.title}（${source.status === 'read' ? '已读取' : '存在读取缺口'}）。将在下一次新分析中使用。`); }
      } finally { busy=false; render(); }
    });
    const url = inputField('补充公开来源 URL', '', 'url');
    content.append(section('补充与保存材料',note('这里由你主动读取或导入材料，独立于本轮自动取证预算；不扣减上方的累计读取额度。单份 HTML/文本最多 2 MiB、PDF 最多 8 MiB，补充材料数量另有限制。'), file, url.row, button('读取并加入材料', 'button', () => void perform(async () => {
      if(busy || queueActive)return;
      if(importedSources.length>=budget.maxSources)throw new Error(`已达到 ${budget.maxSources} 份补充材料上限。`);
      if (!services.readSource) throw new Error('材料读取暂不可用。'); const address = validatePublicUrl(url.input.value.trim());
      busy=true;
      try {
      if (!await services.permissions.request([address.origin])) { say('未获得该来源的读取权限。'); return; }
      const source = await services.readSource(address.href, crypto.randomUUID(), 'manual'); importedSources.push(source); say(`已加入 ${source.title}。${source.status === 'read' ? '原文已读取。' : '仅保留资料缺口。'}`);
      } finally { busy=false;render(); }
    })), note(`已补充 ${importedSources.length} 份材料。材料在新分析开始时纳入；旧报告保持原版本。`)));
  }
  function renderComparison() {
    const output = el('div');
    content.append(section('冻结输入复跑', note('抽取轨道固定整份原文；评价轨道固定原文、主张、核查问题和证据。模型结果不会覆盖原报告。')));
    if (report) {
      const basis = structuredClone(report); const choices = el('div'); const selected = new Set<string>();
      for (const cfg of configurations) {
        const label = el('label', 'analysis-consent'); const check = el('input'); check.type = 'checkbox'; check.disabled = !cfg.hasKey;
        check.onchange = () => { if (check.checked) selected.add(cfg.id); else selected.delete(cfg.id); };
        label.append(check, document.createTextNode(`${cfg.name} · ${cfg.model} · ${new URL(cfg.baseUrl).origin}${cfg.hasKey ? '' : '（需填写 Key）'}`)); choices.append(label);
      }
      const track = el('select'); track.setAttribute('aria-label', '复跑轨道');
      for (const [value, text] of [['rating', '固定主张和证据，复跑回复评价'], ['extraction', '固定原文，独立抽取并分析']]) { const item = el('option', '', text); item.value = value!; track.append(item); }
      const repeats = inputField('每个配置重复次数（1–3）', '1', 'number'); repeats.input.min = '1'; repeats.input.max = '3';
      const ceiling = inputField('整个复跑队列的调用上限', '30', 'number'); ceiling.input.min = '1'; ceiling.input.max = '500';
      const consent = el('input'); consent.type = 'checkbox'; const consentLabel = el('label', 'analysis-consent'); consentLabel.append(consent, document.createTextNode('将这份原文及所选轨道所需材料发给以上选中的服务商。复跑只比较差异，不自动获得标准分析资格。'));
      const start = button('执行选中的复跑队列', 'button primary', () => void perform(async () => {
        if (busy || queueActive || !consent.checked || !selected.size) { say('请选择已配置 Key 的模型，并确认发送范围。'); return; }
        const count = Number(repeats.input.value), cap = Number(ceiling.input.value);
        if (![1,2,3].includes(count) || !Number.isInteger(cap) || cap < 1 || cap > 500) throw new Error('重复次数或调用预算无效。');
        queueActive = true; queueCancelled = false;
        let spent = 0; const ids = [...selected]; const runs: string[] = [];
        try {
        for (const id of ids) for (let round = 1; round <= count; round++) {
          if (spent >= cap || disposed || queueCancelled) { say(`队列已暂停：${queueCancelled ? '用户取消' : '达到调用上限'}。已保存 ${runs.length} 个运行记录。`); return; }
          const cfg = configurations.find(c => c.id === id)!;
          current = await createReplayRun(basis, cfg, track.value as ReplayTrack, { ...budget, maxCalls: cap - spent, maxOutputTokens: cfg.maxOutputTokens });
          await save(current); await run();
          const finished = current as RunCheckpoint; spent += finished.callsUsed; runs.push(finished.id);
          if (finished.state !== 'completed') { say(`复跑队列已停止于 ${cfg.name} 第 ${round} 次。${STATE_NAMES[finished.state]}；已保存的任务可从历史继续。`); return; }
        }
        say(`复跑队列完成：${runs.length} 个运行、${spent} 次调用。请在下方选择两个记录查看差异。`);
        } finally { queueActive = false; refreshAfterTask(); }
      }));
      start.disabled = busy || queueActive; content.append(section(`当前复跑依据：${basis.snapshot.title}`, choices, track, repeats.row, ceiling.row, consentLabel, start, button('取消当前复跑', 'button', () => { queueCancelled = true; controller?.abort(); if (current) void services.request({ type:'analysis:cancel', jobId:current.id }); })));
    } else content.append(note('先从历史打开一份分析包，再选择复跑配置。'));
    const left = el('select'), right = el('select'); left.setAttribute('aria-label', '对比记录 A'); right.setAttribute('aria-label', '对比记录 B');
    const compare = button('查看两份记录的差异', 'button', () => void perform(async () => {
      const [a,b] = await Promise.all([services.repo.getPackage(left.value),services.repo.getPackage(right.value)]); if (!a || !b) throw new Error('请选择两份已保存记录。');
      const [extraction,rating] = await Promise.all([compareExtractions(a,b),compareRatings(a,b)]); output.replaceChildren();
      output.append(section('原文与主张抽取', note(extraction.comparable ? `可对比：A ${extraction.counts.leftClaims} 项，B ${extraction.counts.rightClaims} 项。` : `无法直接对比：${extraction.differences.join('、')} 不同。`), note(extraction.note)));
      if (extraction.comparable) output.append(table(['A 主张','B 主张','对齐形态','需复核的变化'],extraction.groups.map(g=>[g.leftClaimIds.join('、'),g.rightClaimIds.join('、'),({matched:'对应',split:'拆分',merge:'合并',complex:'复杂交叉'})[g.kind],g.changes.join('、') || '结构未变'])),note(`仅 A 出现：${extraction.leftOnly.join('、') || '无'}；仅 B 出现：${extraction.rightOnly.join('、') || '无'}。这些是候选差异，不能直接认定为错漏。`));
      output.append(section('同一输入的回复评价', note(rating.comparable ? `相同等级 ${rating.counts.equalDimensions}/${rating.counts.comparedDimensions} 个维度；缺失 A ${rating.counts.missingLeft}、B ${rating.counts.missingRight} 个单元。` : `禁止直接计算评级一致率：${rating.differences.join('、')} 不同。`),note(rating.note)));
      if (rating.comparable) output.append(table(['评价单元','维度','A','B','结果'],rating.units.flatMap(unit=>unit.status==='compared' ? Object.entries(unit.dimensions).map(([d,v])=>[unit.id,DIMENSIONS[d as keyof typeof DIMENSIONS],v!.left,v!.right,v!.same ? (v!.explanationChanged ? '等级相同，解释变化' : '相同') : '等级不同']) : [[unit.id,'—','—','—',unit.status]])));
    }));
    content.append(section('对比本机运行记录',left,right,compare),output);
    void perform(async () => { const history=await services.repo.list(); if (view!=='compare' || disposed) return; for (const item of history) for (const select of [left,right]) {const option=el('option','',`${item.title} · ${item.createdAt} · ${item.id.slice(0,8)}`);option.value=item.id;select.append(option);} if(history.length>1)right.value=history.at(-1)!.id; });
  }
  function renderCalibration() {
    const panel = section('固定样例校准', note('校准针对当前接口、型号、声明版本、参数和规则版本。连接通过、结构通过、规则参考一致是不同结果。当前内置的是合成试验集，不是独立人工专家认证。'));
    const choose = el('select'); choose.setAttribute('aria-label', '校准配置');
    configurations.forEach(cfg => { const option = el('option', '', `${cfg.name} · ${cfg.model}${cfg.hasKey ? '' : '（需填写 Key）'}`); option.value = cfg.id; choose.append(option); }); choose.value = modelId;
    choose.onchange = () => { modelId = choose.value; calibrationResult = null; render(); }; choose.disabled = busy || queueActive;
    panel.append(choose); content.append(panel);
    const cfg = configurations.find(item => item.id === modelId);
    if (!cfg) { panel.append(note('请先在模型设置中添加配置。')); return; }
    const output = el('div'); content.append(output);
    void perform(async () => {
      const [info, batches] = await Promise.all([services.request({ type:'analysis:calibration:info' }), services.request({ type:'analysis:calibration:list', configId:cfg.id })]);
      if (view !== 'calibration' || modelId !== cfg.id || disposed) return;
      panel.append(note(`${info.cases.length} 个样例 × ${info.thresholds.repetitions} 次重复；原文抽取和固定证据评级分开执行。冻结时间 ${info.frozenAt}。`), note(info.referenceLabel), note(`方法 ${info.methodVersion} · 样例指纹 ${info.hash}`));
      const cap = inputField('新整轮校准的总调用上限', '30', 'number'); cap.input.min='1'; cap.input.max='500';
      const consent = el('input'); consent.type='checkbox'; const consentLabel=el('label','analysis-consent'); consentLabel.append(consent, document.createTextNode(`将合成样例的原文、主张和给定资料发至 ${new URL(cfg.baseUrl).origin}。校准不联网检索，参考答案不会发给被测模型；会产生模型调用费用。`));
      panel.append(cap.row, note(`本轮至少需要 ${info.cases.length*info.thresholds.repetitions} 次调用，抽取样例通常还需多步请求。默认 30 次只用于小额试跑，无法完成整轮准入；达到上限即暂停，不能只挑答对的样例计入成绩。`), consentLabel);
      const startBatch = async (batch: CalibrationBatch) => {
        if (busy || queueActive || !consent.checked) { say('请确认发送范围，且等待当前任务结束。'); return; }
        busy=true; queueCancelled=false; calibrationId=batch.id; calibrationResult=null; refreshAfterTask();
        try {
          while (!disposed && !queueCancelled && batch.slots.some(slot => slot.state === 'pending') && batch.callsUsed < batch.maxCalls) {
            say(`校准中 · ${batch.slots.filter(slot=>slot.state!=='pending').length}/${batch.slots.length} 个运行 · 已占用 ${batch.callsUsed}/${batch.maxCalls} 次调用`);
            batch = await services.request({type:'analysis:calibration:step',batchId:batch.id});
            if (batch.state === 'paused') break;
          }
          say(`本轮已保存：${batch.slots.filter(slot=>slot.state==='completed').length}/${batch.slots.length} 个运行完成，已占用 ${batch.callsUsed}/${batch.maxCalls} 次调用。失败和弃判均保留。`);
        } finally { busy=false;calibrationId=null;refreshAfterTask(); }
      };
      const start=button('新建并执行整轮校准','button primary',()=>void perform(async()=>{
        if (busy || queueActive || !consent.checked) {say('请先确认发送范围。');return;}
        busy=true;start.disabled=true;
        let batch:CalibrationBatch;
        try { batch=await services.request({type:'analysis:calibration:create',configId:cfg.id,maxCalls:Number(cap.input.value)}); }
        catch(error) { busy=false;refreshAfterTask();throw error; }
        busy=false;
        if(disposed)return;
        await startBatch(batch);
      }));start.disabled=busy || queueActive || !cfg.hasKey;panel.append(start);
      const stop=button('取消当前校准','button',()=>{queueCancelled=true;if(calibrationId)void services.request({type:'analysis:cancel',jobId:calibrationId});});stop.disabled=!calibrationId;panel.append(stop);
      for (const batch of (batches as CalibrationBatch[]).slice().reverse()) {
        const card=section(`试验 ${batch.id.slice(0,8)}`,note(`${batch.createdAt} · 已占用 ${batch.callsUsed}/${batch.maxCalls} 次调用 · 保留整轮全部 ${batch.slots.length} 个槽位`),table(['样例','轮次','状态'],batch.slots.map(slot=>[slot.caseId,String(slot.repetition),({pending:'未执行',running:'执行中',completed:'完成',failed:'失败',cancelled:'已取消',paused:'预算暂停',interrupted:'后台中断'})[slot.state] || slot.state])));
        const resume=button('继续本轮待执行样例','button',()=>void perform(()=>startBatch(batch)));resume.disabled=busy || queueActive || !cfg.hasKey || !batch.slots.some(slot=>slot.state==='pending') || batch.callsUsed>=batch.maxCalls;
        const assess=button('检查本轮准入条件','button',()=>void perform(async()=>{if(busy)return;calibrationResult=await services.request({type:'analysis:calibration:assess',batchId:batch.id});render();}));assess.disabled=busy;
        card.append(resume,assess);output.append(card);
      }
      if (calibrationResult) {
        const result=calibrationResult;const fraction=(f:Fraction)=>`${f.numerator}/${f.denominator}${f.rate===null?'（不可计算）':`（${(f.rate*100).toFixed(1)}%）`}`;
        output.prepend(section(result.status==='qualified_trial'?'通过本轮试验条件':'尚未通过本轮试验条件',note(`有效运行 ${result.acceptedRuns}/${result.expectedRuns}；${result.metrics.usage.calls} 次调用；输入 Token ${result.metrics.usage.inputTokens??'未知'}，输出 Token ${result.metrics.usage.outputTokens??'未知'}。`),table(['维度','参考状态一致','确定等级答对','确定等级覆盖','重复一致'],(['R','E','L','B'] as const).map(d=>[DIMENSIONS[d],fraction(result.metrics.dimensions[d].referenceAgreement),fraction(result.metrics.dimensions[d].determinateAgreement),fraction(result.metrics.dimensions[d].determinateCoverage),fraction(result.metrics.dimensions[d].repeatAgreement)])),note(`抽取结构字段一致：${fraction(result.metrics.extraction.structureAgreement)}。这是固定字段检查，不等同于语义正确率。`),...result.reasons.map(reason=>note(`未满足：${USER_ERRORS[reason] || reason}`)),...result.limitations.map(note)));
      }
    });
  }
  function render() {
    if (disposed) return;
    refreshVisibleReport = null; readingVisibleReport = () => false; updateProgress();
    nav.replaceChildren(); for (const key of Object.keys(VIEW_NAMES) as View[]) { const item = button(VIEW_NAMES[key], 'analysis-nav-item', () => setView(key)); item.setAttribute('aria-current', view === key ? 'page' : 'false'); nav.append(item); }
    content.replaceChildren();
    if (view === 'settings') { renderSettings(); return; }
    if (view === 'history') {
      content.append(section('本机分析历史', note('历史只保存在此浏览器。删除前可先导出分析包。')));
      void perform(async () => {
        const history = await services.repo.list(); if (view !== 'history' || disposed) return;
        if (!history.length) content.append(note('还没有保存的分析。'));
        for (const item of history.reverse()) content.append(section(item.title, note(`${item.createdAt} · ${item.status === 'partial' ? '部分完成' : '本轮完成'}`), button('打开', 'button', () => void perform(async () => { if (busy || queueActive) { say('正在分析，请先完成或取消本次任务。'); return; } report = await services.repo.getPackage(item.id); current = await services.repo.getJob(item.id); topic = report?.snapshot.url || ''; setView('overview'); })), button('导出', 'button', () => void perform(async () => { const pkg = await services.repo.getPackage(item.id); if (pkg) download(await exportPackage(pkg), `讨论分析-${pkg.snapshot.topicId}-${pkg.id}.json`); })), button('删除本条', 'button', () => void perform(async () => { if (busy || queueActive) { say('正在分析，请先完成或取消本次任务。'); return; } await services.repo.delete(item.id); if (current?.id === item.id) current = null; if (report?.id === item.id) report = null; render(); }))));
      }); return;
    }
    if (view === 'compare') { renderComparison(); return; }
    if (view === 'calibration') { renderCalibration(); return; }
    if (view === 'overview') renderStart();
    if (report) {
      const rendered = el('div'); let shown=report; const reportView=view; renderReport(rendered,shown,reportView);
      content.append(rendered,button('导出这份分析包','button',()=>void perform(async()=>download(await exportPackage(shown),`讨论分析-${shown.snapshot.topicId}.json`))));
      renderExcerptReview(shown);
      readingVisibleReport = () => rendered.parentNode === content && (rendered.contains(document.activeElement) || Boolean(rendered.querySelector('details[open]')));
      refreshVisibleReport = () => {
        if (!report || report === shown || rendered.parentNode !== content) return;
        // Do not replace an excerpt the user is reading or move keyboard focus during a checkpoint.
        if (readingVisibleReport()) return;
        shown = report; renderReport(rendered, shown, reportView);
      };
      const qualificationPackage = shown;
      void hashValue(qualificationPackage).then(packageHash=>services.request({type:'analysis:report:qualification',packageId:qualificationPackage.id,packageHash})).then(qualification=>{
        if(!disposed && rendered.parentNode===content && report===qualificationPackage && !readingVisibleReport())renderReport(rendered,qualificationPackage,reportView,qualification);
      }).catch(()=>{/* The default rendering explicitly leaves qualification unverified. */});
    }
    else content.append(section('尚无分析结果', note('先配置模型并采集一篇帖子。开始分析前可检查采集范围、接收服务和预算。')));
    if (view === 'evidence' || view === 'overview') renderMaterials();
  }
  await refreshConfigurations();
  if (initialTopic && initialView === 'overview') {
    const canonical = topicUrl(initialTopic);
    await perform(async () => {
      const history = (await services.repo.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      for (const item of history) {
        const saved = await services.repo.getPackage(item.id);
        if (!saved || topicUrl(saved.snapshot.url) !== canonical) continue;
        report = saved; current = await services.repo.getJob(saved.id);
        if (current) {
          modelId = current.package.provenance.modelConfigId;
          const error = current.errors.at(-1)?.code;
          say(`已恢复本帖分析：${STATE_NAMES[current.state]}${error ? ` · ${USER_ERRORS[error] || error}` : ''}。${current.state === 'completed' ? '展示已保存结论，不会重复调用模型。' : '继续前请确认发送范围与剩余额度。'}`);
        } else say('已读取本帖保存的分析结果，不会重复调用模型。');
        break;
      }
    });
    if (options.compact && !report && configurations.find(c => c.id === modelId)?.hasKey) await perform(() => captureTopic(canonical));
  }
  render();
  return () => { disposed = true; queueCancelled=true;controller?.abort(); if (calibrationId) void services.request({type:'analysis:cancel',jobId:calibrationId}); if (current && busy) void services.request({ type: 'analysis:cancel', jobId: current.id }); root.replaceChildren(); };
}
