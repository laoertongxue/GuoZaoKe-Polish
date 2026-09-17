import { describe, expect, it, vi } from 'vitest';
import { renderReport, mountWorkspace } from '../src/analysis/workspace';
import { examplePackage } from './fixtures/analysis/package';
import { AnalysisRepository } from '../src/analysis/repository';

it.each([false,true])('keeps unplanned claim excerpts visible with an existing plan=%s',hasPlan=>{
  const pkg=examplePackage();pkg.claims.push({...structuredClone(pkg.claims[0]!),id:'C02',text:'尚未列入核查的主张'});
  if(!hasPlan)pkg.questions=[];
  const root=document.createElement('div');renderReport(root,pkg,'evidence');
  expect(root.textContent).toContain('尚未列入核查的主张');
  expect([...root.querySelectorAll('summary')].filter(n=>n.textContent==='核对主张摘录')).toHaveLength(2);
  expect(root.textContent).toContain('字符 1–10');
});

it('shows each claim excerpt and recaptures a flagged message without rewriting history or calling AI',async()=>{
  const root=document.createElement('div');const values:Record<string,unknown>={};const pkg=examplePackage();
  const cfg={id:'local',name:'My AI',baseUrl:pkg.provenance.endpoint,model:pkg.provenance.model,...pkg.provenance.parameters,declaredVersion:'',hasKey:true};
  const repo=new AnalysisRepository({get:async key=>({[key]:values[key]}),set:async next=>{Object.assign(values,next);},remove:async key=>{delete values[key];}});await repo.savePackage(pkg);
  const request=vi.fn(async(message:any)=>message.type==='analysis:config:get'?{configs:[cfg],hasSearchKey:false}:null);
  const loadTopic=vi.fn(async()=>new DOMParser().parseFromString('<div class="topic-detail"><div class="ui-header"><h3 class="title">费用讨论</h3><div class="meta"><span class="username">owner</span></div></div><div class="ui-content">平均费用？</div></div><div class="topic-reply"><div class="ui-header">共收到1条回复</div><div class="ui-content"><div class="reply-item"><div class="main"><div class="meta"><a class="reply-username">writer</a><span class="floor">#1</span><a class="J_replyVote" href="/replyVote?reply_id=123"></a></div><span class="content">更新后的原文。</span></div></div></div></div>','text/html'));
  const dispose=await mountWorkspace(root,{request,repo,loadTopic,permissions:{contains:async()=>true,request:async()=>true}},undefined,'history');
  await vi.waitFor(()=>expect([...root.querySelectorAll('button')].some(b=>b.textContent==='打开')).toBe(true));
  [...root.querySelectorAll('button')].find(b=>b.textContent==='打开')!.click();
  await vi.waitFor(()=>expect(root.textContent).toContain('指出摘录错误'));
  [...root.querySelectorAll('button')].find(b=>b.textContent==='主张与证据')!.click();
  expect(root.textContent).toContain('核对主张摘录');expect(root.textContent).toContain('平均每单是10元。');
  const select=root.querySelector<HTMLSelectElement>('[aria-label="需要复核的发言"]')!;select.value='reply-123';select.dispatchEvent(new Event('change'));
  [...root.querySelectorAll('button')].find(b=>b.textContent==='重新采集并保留复核标记')!.click();
  await vi.waitFor(()=>expect(root.textContent).toContain('已建立带复核标记的新快照'));
  expect(loadTopic).toHaveBeenCalledTimes(1);expect(await repo.getPackage(pkg.id)).toEqual(pkg);
  const entries=await repo.list();expect(entries).toHaveLength(2);
  const fresh=await repo.getPackage(entries.find(e=>e.id!==pkg.id)!.id);
  expect(fresh?.snapshot.gaps.join('')).toContain('reply-123');expect(fresh?.snapshot.gaps.join('')).toContain('用户标记');
  expect(fresh?.snapshot.messages[1]?.text).toBe('更新后的原文。');expect(fresh?.claims).toEqual([]);expect(fresh?.evaluations).toEqual([]);expect(fresh?.status).toBe('partial');
  expect(request.mock.calls.some(([m])=>['analysis:call','analysis:run:prepare'].includes(m.type))).toBe(false);
  dispose();
});

describe('discussion analysis workspace', () => {
  it('renders traceable sources, separate dimensions and unknown values without executing HTML', () => {
    const root = document.createElement('div'); const pkg = examplePackage();
    pkg.snapshot.title = '<img src=x onerror="alert(1)">'; pkg.sources[0]!.data[0]!.value = null;
    renderReport(root, pkg, 'evidence');
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('费用表'); expect(root.textContent).toContain('未知');
    const source = root.querySelector<HTMLAnchorElement>('a[href="https://example.org/report"]');
    expect(source?.rel).toContain('noopener');
    renderReport(root, pkg, 'replies');
    expect(root.textContent).toContain('不适用'); expect(root.textContent).toContain('无法判断');
    expect(root.textContent).not.toMatch(/人格|排行榜|总分/);
    expect(root.querySelector('a[href*="#gzk-reply-123"]')).not.toBeNull();
  });
  it('shows a clear partial report with collection limits, rather than implying everything was verified', () => {
    const root = document.createElement('div'); const pkg = examplePackage(); pkg.status = 'partial'; pkg.snapshot.completeness = 'partial'; pkg.snapshot.gaps = ['有一页未读取'];
    renderReport(root, pkg, 'overview');
    expect(root.textContent).toContain('部分完成'); expect(root.textContent).toContain('有一页未读取');
    expect(root.textContent).toContain('探索分析');
  });
  it('shows setup and requires deliberate start, with no automatic provider call', async () => {
    const root = document.createElement('div'); const values: Record<string, unknown> = {};
    const request = vi.fn(async (message: any) => message.type === 'analysis:config:get' ? { configs: [], hasSearchKey: false } : true);
    const repo = new AnalysisRepository({ get: async key => ({ [key]: values[key] }), set: async next => { Object.assign(values, next); }, remove: async key => { delete values[key]; } });
    const dispose = await mountWorkspace(root, { request, repo, loadTopic: vi.fn(), permissions: { contains: async () => false, request: async () => false } });
    expect(root.textContent).toContain('讨论分析'); expect(root.textContent).toContain('模型设置');
    const button = [...root.querySelectorAll('button')].find(b => b.textContent === '模型设置')!; button.click();
    expect(root.querySelector<HTMLInputElement>('input[type="password"]')?.autocomplete).toBe('off');
    expect(request.mock.calls.some(c => c[0].type === 'analysis:call')).toBe(false);
    dispose();
  });
  it('links a reply to its captured pagination page before locating the stable reply ID', () => {
    const pkg = examplePackage(); pkg.snapshot.pages = [{ url: `${pkg.snapshot.url}?p=2`, status: 'read', messageIds: ['reply-123'], error: null }];
    const root = document.createElement('div'); renderReport(root, pkg, 'replies');
    expect(root.querySelector('a')?.href).toBe(`${pkg.snapshot.url}?p=2#gzk-reply-123`);
  });
  it('reserves the UI before creating a calibration batch, preventing duplicate paid queues and configuration changes', async () => {
    const root = document.createElement('div'); const values: Record<string, unknown> = {};
    const config = { id:'m1',name:'My AI',baseUrl:'https://api.example.org/v1',model:'example',temperature:0,maxOutputTokens:4096,declaredVersion:'',hasKey:true };
    let resolveCreate!: (value: any) => void;
    const request = vi.fn(async (message: any): Promise<any> => {
      if(message.type==='analysis:config:get')return {configs:[config],hasSearchKey:false};
      if(message.type==='analysis:calibration:info')return {cases:[{id:'X01'}],thresholds:{repetitions:3},frozenAt:'2026-09-15',referenceLabel:'合成测试',methodVersion:'0.2.1',hash:'fixture'};
      if(message.type==='analysis:calibration:list')return [];
      if(message.type==='analysis:calibration:create')return new Promise(resolve=>{resolveCreate=resolve;});
      return true;
    });
    const repo = new AnalysisRepository({ get: async key => ({ [key]: values[key] }), set: async next => { Object.assign(values, next); }, remove: async key => { delete values[key]; } });
    const dispose=await mountWorkspace(root,{request,repo,loadTopic:vi.fn(),permissions:{contains:async()=>true,request:async()=>true}},undefined,'calibration');
    await vi.waitFor(()=>expect(root.textContent).toContain('新建并执行整轮校准'));
    const start=[...root.querySelectorAll('button')].find(b=>b.textContent==='新建并执行整轮校准')!;
    start.click(); expect(request.mock.calls.filter(c=>c[0].type==='analysis:calibration:create')).toHaveLength(0);
    root.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked=true;
    start.click();start.click();
    expect(request.mock.calls.filter(c=>c[0].type==='analysis:calibration:create')).toHaveLength(1);
    [...root.querySelectorAll('button')].find(b=>b.textContent==='模型设置')!.click();
    root.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
    await Promise.resolve();
    expect(request.mock.calls.some(c=>c[0].type==='analysis:config:save')).toBe(false);
    resolveCreate({id:'batch',slots:[],callsUsed:0,maxCalls:30});
    await vi.waitFor(()=>expect(root.textContent).toContain('本轮已保存'));
    dispose();
  });
});

it('shows trial calibration separately from report structure and never trusts an imported standard label',()=>{
  const root=document.createElement('div');const pkg=examplePackage();pkg.provenance.mode='standard';pkg.provenance.qualificationId='claimed';
  renderReport(root,pkg,'overview');
  expect(root.textContent).toContain('准入未核实');
  renderReport(root,pkg,'overview',{state:'qualified_trial',qualificationId:'claimed',assessedAt:'2026-09-15',referenceLabel:'合成试验',providerModel:'alias'});
  expect(root.textContent).toContain('标准分析试用');
  expect(root.textContent).toContain('配置通过本轮试验校准');
  expect(root.textContent).toContain('结构校验通过');
  expect(root.textContent).toContain('不代表每条结论已经核验');
});
