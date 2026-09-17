import { hashValue } from './contracts';
import { groupEvidenceRoots, type SearchLead } from './evidence';
import { validatePublicUrl } from './providers';
import { AnalysisPause, type EvidenceControls } from './engine';
import { directionLabel, QuestionSearchStop } from './planning';
import type { AnalysisBudget, AnalysisPackage, EvidenceSource } from './types';

interface RetrievalServices {
  search?(query: string, signal?: AbortSignal): Promise<SearchLead[]>;
  hasPermission(origin: string): Promise<boolean>;
  read(url: string, signal?: AbortSignal): Promise<EvidenceSource>;
}
/** Evidence choices and their omissions are explicit; summaries never become source content. */
export async function gatherEvidence(pkg: AnalysisPackage, budget: AnalysisBudget, signal: AbortSignal | undefined, controls: EvidenceControls, services: RetrievalServices) {
  const sources = new Map(pkg.sources.map(s => [s.id, structuredClone(s)]));
  const gaps: string[] = []; let omittedLinks = 0;
  const cancelled = () => { if (signal?.aborted) throw new Error('cancelled'); };
  const lead = async (url: string, title: string): Promise<EvidenceSource> => {
    const id = `S-${(await hashValue(url)).slice(0, 16)}`;
    return { id, url, title, publisher: '', publishedAt: null, retrievedAt: new Date().toISOString(), status:'lead', kind:'html', text:'', locator:'', rootId:id, introducedBy:'system', introducedAtMessageId:null, limitations:['尚未读取原始材料；检索摘要仅是线索。'], data:[] };
  };
  // Original links take priority so a later search cannot rewrite their provenance.
  for (const message of pkg.snapshot.messages) for (const item of message.links) {
    cancelled();
    let url: URL; try { url=validatePublicUrl(item.url); } catch { continue; }
    if (['guozaoke.com','www.guozaoke.com'].includes(url.hostname)) continue;
    const existing = [...sources.values()].find(s=>s.url===url.href);
    if (!existing && sources.size>=budget.maxSources) { omittedLinks++; continue; }
    const candidate=existing ?? await lead(url.href,item.label || url.hostname);
    if (candidate.introducedBy==='system' && pkg.snapshot.completeness==='complete') {
      candidate.introducedBy=message.authorId;candidate.introducedAtMessageId=message.id;
    } else if (pkg.snapshot.completeness!=='complete') candidate.limitations=[...new Set([...candidate.limitations,'采集有缺口，无法确认本帖首次引入者。'])];
    sources.set(candidate.id,candidate);
  }
  if (omittedLinks) gaps.push(`${omittedLinks} 条帖内来源链接因本轮来源上限未纳入。`);
  await controls.checkpoint([...sources.values()]);
  const questions=pkg.questions.filter(q=>q.disagreement!=='value');
  for (const question of questions.filter(q=>!q.plan)) gaps.push(`${question.id} 未建立可执行核查计划；正向、反向检索均未执行，需要建立新分析，不能据此认定没有证据。`);
  if (services.search) {
    // Reserve a supporting and a counter-search for each selected question; keep one lead per query.
    // Base selection on the frozen budget, not on sources accumulated during a prior attempt.
    const planned=questions.filter(q=>q.plan);
    const selected=planned.slice(0,Math.ceil(budget.maxSources/2));
    const queriesFor=(items:typeof selected)=>items.flatMap(q=>q.plan!.searches.map(search=>({...search,questionId:q.id,plan:q.plan!})));
    const queries=queriesFor(selected);
    const completed=new Set<string>(), stopped=new Set<string>();
    const isCompleted=async(item:typeof queries[number])=>completed.has(`${item.questionId}:${item.direction}`) || Boolean(await controls.searchCompleted?.(item.query));
    const incomplete=async(items:typeof queries,reason:string)=>{
      const pending:typeof queries=[];
      for(const item of items) if(!await isCompleted(item)) pending.push(item);
      if(pending.length) gaps.push(`${pending.length} 次计划内外部检索因${reason}未在本次继续执行（${pending.map(item=>`${item.questionId} ${directionLabel(item.direction)}`).join('、')}）；本次检索未完成，已保存结果仍可使用，不能据此认定没有证据。`);
    };
    await incomplete(queriesFor(planned.slice(selected.length)),'来源上限');
    for (const [index,item] of queries.entries()) {
      const {query,questionId,direction,plan}=item;
      cancelled();
      if(stopped.has(questionId) || await isCompleted(item)) continue;
      if (sources.size>=budget.maxSources) {await incomplete(queries.slice(index),'来源上限');break;}
      if(Date.now()>=Date.parse(plan.deadlineAt)) {await incomplete(queries.slice(index).filter(q=>q.questionId===questionId),'达到截止时间');stopped.add(questionId);continue;}
      let found: EvidenceSource[];
      try {
        found=await controls.search(query,async searchSignal=>{
          const leads=await services.search!(query,searchSignal ?? signal);
          const candidates: EvidenceSource[]=[];
          for (const item of leads) {
            let url: URL;try {url=validatePublicUrl(item.url);}catch {continue;}
            if ([...sources.values()].some(s=>s.url===url.href)) continue;
            candidates.push(await lead(url.href,item.title));break;
          }
          return candidates;
        },{questionId,direction});
      } catch (error) {
        if(error instanceof QuestionSearchStop) {
          await incomplete(queries.slice(index).filter(q=>q.questionId===questionId),error.code==='deadline_reached'?'达到截止时间':'单问题预算耗尽');
          stopped.add(questionId); await controls.recordGaps?.(gaps); continue;
        }
        if (error instanceof AnalysisPause && error.code==='budget_exhausted') {
          await incomplete(queries.slice(index),'总预算耗尽');
        } else if(!signal?.aborted) await incomplete(queries.slice(index),'本次请求失败');
        await controls.recordGaps?.(gaps);
        throw error;
      }
      completed.add(`${questionId}:${direction}`);
      for (const source of found) if (!sources.has(source.id) && sources.size<budget.maxSources) sources.set(source.id,source);
      await controls.checkpoint([...sources.values()]);
    }
  } else gaps.push(`未配置外部检索；本轮仅核对帖内链接和手动补充材料，未执行外部双向检索${questions.length?`（${questions.map(q=>`${q.id} 正向、${q.id} 反向`).join('、')}）`:''}。`);
  const pendingOrigins=new Set<string>();
  for (const source of sources.values()) {
    cancelled(); if (source.status!=='lead' || !source.url) continue;
    const origin=new URL(source.url).origin;
    if (!await services.hasPermission(origin)) {pendingOrigins.add(origin);continue;}
    try {
      const read=await services.read(source.url,signal);cancelled();
      sources.set(source.id,{...read,id:source.id,rootId:source.rootId,introducedBy:source.introducedBy,introducedAtMessageId:source.introducedAtMessageId,limitations:[...new Set([...source.limitations.filter(x=>!x.includes('尚未读取')), ...read.limitations])]});
    } catch {cancelled();sources.set(source.id,{...source,status:'unreadable',limitations:[...source.limitations,'本次未能读取原始材料。']});}
    await controls.checkpoint([...sources.values()]);
  }
  const grouped=groupEvidenceRoots([...sources.values()]);await controls.checkpoint(grouped);await controls.recordGaps?.(gaps);
  return {sources:grouped,pendingOrigins:[...pendingOrigins],gaps};
}
