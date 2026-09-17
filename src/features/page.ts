import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { getState, saveSettings, watchState, markRead, type AppState } from '../shared/store';
import { parseTopic, parseTopics } from '../site/parse';
import { fetchTopic } from '../site/client';
import { topicUrl } from '../site/urls';
import { button,el,modal,toast } from '../shared/ui';
import { installMemberCards, paintTags, editTags } from './members';
import { enhanceReplies } from './replies';
import { previewTopic, saveTopic, showReading } from './reading';
import { enhanceEditors, decodePage, showDecode } from './editor';
import { shareImage } from './share';
import { installImagePreview } from './image-preview';
import type { Settings } from '../shared/settings';
import { createSiteFooter } from './site-footer';
import { enhanceProfile } from './profile';
import { applyPageAppearance } from './page-bootstrap';
import { enhancePagination } from './pagination';
import { positionNotification } from './notification';
import { icon } from '../shared/app-ui';
import { installAnalysisEntry } from './analysis';

function toolButton(label:string,name:string,action:()=>unknown) {
  const node=button('',action);node.append(icon(name),el('span',label));return node;
}

export function installTopicLayout(
  html: HTMLElement,
  content: HTMLElement | null,
  getSettings: () => Settings,
  onChange: (horizontal: boolean) => void = () => {},
) {
  let frame = 0;
  function update() {
    const settings = getSettings();
    let horizontal = Boolean(content) && settings.enabled && settings.layout === 'horizontal';
    if (content && settings.enabled && settings.layout === 'auto') {
      // Always measure the vertical layout. The horizontal layout changes text
      // wrapping, so observing its own dimensions would cause feedback loops.
      // Both class updates happen in one task, before the browser paints.
      html.classList.remove('gzk-horizontal');
      horizontal = content.getBoundingClientRect().height >= 600;
    }
    html.classList.toggle('gzk-horizontal', horizontal);
    onChange(horizontal);
  }
  function schedule(event: Event) {
    if (event.type === 'load' && !(event.target instanceof HTMLImageElement)) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { frame = 0; update(); });
  }
  content?.addEventListener('load', schedule, true);
  window.addEventListener('resize', schedule);
  update();
  return {
    update,
    destroy() {
      cancelAnimationFrame(frame);
      content?.removeEventListener('load', schedule, true);
      window.removeEventListener('resize', schedule);
    },
  };
}

export async function startPage(ctx?:ContentScriptContext, initialState?:AppState) {
  if(document.documentElement.dataset.gzkMounted)return;
  let state=initialState??await getState();document.documentElement.dataset.gzkMounted='true';
  let disposed=false;
  const html=document.documentElement,system=matchMedia('(prefers-color-scheme: dark)');
  const originals=new Map<HTMLAnchorElement,{target:string|null;rel:string|null}>();
  let layoutButton:HTMLButtonElement|undefined;
  let profileTagButton:HTMLButtonElement|undefined;
  const layout=installTopicLayout(html,document.querySelector<HTMLElement>('.topic-detail > .ui-content'),()=>state.settings,horizontal=>{
    if(layoutButton){
      const pendingWide=horizontal&&window.innerWidth<1400;
      layoutButton.replaceChildren(icon(horizontal?'vertical':'horizontal'),el('span',pendingWide?'横向（宽屏生效）':horizontal?'切换纵向':'切换横向'));
      layoutButton.title=pendingWide?'已选择横向，窗口宽度达到 1400 像素时生效；点击切换为纵向':'切换主题阅读布局';
      layoutButton.setAttribute('aria-label',pendingWide?layoutButton.title:horizontal?'切换为纵向布局':'切换为横向布局');
      layoutButton.setAttribute('aria-pressed',String(horizontal));
    }
  });
  function theme() {
    if(disposed)return;
    const s=state.settings;applyPageAppearance(html,s,system.matches);
    layout.update();
    for(const [link,original]of originals){
      for(const [attribute,value]of Object.entries(original)){if(value===null)link.removeAttribute(attribute);else link.setAttribute(attribute,value);}
      if(s.enabled&&s.openInNewTab){link.target='_blank';link.relList.add('noopener');}
    }
    if(profileTagButton)profileTagButton.hidden=!s.enabled;
    paintTags(state);
  }
  let topic:ReturnType<typeof parseTopic>|undefined;
  if(document.querySelector('.topic-detail'))topic=parseTopic(document,location.href);
  theme();
  const pagination=enhancePagination(state.settings.enabled);
  const notification=positionNotification(state.settings.enabled);
  const replies=enhanceReplies(state.settings.enabled?state.settings:{...state.settings,nested:'off',autoFold:false,preload:false});
  const options=()=>browser.runtime.sendMessage({type:'options:open'});
  const toolbox=el('div','','gzk-toolbox container-box');toolbox.append(el('div','GuoZaoKe Polish','gzk-brand'));
  const analysisEntry = topic ? installAnalysisEntry(topic.url) : null;
  const themeButton=toolButton('切换主题','moon',async()=>{state=await saveSettings({autoTheme:false,theme:html.dataset.gzkTheme==='dark'?'light':'dark'});theme();});
  toolbox.append(themeButton,toolButton('控制选项','sliders',options),toolButton('稍后阅读','book',showReading));
  if(topic){
    layoutButton=toolButton('切换横向','horizontal',async()=>{
      layoutButton!.disabled=true;
      try{state=await saveSettings({layout:html.classList.contains('gzk-horizontal')?'vertical':'horizontal'});theme();}
      finally{layoutButton!.disabled=false;}
    });
    layoutButton.dataset.gzkLayout='true';toolbox.append(layoutButton);layout.update();
  }
  if(topic){const current=topic;toolbox.append(toolButton('热门回复','heart',()=>replies.hot()),toolButton('回复主题','reply',()=>{const input=document.querySelector<HTMLTextAreaElement>('textarea.J_replyContent');if(!input){toast('请先登录过早客后回复',true);return;}input.focus();input.scrollIntoView({behavior:'smooth',block:'center'});}),toolButton('保存主题','plus',()=>saveTopic(current)),toolButton('分享图片','image',()=>shareImage(current)));}
  if (analysisEntry) toolbox.append(analysisEntry.entry);
  toolbox.append(toolButton('回到顶部','top',()=>window.scrollTo({top:0,behavior:'smooth'})),toolButton('更多功能','more',()=>{
    const view=modal('更多功能',{compact:true});const actions=el('div','','actions');actions.append(button('解码页面 Base64',()=>{view.close();decodePage();}),button('控制选项',options));view.body.append(actions);
    view.body.append(el('p','自动签到暂不可用。','muted'));
  }));
  const sidebar=document.querySelector('.sidebar-right');if(sidebar){const usercard=sidebar.querySelector('.usercard');if(usercard)usercard.after(toolbox);else sidebar.prepend(toolbox);}else document.body.append(toolbox);
  const footer=document.querySelector('body > .footer > .container');
  if(footer){
    footer.querySelectorAll('.links > span').forEach(span=>{if(span.textContent?.trim()==='•')span.classList.add('gzk-footer-separator');});
    footer.append(createSiteFooter({reading:showReading,options,top:()=>window.scrollTo({top:0,behavior:'smooth'})}));
  }
  // Keep tools accessible when the site's original sidebar is hidden on mobile.
  const narrow=matchMedia('(max-width:991px)');const positionTools=()=>{if(narrow.matches)document.body.append(toolbox);else if(sidebar){const card=sidebar.querySelector('.usercard');if(card)card.after(toolbox);else sidebar.prepend(toolbox);}};positionTools();narrow.addEventListener('change',positionTools);
  const toolsSize=new ResizeObserver(()=>{html.style.setProperty('--gzk-tools-height',`${toolbox.getBoundingClientRect().height}px`);});
  toolsSize.observe(toolbox);
  const topicList=parseTopics(document);const byId=new Map(topicList.map(t=>[t.id,t]));
  document.querySelectorAll<HTMLAnchorElement>('.topic-item .title a[href]').forEach(link=>{
    let id:string;try{id=topicUrl(link.href).split('/').pop()!;}catch{return;}
    originals.set(link,{target:link.getAttribute('target'),rel:link.getAttribute('rel')});const item=byId.get(id);if(!item)return;
    const actions=el('span','','gzk-topic-actions');const preview=button('预览',()=>previewTopic(item.url));preview.dataset.gzkPreview='true';actions.append(preview,button('稍后阅读',()=>saveTopic(item)));link.closest('.title')?.append(actions);
  });
  document.querySelectorAll<HTMLAnchorElement>('.hot-topics .hot_topic_title a[href]').forEach(link=>{
    let url:string;try{url=topicUrl(link.href);}catch{return;}
    const preview=button('预览',()=>previewTopic(url),'gzk-button gzk-sidebar-preview');preview.dataset.gzkPreview='true';link.parentElement?.append(preview);
  });
  const profile=document.querySelector('.profile > .ui-header');const user=profile?.querySelector('.username')?.textContent?.trim();if(user){profileTagButton=button('设置用户标签',()=>editTags(user));profile?.append(profileTagButton);}
  document.querySelectorAll<HTMLAnchorElement>('.reply-item .content a[href*="/u/"]').forEach(a=>{if(a.textContent?.trim().startsWith('@'))a.classList.add('gzk-mention');});
  const profileLayout=enhanceProfile(state.settings.enabled);
  const memberCards=installMemberCards();const stopEditors=enhanceEditors();
  const stopImagePreview=installImagePreview(()=>state.settings);
  const message=(msg:{type:string;text?:string;url?:string})=>{
    if(msg.type==='decode')showDecode(msg.text||'');
    if(msg.type==='reading'&&msg.url)void (async()=>{try{await saveTopic(topic&&topic.url===msg.url?topic:await fetchTopic(msg.url!));}catch(error){toast(error instanceof Error?error.message:'保存失败',true);}})();
  };
  browser.runtime.onMessage.addListener(message);
  const update=async(next?:AppState)=>{const previous=state.settings;const received=next??await getState();if(disposed)return;state=received;theme();analysisEntry?.update(state.settings.enabled);pagination.update(state.settings.enabled);notification.update(state.settings.enabled);profileLayout.update(state.settings.enabled);memberCards.update();if(JSON.stringify(previous)!==JSON.stringify(state.settings))replies.update(state.settings.enabled?state.settings:{...state.settings,nested:'off',autoFold:false,preload:false});document.querySelectorAll<HTMLElement>('[data-gzk-preview]').forEach(e=>e.hidden=!state.settings.topicPreview);};
  const stop=watchState(()=>{void update().catch(error=>toast(String(error),true));});
  system.addEventListener('change',theme);await update(initialState?state:undefined);
  if(topic&&state.reading.some(t=>t.id===topic!.id&&!t.read))await markRead(topic.id,true);
  ctx?.onInvalidated(()=>{
    if(disposed)return;disposed=true;
    stop();pagination.destroy();notification.destroy();replies.destroy();profileLayout.destroy();memberCards.destroy();layout.destroy();toolsSize.disconnect();stopEditors?.();analysisEntry?.destroy();
    html.style.removeProperty('--gzk-tools-height');stopImagePreview();system.removeEventListener('change',theme);narrow.removeEventListener('change',positionTools);browser.runtime.onMessage.removeListener(message);
    applyPageAppearance(html,{...state.settings,enabled:false},system.matches);
    for(const [link,original]of originals)for(const [name,value]of Object.entries(original)){if(value===null)link.removeAttribute(name);else link.setAttribute(name,value);}
    toolbox.remove();profileTagButton?.remove();
    document.querySelectorAll('.gzk-site-footer,.gzk-topic-actions,.gzk-sidebar-preview,.gzk-tags').forEach(node=>node.remove());
    document.querySelectorAll('.gzk-overlay-host').forEach(host=>{host.shadowRoot?.querySelectorAll('dialog[open]').forEach(dialog=>(dialog as HTMLDialogElement).close());host.remove();});
    document.querySelectorAll('.gzk-mention').forEach(node=>node.classList.remove('gzk-mention'));
    delete html.dataset.gzkMounted;
  });
}
