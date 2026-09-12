import { startPage } from '../../src/features/page';
import { bootstrapPage } from '../../src/features/page-bootstrap';
import { fixtureState } from './detail-api';
import { saveSettings } from '../../src/shared/store';
import { showTagDialog } from '../../src/features/tag-dialog';

const query=new URLSearchParams(location.search),scenario=query.get('load');
const frames:{visible:boolean,theme:string|null}[]=[];
const sample=()=>{
  if(document.body)frames.push({visible:getComputedStyle(document.body).visibility!=='hidden',theme:document.documentElement.getAttribute('data-gzk-theme')});
  if(frames.length<120)requestAnimationFrame(sample);
};requestAnimationFrame(sample);
const image='/tests/browser/preview-fixture.svg';
document.addEventListener('DOMContentLoaded',()=>{
  const route=location.pathname,current=Number(query.get('p')||1),total=7392;
  const pages=[...new Set([1,2,3,current,total-1,total])].sort((a,b)=>a-b);
  const link=(page:number)=>`${route}?p=${page}${query.has('theme')?'&theme='+query.get('theme'):''}`;
  const pagination=`<nav class="tr hidden-xs"><ul class="pagination"><li class="${current===1?'disabled':''}"><a href="${link(Math.max(1,current-1))}">上一页</a></li>${pages.map(p=>`<li class="${p===current?'active':''}"><a href="${p===current?'javascript:;':link(p)}">${p}</a></li>`).join('')}<li class="${current===total?'disabled':''}"><a href="${link(Math.min(total,current+1))}">下一页</a></li></ul></nav><div class="pagination-wap visible-xs-block"><a href="${link(Math.max(1,current-1))}">上一页</a> ${current}/${total} <a href="${link(Math.min(total,current+1))}">下一页</a></div>`;
  const topics=`<div class="topics">${Array.from({length:3},(_,i)=>`<div class="topic-item"><a href="/u/demo"><img class="avatar" src="${image}"></a><div class="main"><h3 class="title"><a href="https://www.guozaoke.com/t/${133000+i}">${['麻醉师这个职业挺好吧','马上苹果新品发布会了','社友们，减肥太难了'][i]}（本地测试）</a></h3><div class="meta"><span class="node"><a href="/node/IT">IT技术</a></span> · <span class="username"><a href="/u/demo">demo</a></span> · 今天</div></div><div class="count"><a href="#">22</a></div></div>`).join('')}</div>`;
  const replies=`<div class="replies-lists user-replies container-box"><div class="ui-header"><span>过早客 › demo › 回复列表</span></div><div class="ui-content">${Array.from({length:3},(_,i)=>`<div class="reply-item"><div class="main"><div class="title">回复了 <a href="/u/demo">demo</a> 创建的主题 <a href="#">分享一下过早客（虚构数据）</a></div><div class="content"><p>第 ${i+1} 条测试回复，没有多余的头像缩进。</p><p>段落间距和标题背景应保持一致。</p></div></div></div>`).join('')}</div><div class="ui-footer">${pagination}</div></div>`;
  const create=`<div class="topic-create container-box"><div class="ui-header">创建新主题</div><div class="ui-content"><form class="mt10"><div class="input-prepend mt10"><input type="text" class="form-control" id="prependedInput" placeholder="主题"></div><textarea class="content mt5 smart-code-support form-control" id="contentArea" name="content" placeholder="正文"></textarea><div class="mt10 mb10">Tips: 编辑器使用 GFM 风格的 markdown 语法。</div><input type="submit" class="btn btn-primary" value="仅验证表单"><a class="btn btn-default" href="#">上传图片</a></form></div></div>`;
  const root=`<div class="user-page"><div class="profile container-box"><div class="ui-header"><a href="/u/demo"><img class="avatar" src="${image}"></a><div class="username">demo</div><div class="user-number">过早客第 1 号成员 入住于 2020-01-01</div></div><div class="ui-content"><dl><dt>签名</dt><dd>测试个人简介</dd></dl></div></div><div class="topic-lists container-box mt10"><div class="ui-header">demo 创建的主题</div><div class="ui-content">${topics}</div><div class="ui-footer">${pagination}</div></div></div>`;
  const content=route.includes('/create/')?create:route.endsWith('/replies')?replies:route==='/u/demo'?root:route.startsWith('/u/')?`<div class="topic-lists container-box"><div class="ui-header">demo 的列表</div><div class="ui-content">${topics}</div><div class="ui-footer">${pagination}</div></div>`:`<div class="topics container-box">${topics}${pagination}</div>`;
  document.body.innerHTML=`<nav class="top-navbar navbar navbar-default"><div class="container"><div class="navbar-header"><a class="navbar-brand" href="/"><img src="${image}" alt="首页"></a></div><div id="navbar5" class="navbar-collapse"><form class="navbar-form navbar-left J_search"><input class="form-control" placeholder="搜索"></form><a class="notification-indicator" href="#notification" title="消息提醒"><span class="mail-status unread"></span></a><ul class="nav navbar-nav navbar-right"><li><a href="/">首页</a></li><li><a href="/node/IT">节点</a></li><li><a href="/u/demo">成员</a></li><li><a href="#">设置</a></li><li><a href="#">退出</a></li></ul></div></div></nav><div class="container"><div id="audit-controls"><span>本地虚构数据 · 第 ${current} 页</span> <a href="/">首页分页</a> · <a href="/u/demo">个人页</a> · <a href="/u/demo/replies">回复</a> · <a href="/t/create/IT">编辑器</a> · <button id="audit-tags">标签弹窗</button> <button id="audit-disable">停用增强</button> <button id="audit-dark">深色</button></div><div class="row"><div class="col-md-9 sidebar-left">${content}</div><aside class="col-md-3 sidebar-right"><div class="usercard container-box"><div class="ui-header"><a href="/u/demo"><img class="avatar" src="${image}"></a><div class="username">demo</div><div class="website"><a href=""></a></div></div><div class="ui-content"><div class="status status-topic"><strong><a href="/u/demo/topics">27</a></strong>主题</div><div class="status status-reply"><strong><a href="/u/demo/replies">1714</a></strong>回复</div><div class="status status-favorite"><strong><a href="/u/demo/favorites">0</a></strong>收藏</div><div class="status"><strong>2839</strong>信用</div></div></div></aside></div><pre id="audit-result" aria-label="验收记录"></pre></div><div class="footer"><div class="container"><div class="footer-bg"><p class="links">原站页脚与备案信息（本地测试）</p></div></div></div>`;
  document.querySelectorAll('form').forEach(form=>form.addEventListener('submit',event=>event.preventDefault()));
  document.querySelector('#audit-tags')!.addEventListener('click',()=>showTagDialog('demo',[],async tags=>{document.querySelector('#audit-result')!.textContent=`已保存测试标签：${tags.join('、')}`;},()=>window.open('/fixture-options.html#tags','_blank')));
  document.querySelector('#audit-disable')!.addEventListener('click',()=>void saveSettings({enabled:!fixtureState().settings.enabled}));
  document.querySelector('#audit-dark')!.addEventListener('click',()=>void saveSettings({autoTheme:false,theme:fixtureState().settings.theme==='dark'?'light':'dark'}));
});
const boot=bootstrapPage(async()=>{
  if(scenario==='slow')await new Promise(resolve=>setTimeout(resolve,600));
  if(scenario==='fail')throw Error('测试偏好读取失败');
  if(scenario==='hang')await new Promise(()=>{});
  return fixtureState();
},state=>startPage(undefined,state));
void boot.ready.catch(()=>{});
setTimeout(()=>{
  const visible=frames.filter(frame=>frame.visible);
  document.querySelector('#audit-result')!.textContent=JSON.stringify({scenario:scenario||'normal',sampledFrames:frames.length,visibleNativeFrames:visible.filter(frame=>!frame.theme).length,firstVisibleTheme:visible[0]?.theme||null,guardRemaining:document.documentElement.hasAttribute('data-gzk-booting')});
},1900);
