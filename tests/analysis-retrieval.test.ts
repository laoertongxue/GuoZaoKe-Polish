import { expect, it, vi } from 'vitest';
import { gatherEvidence } from '../src/analysis/retrieval';
import { examplePackage as referencePackage, questionDrafts } from './fixtures/analysis/package';
import { AnalysisPause, DEFAULT_BUDGET, stageOutput } from '../src/analysis/engine';

const examplePackage = () => stageOutput(referencePackage(),'plan',{questions:questionDrafts()});

it('prioritizes original participant links and queries both directions when capacity remains', async () => {
  const pkg = examplePackage(); pkg.sources = []; pkg.snapshot.messages[1]!.links = [{url:'https://example.org/report',label:'作者的来源'}];
  let saved = pkg.sources;
  const controls = { checkpoint: async (sources: typeof saved) => { saved = structuredClone(sources); }, search: async (_q: string, run: () => Promise<typeof saved>) => run() };
  const search = vi.fn(async (_query: string) => [{url:'https://example.org/report',title:'结果',snippet:'摘要'}, {url:'https://counter.org/report',title:'另一个结果',snippet:'摘要'}]);
  const result = await gatherEvidence(pkg, {...DEFAULT_BUDGET,maxSources:3}, undefined, controls, { search, hasPermission:async () => true, read:async url => ({...examplePackage().sources[0]!,url}) });
  expect(search).toHaveBeenCalledTimes(2);
  expect(search.mock.calls[1]![0]).toContain('反例');
  expect(result.sources).toHaveLength(2);
  expect(result.sources.find(s=>s.url==='https://example.org/report')).toMatchObject({introducedBy:'P02',introducedAtMessageId:'reply-123'});
  expect(result.sources.every(s=>s.status==='read')).toBe(true);
  expect(saved).toHaveLength(2);
});
it('persists ungranted sources as leads and never turns snippets into source text', async () => {
  const pkg = examplePackage(); pkg.sources=[]; let saved= pkg.sources;
  const result=await gatherEvidence(pkg, DEFAULT_BUDGET, undefined,{checkpoint:async sources=>{saved=sources;},search:async(_q,run)=>run()},{search:async()=>[{url:'https://example.org/report',title:'来源',snippet:'不能当证据'}],hasPermission:async()=>false,read:vi.fn()});
  expect(result.pendingOrigins).toEqual(['https://example.org']);
  expect(saved[0]).toMatchObject({text:'',status:'lead',data:[]});
});
it('can cancel without marking a source as permanently unreadable', async () => {
  const pkg=examplePackage();pkg.sources[0]!.status='lead';pkg.sources[0]!.text='';pkg.sources[0]!.data=[];pkg.relations=[];
  const abort=new AbortController();
  await expect(gatherEvidence(pkg,DEFAULT_BUDGET,abort.signal,{checkpoint:async()=>{},search:async(_q,run)=>run()},{hasPermission:async()=>true,read:async()=>{abort.abort();throw new Error('cancelled');}})).rejects.toThrow('cancelled');
});

it('does not search when original sources already fill capacity and persists the omitted retrieval scope', async () => {
  const pkg = examplePackage(); pkg.sources = [];
  pkg.snapshot.messages[1]!.links = [{url:'https://example.org/report',label:'作者的来源'}];
  const search = vi.fn(async () => [{url:'https://counter.org/report',title:'额外结果',snippet:'摘要'}]);
  const read = vi.fn(async (url: string) => ({...examplePackage().sources[0]!,url}));
  const recordGaps = vi.fn(async (_gaps: string[]) => {});
  const result = await gatherEvidence(pkg, {...DEFAULT_BUDGET,maxSources:1}, undefined, {
    checkpoint: async () => {}, search: async (_query,run) => run(), recordGaps,
  }, {search,hasPermission:async () => true,read});
  expect(search).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(1);
  expect(result.sources).toHaveLength(1);
  expect(result.gaps.some(gap => gap.includes('2 次') && gap.includes('来源上限') && gap.includes('未完成'))).toBe(true);
  expect(recordGaps).toHaveBeenCalledWith(result.gaps);
});
it('stops subsequent searches when the preceding result fills capacity and identifies the incomplete direction', async () => {
  const pkg = examplePackage(); pkg.sources = [];
  const search = vi.fn(async () => [{url:'https://example.org/report',title:'结果',snippet:'摘要'}]);
  const result = await gatherEvidence(pkg, {...DEFAULT_BUDGET,maxSources:1}, undefined, {
    checkpoint: async () => {}, search: async (_query,run) => run(),
  }, {search,hasPermission:async () => false,read:vi.fn()});
  expect(search).toHaveBeenCalledTimes(1);
  expect(result.sources).toHaveLength(1);
  expect(result.gaps.some(gap => gap.includes('1 次') && gap.includes('来源上限') && gap.includes('未完成'))).toBe(true);
  expect(result.gaps.some(gap => gap.includes('Q01') && gap.includes('反向'))).toBe(true);
});
it.each([0, 1])('persists an incomplete-retrieval gap before propagating exhaustion after %i searches', async completed => {
  const pkg = examplePackage(); pkg.sources = [];
  let saved = pkg.sources;
  let attempted = 0;
  const exhausted = new AnalysisPause('budget_exhausted');
  const recordGaps = vi.fn(async (_gaps: string[]) => {});
  const search = vi.fn(async () => [{url:'https://example.org/report',title:'结果',snippet:'摘要'}]);
  const read = vi.fn();
  await expect(gatherEvidence(pkg, {...DEFAULT_BUDGET,maxSources:3}, undefined, {
    checkpoint: async sources => { saved = structuredClone(sources); },
    search: async (_query,run) => { if (attempted++ === completed) throw exhausted; return run(); },
    recordGaps,
  }, {search,hasPermission:async () => true,read})).rejects.toBe(exhausted);
  expect(search).toHaveBeenCalledTimes(completed);
  expect(read).not.toHaveBeenCalled();
  expect(saved).toHaveLength(completed);
  const gaps = recordGaps.mock.calls.at(-1)?.[0] ?? [];
  expect(gaps.some(gap => gap.includes(`${2-completed} 次`) && gap.includes('预算耗尽') && gap.includes('未完成'))).toBe(true);
});
