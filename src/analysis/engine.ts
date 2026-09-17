import { assertPackage, hashValue, validateSnapshot } from './contracts';
import { normalizeModelConfig, type ChatResult, type ModelConfig } from './providers';
import { buildMessages } from './prompts';
import { splitSpans } from './snapshot';
import { createQuestionPlan, QuestionSearchStop } from './planning';
import { DEFAULT_SOURCE_BYTES } from './source-budget';
import { METHOD_VERSION, type AnalysisBudget, type AnalysisPackage, type AnalysisQuestion, type EvidenceSource, type RunCheckpoint, type SearchDirection, type Snapshot, type Stage, type ThreadMessage } from './types';

export const DEFAULT_BUDGET: AnalysisBudget = { maxCalls: 30, maxInputCharacters: 400_000, maxSources: 12, maxOutputTokens: 4096, maxSourceBytes: DEFAULT_SOURCE_BYTES };
const STAGES: Stage[] = ['claims', 'plan', 'evidence', 'relations', 'replies', 'report'];
export interface EngineDependencies {
  call(stage: Stage, input: unknown, signal?: AbortSignal): Promise<ChatResult>;
  save(job: RunCheckpoint): Promise<void>;
  acquireEvidence?(pkg: AnalysisPackage, budget: AnalysisBudget, signal: AbortSignal | undefined, controls: EvidenceControls): Promise<EvidenceSource[]>;
  onProgress?(job: RunCheckpoint): void;
}
export interface EvidenceControls {
  search(query: string, run: (signal?: AbortSignal) => Promise<EvidenceSource[]>, task?: {questionId: string; direction: SearchDirection}): Promise<EvidenceSource[]>;
  searchCompleted?(query: string): Promise<boolean>;
  checkpoint(sources: EvidenceSource[]): Promise<void>;
  recordGaps?(gaps: string[]): Promise<void>;
}
export class AnalysisPause extends Error {
  constructor(readonly code: 'permission_required' | 'materials_required' | 'budget_exhausted') { super(code); }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value: unknown, expected: string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) throw new Error('stage_schema');
}
const sortedIds = (values: string[]) => [...values].sort().join('|');
export function validateBudget(budget: AnalysisBudget): AnalysisBudget {
  for (const [key, min, max] of [['maxCalls', 1, 500], ['maxInputCharacters', 1000, 4_000_000], ['maxSources', 0, 30], ['maxOutputTokens', 128, 32768]] as const) {
    if (!Number.isSafeInteger(budget[key]) || budget[key] < min || budget[key] > max) throw new Error('invalid_budget');
  }
  const maxSourceBytes=budget.maxSourceBytes ?? DEFAULT_BUDGET.maxSourceBytes!;
  if (!Number.isSafeInteger(maxSourceBytes) || maxSourceBytes<1024 || maxSourceBytes>64*1024*1024) throw new Error('invalid_budget');
  return { maxCalls: budget.maxCalls, maxInputCharacters: budget.maxInputCharacters, maxSources: budget.maxSources, maxOutputTokens: budget.maxOutputTokens, maxSourceBytes };
}
export function createRun(snapshot: Snapshot, input: ModelConfig, budget: AnalysisBudget = DEFAULT_BUDGET): RunCheckpoint {
  const issues = validateSnapshot(snapshot); if (issues.length) throw new Error(`snapshot: ${issues[0]!.message}`);
  const config = normalizeModelConfig(input); const now = new Date().toISOString(); const id = crypto.randomUUID();
  return {
    id, package: { formatVersion: 1, methodVersion: METHOD_VERSION, id, createdAt: now, snapshot: structuredClone(snapshot), claims: [], coverage: [], questions: [], sources: [], relations: [], evaluations: [], status: 'partial', unresolved: [...snapshot.gaps], provenance: { mode: 'exploratory', modelConfigId: config.id, endpoint: config.baseUrl, model: config.model, providerModel: null, declaredVersion: config.declaredVersion, parameters: { temperature: config.temperature, maxOutputTokens: config.maxOutputTokens }, stageHashes: {}, qualificationId: null } },
    stage: 'claims', state: 'ready', budget: validateBudget(budget), callsUsed: 0, inputCharactersUsed: 0, inputTokens: 0, outputTokens: 0,
    completedStages: [], errors: [], requests: [], searchAttempts: [], updatedAt: now,
  };
}

export function evaluationUnits(pkg: AnalysisPackage, messages: ThreadMessage[]) {
  return messages.map(message => {
    const floors = [...message.text.matchAll(/(?:^|\s|[，,])#(\d+)\b/g)].map(m => Number(m[1]));
    const targets = floors.length ? pkg.snapshot.messages.filter(m => m.floor !== null && floors.includes(m.floor)).map(m => m.id) : pkg.snapshot.messages.filter(m => m.kind === 'topic').map(m => m.id);
    const claims = pkg.claims.filter(c => c.messageId === message.id);
    return (claims.length ? claims.map(claim => [claim.id]) : [[]]).map(claimIds => ({ id: `V-${claimIds[0] || message.id}`, messageId: message.id, claimIds, targetMessageIds: targets, missingTarget: floors.some(f => !pkg.snapshot.messages.some(m => m.floor === f)) }));
  }).flat();
}

/** Merge only a closed, cross-referenced stage result into a fresh package. */
export function stageOutput(pkg: AnalysisPackage, stage: Stage, value: unknown, messages: ThreadMessage[] = []): AnalysisPackage {
  const next = structuredClone(pkg);
  if (stage === 'claims') {
    keys(value, ['claims', 'coverage']);
    if (!Array.isArray(value.claims) || !Array.isArray(value.coverage)) throw new Error('stage_schema');
    next.claims.push(...value.claims); next.coverage.push(...value.coverage);
    // Verify author/quote contracts before using the candidate's IDs.
    assertPackage(next);
    const expected = messages.flatMap(splitSpans).map(span => `${span.messageId}:${span.start}:${span.end}:${span.quote}`);
    const got = (value.coverage as AnalysisPackage['coverage']).map(unit => `${unit.span.messageId}:${unit.span.start}:${unit.span.end}:${unit.span.quote}`);
    if (sortedIds(expected) !== sortedIds(got)) throw new Error('coverage: 句段抽取有缺失或重复');
    const allowed = new Set(messages.map(m => m.id));
    if ((value.claims as AnalysisPackage['claims']).some(c => !allowed.has(c.messageId))) throw new Error('ownership: 超出本批原文');
  } else if (stage === 'plan') {
    keys(value, ['questions']); if (!Array.isArray(value.questions) || value.questions.length > 8) throw new Error('stage_schema');
    const frozenAt=new Date().toISOString();
    next.questions = value.questions.map(question => {
      keys(question,['id','claimIds','question','needed','disagreement']);
      // Validate the model's closed draft before dereferencing any proposed claim ID.
      const draft=question as unknown as Omit<AnalysisQuestion,'plan'>;
      const candidate={...structuredClone(next),questions:[{...draft,plan:null}]}; assertPackage(candidate);
      return {...draft,plan:createQuestionPlan(draft,next.claims,frozenAt)};
    });
  } else if (stage === 'relations') {
    keys(value, ['relations', 'data']); if (!Array.isArray(value.relations) || !Array.isArray(value.data)) throw new Error('stage_schema');
    next.relations.push(...value.relations);
    for (const datum of value.data) {
      keys(datum, ['sourceId', 'items']);
      const source = next.sources.find(s => s.id === datum.sourceId);
      if (!source || !Array.isArray(datum.items)) throw new Error('reference: 来源数据无对应材料');
      source.data.push(...datum.items);
    }
  } else if (stage === 'replies') {
    keys(value, ['evaluations']); if (!Array.isArray(value.evaluations)) throw new Error('stage_schema');
    next.evaluations.push(...value.evaluations); assertPackage(next);
    const expected = evaluationUnits(pkg, messages);
    if (sortedIds(expected.map(u => u.id)) !== sortedIds(value.evaluations.map(u => u.id))) throw new Error('coverage: 评价单元有缺失或重复');
    for (const unit of expected) {
      const actual = next.evaluations.find(e => e.id === unit.id)!;
      if (actual.messageId !== unit.messageId || sortedIds(actual.claimIds) !== sortedIds(unit.claimIds) || sortedIds(actual.targetMessageIds) !== sortedIds(unit.targetMessageIds)) throw new Error('ownership: 不能更换冻结的评价任务');
      if (unit.missingTarget && actual.dimensions.R.applicability === 'yes' && actual.dimensions.R.grade !== 'U') throw new Error('context: 缺失回复目标不能确定回应覆盖');
    }
  } else throw new Error('invalid_stage');
  assertPackage(next); return next;
}

function batches(messages: ThreadMessage[]): ThreadMessage[][] {
  const result: ThreadMessage[][] = []; let current: ThreadMessage[] = []; let chars = 0;
  for (const message of messages) {
    if (message.text.length > 24_000) throw new Error('input_too_large: 单条原文超出本次处理能力，不能静默截断');
    if (current.length && (current.length >= 6 || chars + message.text.length > 16_000)) { result.push(current); current = []; chars = 0; }
    current.push(message); chars += message.text.length;
  }
  if (current.length) result.push(current); return result;
}
function contextFor(pkg: AnalysisPackage, messages: ThreadMessage[]) {
  const ids = new Set(evaluationUnits(pkg, messages).flatMap(u => u.targetMessageIds));
  return pkg.snapshot.messages.filter(m => ids.has(m.id) && !messages.some(current => current.id === m.id));
}
function stageInput(pkg: AnalysisPackage, stage: Stage, messages: ThreadMessage[]) {
  if (stage === 'claims') return { topic: { title: pkg.snapshot.title, completeness: pkg.snapshot.completeness, gaps: pkg.snapshot.gaps }, messages, spans: messages.flatMap(splitSpans), context: contextFor(pkg, messages) };
  if (stage === 'plan') return { title: pkg.snapshot.title, claims: pkg.claims };
  if (stage === 'relations') return { claims: pkg.claims, questions: pkg.questions, sources: pkg.sources };
  if (stage === 'replies') return { units: evaluationUnits(pkg, messages), messages, context: contextFor(pkg, messages), claims: pkg.claims.filter(c => messages.some(m => m.id === c.messageId)), sources: pkg.sources, relations: pkg.relations, limitations: pkg.snapshot.gaps };
  return null;
}
function safeCode(error: unknown): string {
  if (object(error) && typeof error.code === 'string' && /^(?:unauthorized|rate_limited|http_error|network|timeout|cancelled|too_large|invalid_json|schema)$/.test(error.code)) return error.code;
  if (error instanceof Error && /^(coverage|ownership|span|reference|unread_evidence|source_attribution|dimension|stage_schema|input_too_large|context|qualification):?/.test(error.message)) return error.message.split(/[: ]/)[0]!;
  return 'stage_failed';
}

function frozenStageData(pkg: AnalysisPackage, stage: Stage) {
  if (stage === 'claims') return { claims: pkg.claims, coverage: pkg.coverage };
  if (stage === 'plan') return pkg.questions;
  if (stage === 'evidence') return pkg.sources.map(({ data: _derived, ...source }) => source);
  if (stage === 'relations') return { data: pkg.sources.map(s => ({ id: s.id, data: s.data })), relations: pkg.relations };
  if (stage === 'replies') return pkg.evaluations;
  return pkg.unresolved;
}

function requestOutput(pkg: AnalysisPackage, stage: Stage, messages: ThreadMessage[]) {
  const ids = new Set(messages.map(m => m.id));
  if (stage === 'claims') return { claims: pkg.claims.filter(c => ids.has(c.messageId)), coverage: pkg.coverage.filter(c => ids.has(c.span.messageId)) };
  if (stage === 'replies') return { evaluations: pkg.evaluations.filter(e => ids.has(e.messageId)) };
  if (stage === 'plan') return { questions: pkg.questions };
  if (stage === 'relations') return { relations: pkg.relations, data: pkg.sources.map(s => ({ sourceId: s.id, items: s.data })) };
  throw new Error('invalid_stage');
}

function stageGroups(pkg: AnalysisPackage, stage: Stage) {
  return stage === 'claims' ? batches(pkg.snapshot.messages) : stage === 'replies' ? batches(pkg.snapshot.messages.filter(m => m.kind === 'reply')) : [[]];
}

export async function executeRun(initial: RunCheckpoint, deps: EngineDependencies, signal?: AbortSignal): Promise<RunCheckpoint> {
  const job = structuredClone(initial); assertPackage(job.package); job.budget = validateBudget(job.budget);
  if (!Array.isArray(job.searchAttempts)) throw new Error('plan: 旧任务缺少逐问题调用记录，请建立新分析');
  if (job.package.methodVersion !== METHOD_VERSION) throw new Error('method_changed: 旧规则任务需要建立新分析');
  const snapshotHash = await hashValue(job.package.snapshot);
  if (job.package.provenance.stageHashes.snapshot && job.package.provenance.stageHashes.snapshot !== snapshotHash) throw new Error('frozen_input_changed: 原文已变化，请建立新分析');
  job.package.provenance.stageHashes.snapshot = snapshotHash;
  for (const stage of job.completedStages) {
    if (job.package.provenance.stageHashes[stage] !== await hashValue(frozenStageData(job.package, stage))) throw new Error('frozen_input_changed: 已冻结的阶段内容发生变化');
  }
  // A crash can occur after a successful batch but before the whole stage is marked complete.
  for (const request of job.requests.filter(r => r.stage !== 'evidence')) {
    const group = stageGroups(job.package, request.stage).find((_g, index) => request.id === `${request.stage}:${index}`);
    if (!group || request.outputHash !== await hashValue(requestOutput(job.package, request.stage, group))) throw new Error('frozen_input_changed: 已保存批次被修改，请建立新分析');
  }
  const persist = async () => { job.updatedAt = new Date().toISOString(); await deps.save(structuredClone(job)); deps.onProgress?.(structuredClone(job)); };
  job.state = 'running'; await persist();
  const cancel = async () => { job.state = 'cancelled'; await persist(); return job; };
  for (const stage of STAGES) {
    if (signal?.aborted) return cancel();
    if (job.completedStages.includes(stage)) continue;
    job.stage = stage;
    try {
      if (stage === 'evidence') {
        if (deps.acquireEvidence && job.budget.maxSources > 0) {
          const sources = await deps.acquireEvidence(structuredClone(job.package), job.budget, signal, {
            searchCompleted: async query => { const id=`search:${await hashValue(query)}`; return job.requests.some(r=>r.id===id); },
            recordGaps: async gaps => { job.package.unresolved = [...new Set([...job.package.unresolved, ...gaps])]; await persist(); },
            checkpoint: async sources => {
              if (sources.length > job.budget.maxSources) throw new Error('stage_schema: 来源超限');
              job.package.sources = structuredClone(sources); assertPackage(job.package); await persist();
            },
            search: async (query, run, task) => {
              if (signal?.aborted) throw new Error('cancelled');
              const question=job.package.questions.find(q=>q.id===task?.questionId);
              const plan=question?.plan;
              if (!task || !plan || !plan.searches.some(s=>s.direction===task.direction && s.query===query)) throw new Error('plan: 检索必须来自冻结核查计划');
              const inputHash = await hashValue(query); const id = `search:${inputHash}`;
              const previous = job.requests.find(r => r.id === id);
              if (previous) return job.package.sources.filter(s => previous.sourceIds.includes(s.id));
              if (Date.now()>=Date.parse(plan.deadlineAt)) throw new QuestionSearchStop('deadline_reached');
              if (job.searchAttempts.filter(a=>a.questionId===question.id).length>=plan.maxSearches) throw new QuestionSearchStop('question_budget_exhausted');
              if (job.callsUsed >= job.budget.maxCalls || job.inputCharactersUsed + query.length > job.budget.maxInputCharacters) throw new AnalysisPause('budget_exhausted');
              const attempt={questionId:question.id,direction:task.direction,requestId:id,startedAt:new Date().toISOString(),status:'started' as const};
              job.searchAttempts.push(attempt);
              job.callsUsed++; job.inputCharactersUsed += query.length; await persist();
              const stored=job.searchAttempts.at(-1)!;
              let found: EvidenceSource[];
              const deadline=new AbortController();
              const timeout=setTimeout(()=>deadline.abort(),Math.max(0,Date.parse(plan.deadlineAt)-Date.now()));
              const cancelSearch=()=>deadline.abort(); signal?.addEventListener('abort',cancelSearch,{once:true});
              let rejectOnAbort!:()=>void;
              const aborted=new Promise<never>((_resolve,reject)=>{
                rejectOnAbort=()=>reject(signal?.aborted?new Error('cancelled'):new QuestionSearchStop('deadline_reached'));
                deadline.signal.addEventListener('abort',rejectOnAbort,{once:true});
              });
              // Saving the reservation may outlast the deadline; a zero-delay timer cannot guard dispatch.
              if(signal?.aborted || Date.now()>=Date.parse(plan.deadlineAt)) deadline.abort();
              try {
                found = await Promise.race([deadline.signal.aborted ? aborted : run(deadline.signal),aborted]);
                if (Date.now()>=Date.parse(plan.deadlineAt)) throw new QuestionSearchStop('deadline_reached');
                if (signal?.aborted) throw new Error('cancelled');
              } catch(error) {
                stored.status='failed'; await persist();
                if (!signal?.aborted && deadline.signal.aborted) throw new QuestionSearchStop('deadline_reached');
                throw error;
              } finally {clearTimeout(timeout);signal?.removeEventListener('abort',cancelSearch);deadline.signal.removeEventListener('abort',rejectOnAbort);}
              const sources = new Map(job.package.sources.map(s => [s.id, s])); found.forEach(s => { if (!sources.has(s.id) && sources.size < job.budget.maxSources) sources.set(s.id, s); });
              job.package.sources = [...sources.values()]; assertPackage(job.package);
              stored.status='completed';
              job.requests.push({ id, stage: 'evidence', inputHash, outputHash: await hashValue(found), providerModel: null, sourceIds: found.filter(s => sources.has(s.id)).map(s => s.id) });
              await persist(); return found.filter(s => sources.has(s.id));
            },
          });
          if (sources.length > job.budget.maxSources) throw new Error('stage_schema: 来源超限');
          job.package.sources = sources; assertPackage(job.package);
        } else {
          const scope=job.package.questions.filter(q=>q.disagreement!=='value').map(q=>`${q.id} 正向、${q.id} 反向`).join('、');
          job.package.unresolved.push(`因${job.budget.maxSources===0?'来源上限为零':'未启用外部检索'}，本次检索未完成${scope?`（${scope}）`:''}；仅使用已导入材料，不能据此认定没有证据。`);
        }
      } else if (stage === 'report') {
        const covered = new Set(job.package.questions.flatMap(q => q.claimIds));
        const unplanned = job.package.claims.filter(c => c.kind === 'empirical' && !covered.has(c.id));
        if (unplanned.length) job.package.unresolved.push(`${unplanned.length} 项事实主张尚未进入本轮优先核查范围。`);
        if (!job.package.sources.some(s => s.status === 'read')) job.package.unresolved.push('尚无已读取的外部材料，不能确定外部事实真假。');
        const noRelation = job.package.claims.filter(c => c.kind === 'empirical' && !job.package.relations.some(r => r.claimId === c.id && r.status !== 'unresolved'));
        if (noRelation.length) job.package.unresolved.push(`${noRelation.length} 项事实主张的材料支持关系待核。`);
        job.package.unresolved = [...new Set(job.package.unresolved)]; job.package.status = 'completed';
      } else {
        const groups = stageGroups(job.package, stage);
        for (const [index, group] of groups.entries()) {
          if (signal?.aborted) return cancel();
          const requestId = `${stage}:${index}`;
          if (job.requests.some(r => r.id === requestId)) continue;
          const input = stageInput(job.package, stage, group);
          const messages = buildMessages(stage, input); const characters = messages.reduce((n, m) => n + m.content.length, 0);
          if (job.callsUsed >= job.budget.maxCalls || job.inputCharactersUsed + characters > job.budget.maxInputCharacters) { job.state = 'paused'; await persist(); return job; }
          job.callsUsed++; job.inputCharactersUsed += characters; await persist();
          const result = await deps.call(stage, input, signal);
          if (signal?.aborted) return cancel();
          // Unknown usage stays unknown. The counts are reported by the provider, not billing guarantees.
          job.inputTokens = result.usage.inputTokens === null || job.inputTokens === null ? null : job.inputTokens + result.usage.inputTokens;
          job.outputTokens = result.usage.outputTokens === null || job.outputTokens === null ? null : job.outputTokens + result.usage.outputTokens;
          const candidate = stageOutput(job.package, stage, result.value, group);
          job.package = candidate; job.package.provenance.providerModel = result.providerModel;
          job.requests.push({ id: requestId, stage, inputHash: await hashValue(messages), outputHash: await hashValue(requestOutput(job.package, stage, group)), providerModel: result.providerModel, sourceIds: [] });
          await persist();
        }
      }
      job.completedStages.push(stage);
      job.package.provenance.stageHashes[stage] = await hashValue(frozenStageData(job.package, stage));
      await persist();
    } catch (error) {
      if (signal?.aborted) return cancel();
      if (error instanceof Error && error.message.startsWith('storage_')) throw error;
      if (error instanceof AnalysisPause) { job.state = 'paused'; job.errors.push({ stage, code: error.code }); await persist(); return job; }
      // Failed requests may have been billed even when the response was unavailable.
      job.inputTokens = null; job.outputTokens = null;
      job.state = 'partial'; job.errors.push({ stage, code: safeCode(error) }); await persist(); return job;
    }
  }
  job.state = 'completed'; await persist(); return job;
}

/** Per-thread observations with explicit denominators, never a composite person rating. */
export function participantSummary(pkg: AnalysisPackage) {
  return [...new Set(pkg.snapshot.messages.filter(m => m.kind === 'reply').map(m => m.authorId))].map(authorId => {
    const messages = pkg.snapshot.messages.filter(m => m.authorId === authorId && m.kind === 'reply');
    const evaluations = pkg.evaluations.filter(e => messages.some(m => m.id === e.messageId));
    const dimensions = Object.fromEntries((['R', 'E', 'L', 'B'] as const).map(key => {
      const items = evaluations.map(e => e.dimensions[key]);
      return [key, { applicable: items.filter(x => x.applicability === 'yes').length, graded: items.filter(x => typeof x.grade === 'number').length, unknown: items.filter(x => x.grade === 'U').length, notApplicable: items.filter(x => x.applicability === 'no').length, pending: items.filter(x => x.applicability === 'uncertain').length }];
    }));
    return { authorId, replies: messages.length, evaluationUnits: evaluations.length, dimensions, introducedSources: new Set(pkg.sources.filter(s => s.introducedBy === authorId && s.status === 'read').map(s => s.rootId)).size, corrections: new Set(evaluations.filter(e => e.contributions.includes('correction')).map(e => e.messageId)).size, attackMessages: new Set(evaluations.filter(e => e.expression.attack === 'present').map(e => e.messageId)).size };
  });
}
