import {it,expect,vi} from 'vitest';
import {mountWorkspace} from '../src/analysis/workspace';
import {AnalysisRepository} from '../src/analysis/repository';
import {splitSpans} from '../src/analysis/snapshot';
import {examplePackage,questionDrafts} from './fixtures/analysis/package';
const url='https://www.guozaoke.com/t/121894';
const config=(id='m1')=>({id,name:id,baseUrl:'https://api.example.org/v1',model:id,temperature:0,maxOutputTokens:4096,declaredVersion:'',hasKey:true});
function harness(configs=[config()],defaultConfigId:string|null=configs[0]?.id??null){
 const values:Record<string,unknown>={};const repo=new AnalysisRepository({get:async k=>({[k]:structuredClone(values[k])}),set:async v=>{Object.assign(values,structuredClone(v));},remove:async k=>{delete values[k];}});
 const loadTopic=vi.fn(async()=>new DOMParser().parseFromString('<div class="topic-detail"><div class="ui-header"><h3 class="title">费用讨论</h3><div class="meta"><span class="username">owner</span></div></div><div class="ui-content">平均费用是多少？</div></div><div class="topic-reply"><div class="ui-header">共收到1条回复</div><div class="ui-content"><div class="reply-item"><div class="main"><div class="meta"><a class="reply-username">writer</a><span class="floor">#1</span><a class="J_replyVote" href="/replyVote?reply_id=123"></a></div><span class="content">😃平均每单是10元。</span></div></div></div></div>','text/html'));
 const request=vi.fn(async(m:any):Promise<any>=>{
  if(m.type==='analysis:config:get')return{configs,defaultConfigId,hasSearchKey:false};
  if(m.type==='analysis:config:save'){configs=[...configs.filter(c=>c.id!==m.config.id),{...m.config,hasKey:true}];if(configs.length===1)defaultConfigId=configs[0]!.id;return true;}
  if(m.type==='analysis:config:default'){defaultConfigId=m.configId;return true;}
  if(m.type==='analysis:run:prepare')return repo.getJob(m.jobId);
  if(m.type==='analysis:call'){
   const p=examplePackage();const value=m.stage==='claims'?{claims:p.claims,coverage:m.input.messages.flatMap((msg:any)=>splitSpans(msg).map(span=>({span,claimIds:msg.kind==='reply'?['C01']:[],disposition:msg.kind==='reply'?'claim':'non_assertive',reason:'合成材料'})))}:m.stage==='plan'?{questions:questionDrafts()}:m.stage==='relations'?{relations:[],data:[]}: {evaluations:p.evaluations};
   return{value,usage:{inputTokens:10,outputTokens:10},providerModel:'fixture'};
  }
  return null;
 });
 const services={repo,request,loadTopic,permissions:{contains:async()=>false,request:async()=>true}};
 return{services,repo,request,loadTopic};
}
const click=(root:HTMLElement,text:string)=>{const b=[...root.querySelectorAll('button')].find(b=>b.textContent===text);expect(b,text).toBeTruthy();b!.click();};
it('runs from the explicit launch, shows results without workflow forms, and reopens without duplicate calls',async()=>{
 const h=harness();const root=document.createElement('div');const dispose=await mountWorkspace(root,h.services,url,'overview',{simple:true,autoStart:true,compact:true});
 await vi.waitFor(()=>expect(root.textContent).toContain('分析完成'));
 expect(root.textContent).toContain('平均每单是10元');expect(root.textContent).not.toContain('发送范围与预算');expect(root.textContent).not.toContain('本轮分析进度');expect(root.querySelector('#analysis-consent')).toBeNull();
 const calls=h.request.mock.calls.filter(([m])=>m.type==='analysis:call').length;expect(calls).toBeGreaterThan(0);dispose();
 const close=await mountWorkspace(root,h.services,url,'overview',{simple:true,autoStart:true});
 await new Promise(r=>setTimeout(r,20));expect(h.request.mock.calls.filter(([m])=>m.type==='analysis:call')).toHaveLength(calls);close();
});
it('prompts for model configuration then automatically analyzes after the first save',async()=>{
 const h=harness([]);const root=document.createElement('div');const close=await mountWorkspace(root,h.services,url,'overview',{simple:true,autoStart:true});
 await vi.waitFor(()=>expect(root.querySelector('form')).not.toBeNull());
 expect(h.loadTopic).not.toHaveBeenCalled();root.querySelector<HTMLInputElement>('input[type=password]')!.value='fixture-key';root.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 await vi.waitFor(()=>expect(root.textContent).toContain('分析完成'));expect(h.loadTopic).toHaveBeenCalledTimes(1);close();
});
it('uses the configured default, reruns with another model, and retains the previous result',async()=>{
 const h=harness([config('m1'),config('m2')],'m2');const root=document.createElement('div');const close=await mountWorkspace(root,h.services,url,'overview',{simple:true,autoStart:true});
 await vi.waitFor(()=>expect(root.textContent).toContain('分析完成'));const first=(await h.repo.list())[0]!;expect((await h.repo.getPackage(first.id))?.provenance.modelConfigId).toBe('m2');
 const select=root.querySelector<HTMLSelectElement>('[aria-label="分析模型"]')!;select.value='m1';select.dispatchEvent(new Event('change'));const rerun=[...root.querySelectorAll('button')].find(b=>b.textContent==='重新分析')!;rerun.click();rerun.click();
 await vi.waitFor(async()=>expect(await h.repo.list()).toHaveLength(2));await vi.waitFor(()=>expect(root.textContent).toContain('分析完成'));
 const all=await h.repo.list();expect((await h.repo.getPackage(all.find(p=>p.id!==first.id)!.id))?.provenance.modelConfigId).toBe('m1');expect((await h.services.request({type:'analysis:config:get'})).defaultConfigId).toBe('m2');close();
});
it('does not silently choose a default from several legacy configurations',async()=>{
 const h=harness([config('m1'),config('m2')],null);const root=document.createElement('div');const close=await mountWorkspace(root,h.services,url,'overview',{simple:true,autoStart:true});
 await vi.waitFor(()=>expect(root.textContent).toContain('请选择默认模型'));expect(h.loadTopic).not.toHaveBeenCalled();click(root,'设为默认');await vi.waitFor(()=>expect(root.textContent).toContain('分析完成'));close();
});

it('retains a requested model switch after entering that models missing key',async()=>{
 const h=harness([config('m1'),{...config('m2'),hasKey:false}],'m1');const root=document.createElement('div');const close=await mountWorkspace(root,h.services,url,'overview',{simple:true,autoStart:true});
 await vi.waitFor(()=>expect(root.textContent).toContain('分析完成'));const first=(await h.repo.list())[0]!;
 const select=root.querySelector<HTMLSelectElement>('[aria-label="分析模型"]')!;select.value='m2';select.dispatchEvent(new Event('change'));click(root,'重新分析');
 await vi.waitFor(()=>expect(root.querySelector('form')).not.toBeNull());root.querySelector<HTMLInputElement>('input[type=password]')!.value='fixture-key';root.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 await vi.waitFor(async()=>expect(await h.repo.list()).toHaveLength(2));await vi.waitFor(()=>expect(root.textContent).toContain('分析完成'));
 const fresh=(await h.repo.list()).find(p=>p.id!==first.id)!;expect((await h.repo.getPackage(fresh.id))?.provenance.modelConfigId).toBe('m2');close();
});
it('does not call the model when stopped during collection',async()=>{
 const h=harness();const load=h.loadTopic.getMockImplementation()!;let release!:(d:Document)=>void;h.loadTopic.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const root=document.createElement('div');const close=await mountWorkspace(root,h.services,url,'overview',{simple:true,autoStart:true});
 await vi.waitFor(()=>expect(h.loadTopic).toHaveBeenCalled());click(root,'停止分析');release(await load());
 await vi.waitFor(()=>expect(root.textContent).toContain('分析已停止'));expect(h.request.mock.calls.some(([m])=>m.type==='analysis:call')).toBe(false);close();
});
it('renders a clear failure and retries without recapturing or hiding the spent budget',async()=>{
 const h=harness();const respond=h.request.getMockImplementation()!;let fail=true;
 h.request.mockImplementation(async(m:any)=>{if(fail&&m.type==='analysis:call')throw Object.assign(new Error('fixed diagnosis'),{code:'network'});return respond(m);});
 const root=document.createElement('div');const close=await mountWorkspace(root,h.services,url,'overview',{simple:true,autoStart:true});
 await vi.waitFor(()=>expect(root.textContent).toContain('连接模型失败'));expect(root.textContent).not.toContain('stage_failed');fail=false;click(root,'重试');
 await vi.waitFor(()=>expect(root.textContent).toContain('分析完成'));expect(h.loadTopic).toHaveBeenCalledTimes(1);expect(await h.repo.list()).toHaveLength(1);const job=await h.repo.getJob((await h.repo.list())[0]!.id);expect(job!.callsUsed).toBe(5);close();
});

it('forum activation restores its bound topic after another history topic was opened',async()=>{
 const h=harness();const root=document.createElement('div');let activate!:()=>Promise<void>;
 const close=await mountWorkspace(root,h.services,url,'overview',{simple:true,autoStart:true,onReady:start=>{activate=start;}});
 await vi.waitFor(()=>expect(root.textContent).toContain('分析完成'));
 const first=(await h.repo.list())[0]!;const second=(await h.repo.getPackage(first.id))!;
 second.id='history-second';second.createdAt='2026-09-18T00:00:00.000Z';second.snapshot.url='https://www.guozaoke.com/t/99999';second.snapshot.topicId='99999';second.snapshot.title='另一篇历史帖 B';second.snapshot.pages.forEach(p=>p.url=second.snapshot.url);
 await h.repo.savePackage(second);
 click(root,'历史结果');await vi.waitFor(()=>expect(root.textContent).toContain('另一篇历史帖 B'));
 const card=[...root.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent==='另一篇历史帖 B')!;
 [...card.querySelectorAll('button')].find(b=>b.textContent==='打开')!.click();
 await vi.waitFor(()=>expect(root.querySelector('h1')?.textContent).toBe('另一篇历史帖 B'));
 await activate();
 try {expect(root.querySelector('h1')?.textContent).toBe('费用讨论');} finally {close();}
});
