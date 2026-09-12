// Test-only extension API: all data is synthetic and stays in memory.
import { applyAction, initialState } from '../../src/shared/state';
let state=initialState();state.settings.autoTheme=false;
const selectedTheme=new URLSearchParams(location.search).get('theme');
state.settings.theme=selectedTheme==='dark'?'dark':selectedTheme==='dawn'?'dawn':'light';
const listeners=new Set<(changes:Record<string,unknown>,area:string)=>void>();
const change=()=>listeners.forEach(listener=>listener({'gzk:prefs':{}},'sync'));
export const browser={
  runtime:{openOptionsPage:async()=>{window.open('/fixture-options.html','_blank');},getManifest:()=>({version:'0.3.10 fixture'}),getURL:(path:string)=>path,
    onMessage:{addListener:()=>{},removeListener:()=>{}},
    sendMessage:async(message:any)=>{
      if(message.type==='state:get')return {ok:true,data:structuredClone(state)};
      if(message.type==='state:mutate'){state=applyAction(state,message.action,message.payload);change();return {ok:true,data:structuredClone(state)};}
      if(message.type==='options:open'){window.open(`/fixture-options.html${message.page==='tags'?'#tags':''}`,'_blank');return true;}
      if(message.type==='site:get'&&new URL(message.url).pathname==='/notifications')return {ok:true,data:'<div class=navbar-right><a href=/u/demo>demo</a></div><div class=notification-item><a href=/t/133000>本地测试：收到一条回复</a></div>'};
      if(message.type==='site:get'&&new URL(message.url).pathname==='/')return {ok:true,data:'<div class=navbar-right><a href=/u/demo>demo</a></div><div class=topic-item><div class=title><a href=/t/133000>本地测试主题：用于验证列表、加载及保存</a></div><div class=meta><span class=username>demo</span></div><div class=count>22</div></div><div class=hot-topics><div class=cell><div class=hot_topic_title><a href=/t/133000>本地测试热议主题</a></div></div></div>'};
      if(message.type==='site:get')return {ok:true,data:`<div class="topic-detail"><div class="ui-header"><a href="/u/demo"><img class="avatar" src="/tests/browser/preview-fixture.svg"></a><div class="main"><h1 class="title">麻醉师这个职业挺好吧（虚构测试）</h1><div class="meta"><span class="username"><a href="/u/demo">demo</a></span><span class="node"><a href="/node/IT">IT技术</a></span></div></div></div><div class="ui-content"><p>这是本地主题预览测试内容。</p></div></div><div class="topic-reply"><div class="ui-header">22 条回复</div></div>`};
      throw Error('测试页面不会发送真实请求');
    }},
  storage:{local:{get:async()=>({'gzk:state':{reading:state.reading}})},sync:{get:async()=>({'gzk:prefs':{settings:state.settings,tags:state.tags}})},onChanged:{addListener:(fn:(changes:Record<string,unknown>,area:string)=>void)=>listeners.add(fn),removeListener:(fn:(changes:Record<string,unknown>,area:string)=>void)=>listeners.delete(fn)}},
  permissions:{contains:async()=>false,request:async()=>false},
};
export const fixtureState=()=>structuredClone(state);
