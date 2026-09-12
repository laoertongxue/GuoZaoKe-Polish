import { parseReplies, replyPages } from '../site/parse';
import { fetchDocument } from '../site/client';
import { buildThreads } from './threading';
import type { Settings } from '../shared/settings';
import { button, el, richHtml, toast } from '../shared/ui';
import type { Reply } from '../shared/types';
import { saveSettings } from '../shared/store';
import { voteReply } from '../site/vote';
import { readableUrl } from '../site/urls';

export function enhanceReplies(initial:Settings) {
  const container=document.querySelector<HTMLElement>('.topic-reply > .ui-content');
  if(!container)return {update:(_s:Settings)=>{},hot:()=>{},destroy:()=>{}};
  let rows=parseReplies(document),settings=initial,mode:'all'|'hot'='all',loading=false,loaded=false,disposed=false,preloadRevision=0;
  const nativeRows=[...rows];
  const originalRows=new Map(nativeRows.map(row=>{
    const nativeReply=row.element.querySelector<HTMLElement>(':scope > .main > .meta .J_replyTo');
    const floor=[...row.element.querySelectorAll<HTMLElement>(':scope > .main > .meta .floor')].find(e=>/^#\d+$/.test(e.textContent?.trim()||''));
    return [row.element,{
      id:row.element.getAttribute('id'),data:row.element.getAttribute('data-gzk-reply'),hidden:row.element.hidden,
      nativeReply,nativeReplyHidden:nativeReply?.hidden,
      floor,floorAttributes:floor?{title:floor.getAttribute('title'),role:floor.getAttribute('role'),tabindex:floor.getAttribute('tabindex')}:undefined,
      floorClick:floor?.onclick,floorKeydown:floor?.onkeydown,
    }] as const;
  }));
  const originalPagination=new Map<HTMLAnchorElement,string|null>();
  function restoreAttribute(node:HTMLElement,name:string,value:string|null){if(value===null)node.removeAttribute(name);else node.setAttribute(name,value);}
  function restoreNativeReplies(){
    for(const row of rows)if(!originalRows.has(row.element))row.element.remove();
    rows=[...nativeRows];loaded=false;
    for(const row of rows)container!.append(row.element);
    container!.querySelectorAll('.gzk-reply-children').forEach(e=>e.remove());
    container!.classList.remove('gzk-align');
    for(const [element,original]of originalRows){
      restoreAttribute(element,'id',original.id);restoreAttribute(element,'data-gzk-reply',original.data);
      element.hidden=original.hidden;element.classList.remove('gzk-nested');
      element.querySelectorAll('.gzk-badge,.gzk-reply-action,.gzk-fold-button,.gzk-parent-link').forEach(e=>e.remove());
      element.querySelector('.gzk-folded')?.classList.remove('gzk-folded');
      if(original.nativeReply)original.nativeReply.hidden=original.nativeReplyHidden!;
      if(original.floor&&original.floorAttributes){
        for(const [name,value]of Object.entries(original.floorAttributes))restoreAttribute(original.floor,name,value);
        original.floor.onclick=original.floorClick!;original.floor.onkeydown=original.floorKeydown!;
      }
    }
    for(const [link,title]of originalPagination){link.classList.remove('gzk-preloaded-page');restoreAttribute(link,'title',title);}
    originalPagination.clear();
  }
  const header=document.querySelector('.topic-reply > .ui-header')!;
  const tabs=el('div','','gzk-reply-tabs');const allButton=button('全部回复',()=>{mode='all';render();});const hotButton=button('热门回复',()=>{mode='hot';render();});
  const nesting=el('select');nesting.setAttribute('aria-label','楼中楼展现形式');for(const [value,label]of [['indent','逐层缩进'],['align','靠左对齐'],['off','原始楼层']]){const option=el('option',label);option.value=value!;nesting.append(option);}
  nesting.value=settings.nested;nesting.addEventListener('change',()=>{void (async()=>{try{const saved=await saveSettings({nested:nesting.value as Settings['nested']});settings=saved.settings;render();}catch(error){nesting.value=settings.nested;toast(error instanceof Error?error.message:'保存失败',true);}})();});
  tabs.append(allButton,hotButton,nesting);header.append(tabs);const feedback=el('div','','gzk-reply-status');header.append(feedback);
  const author=document.querySelector('.topic-detail .meta .username')?.textContent?.trim();
  const current=document.querySelector('.navbar-right a[href^="/u/"]')?.getAttribute('href')?.split('/')[2];
  function decorate(row:Reply) {
    row.element.id=`gzk-reply-${row.floor}`;row.element.dataset.gzkReply=row.id;
    const meta=row.element.querySelector(':scope > .main > .meta');
    if(meta&&!meta.querySelector('.gzk-reply-action')) {
      const user=meta.querySelector('.reply-username');
      if(row.author===author)user?.after(el('span','OP','gzk-badge'));
      if(row.author===current)user?.after(el('span','YOU','gzk-badge'));
      const native=meta.querySelector<HTMLElement>('.J_replyTo');
      const quote=button('回复',()=>{
        const input=document.querySelector<HTMLTextAreaElement>('textarea.J_replyContent');
        if(!input){toast('请先登录过早客后回复',true);return;}
        const prefix=`@${row.author} #${row.floor} `;
        input.setRangeText(prefix,input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.scrollIntoView({behavior:'smooth',block:'center'});
      },'gzk-button gzk-reply-action');meta.append(quote);if(native)native.hidden=true;
    }
    const content=row.element.querySelector<HTMLElement>(':scope > .main > .content');
    if(content&&!row.element.querySelector(':scope > .main > .gzk-fold-button')) {
      const fold=button('展开完整回复',()=>{const closed=content.classList.toggle('gzk-folded');fold.textContent=closed?'展开完整回复':'收起长回复';fold.setAttribute('aria-expanded',String(!closed));},'gzk-button gzk-fold-button');
      fold.hidden=true;content.after(fold);
    }
  }
  function render() {
    tabs.hidden=!settings.enabled;feedback.hidden=!settings.enabled;
    if(!settings.enabled){mode='all';restoreNativeReplies();return;}
    for(const row of rows){const count=Number(row.element.querySelector<HTMLElement>(':scope > .main > .meta .J_replyVote')?.dataset.count);if(Number.isFinite(count))row.likes=count;}
    for(const row of rows)container!.append(row.element);
    container!.querySelectorAll('.gzk-reply-children').forEach(e=>e.remove());
    rows.forEach(row=>{decorate(row);row.element.hidden=false;row.element.classList.remove('gzk-nested');row.element.querySelectorAll('.gzk-parent-link').forEach(e=>e.remove());});
    if(!settings.enabled)mode='all';
    if(mode==='hot') {
      const sorted=[...rows].sort((a,b)=>b.likes-a.likes||a.floor-b.floor);sorted.forEach(row=>{row.element.hidden=row.likes<=0;container!.append(row.element);});
      feedback.textContent=rows.some(r=>r.likes>0)?'按原站点赞数排序，点击楼层可定位原回复。':'当前还没有获得点赞的回复。';
    } else {
      feedback.textContent='';
      if(settings.enabled&&settings.nested!=='off') {
        const parents=buildThreads(rows,settings.multipleMention),byId=new Map(rows.map(r=>[r.id,r]));
        const groupMap=new Map<string,HTMLElement>();
        for(const row of rows) {
          const parent=byId.get(parents.get(row.id)||'');if(!parent)continue;
          let group=groupMap.get(parent.id);
          if(!group){group=el('div','','gzk-reply-children');parent.element.append(group);groupMap.set(parent.id,group);}
          group.append(row.element);row.element.classList.add('gzk-nested');
          const jump=button(`↳ #${parent.floor}`,()=>{parent.element.scrollIntoView({behavior:'smooth',block:'center'});parent.element.animate([{backgroundColor:'#a7f3d0'},{backgroundColor:'transparent'}],{duration:1200});},'gzk-parent-link');jump.title='推断的回复关系，点击查看上文';row.element.querySelector(':scope > .main > .meta')?.append(jump);
        }
      }
    }
    container!.classList.toggle('gzk-align',settings.nested==='align');
    rows.forEach(row=>{
      const content=row.element.querySelector<HTMLElement>(':scope > .main > .content')!;const fold=row.element.querySelector<HTMLButtonElement>(':scope > .main > .gzk-fold-button')!;
      content.classList.remove('gzk-folded');const long=content.scrollHeight>260||row.text.length>650;
      fold.hidden=!settings.autoFold||!long;if(!fold.hidden){content.classList.add('gzk-folded');fold.textContent='展开完整回复';fold.setAttribute('aria-expanded','false');}
      const floor=[...row.element.querySelectorAll<HTMLElement>(':scope > .main > .meta .floor')].find(e=>/^#\d+$/.test(e.textContent?.trim()||''));
      if(floor){floor.tabIndex=0;floor.setAttribute('role','button');floor.title=`定位第 ${row.floor} 楼`;const jump=()=>{mode='all';render();row.element.scrollIntoView({behavior:'smooth',block:'center'});};floor.onclick=jump;floor.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();jump();}};}
    });
    allButton.classList.toggle('active',mode==='all');hotButton.classList.toggle('active',mode==='hot');hotButton.textContent=`热门回复 · ${rows.filter(r=>r.likes>0).length}`;allButton.textContent=`全部回复 · ${rows.length}`;
    nesting.value=settings.nested;
  }
  async function preload() {
    const pageNumber=(url:string)=>{const query=new URL(url).searchParams;return Number(query.get('p')||query.get('page')||1);};
    if(loading||loaded||disposed||!settings.enabled||!settings.preload||pageNumber(location.href)!==1)return;
    const pages=replyPages(document,location.href).filter(page=>pageNumber(page)>1).slice(0,2);if(!pages.length){loaded=true;return;}
    const revision=preloadRevision,current=()=>!disposed&&settings.enabled&&settings.preload&&revision===preloadRevision;
    loading=true;feedback.textContent='正在预加载其他页回复…';
    try {
      const batch:Array<{row:Reply;page:string}>=[],seen=new Set(rows.map(r=>r.id));
      for(const page of pages) {
        const doc=await fetchDocument(page);if(!current())return;
        const incoming=parseReplies(doc);
        if(!incoming.length)throw new Error('目标分页未找到回复');
        for(const row of incoming)if(!seen.has(row.id)){batch.push({row,page});seen.add(row.id);}
      }
      // Commit the whole batch only after every page succeeds and the setting is still active.
      for(const {row,page} of batch){
          // Rebuild only the new reply shell. Never import scripts/inline handlers from fetched HTML.
          const shell=el('div','','reply-item'),main=el('div','','main'),meta=el('div','','meta');const link=el('a',row.author,'reply-username');link.href=`/u/${encodeURIComponent(row.author)}`;const floor=el('span',`#${row.floor}`,'floor');meta.append(link,floor);
          const time=row.element.querySelector(':scope > .main > .meta .time')?.textContent;if(time)meta.append(el('span',time,'time'));
          const vote=button(`赞 ${row.likes}`,async()=>{vote.disabled=true;try{await voteReply(row.id);vote.dataset.count=String(row.likes+1);vote.textContent=`已赞 ${row.likes+1}`;}catch(error){vote.disabled=false;throw error;}},'gzk-button J_replyVote');vote.dataset.count=String(row.likes);meta.append(vote);
          if(row.avatar){const avatarLink=el('a');avatarLink.href=link.href;const image=el('img','','avatar');image.src=row.avatar;image.alt=row.author;image.loading='lazy';avatarLink.append(image);shell.append(avatarLink);}
          const content=el('span','','content');richHtml(content,row.html,page);main.append(meta,content);shell.append(main);row.element=shell;rows.push(row);
      }
      document.querySelectorAll<HTMLAnchorElement>('.pagination a[href]').forEach(link=>{
        try{if(pages.includes(readableUrl(new URL(link.getAttribute('href')!,location.href).href))){if(!originalPagination.has(link))originalPagination.set(link,link.getAttribute('title'));link.classList.add('gzk-preloaded-page');link.title=[link.title,'回复已合并到本页'].filter(Boolean).join(' · ');}}catch{/* Ignore unrelated pagination links. */}
      });
      rows.sort((a,b)=>a.floor-b.floor);loaded=true;render();toast(`已合并其他 ${pages.length} 页回复；更多回复可使用原站翻页查看`);
    } catch(error) {if(current())feedback.replaceChildren(el('span',error instanceof Error?error.message:'预加载失败'),button('重试',preload));}
    finally{loading=false;if(!disposed&&revision!==preloadRevision)void preload();}
  }
  render();void preload();
  const votes=new MutationObserver(records=>{if(records.some(record=>record.attributeName==='data-count')){for(const row of rows){const count=Number(row.element.querySelector<HTMLElement>(':scope > .main > .meta .J_replyVote')?.dataset.count);if(Number.isFinite(count))row.likes=count;}if(mode==='hot')render();else hotButton.textContent=`热门回复 · ${rows.filter(r=>r.likes>0).length}`;}});
  votes.observe(container,{attributes:true,subtree:true,attributeFilter:['data-count']});
  const jump=location.hash.match(/^#(?:reply|gzk-reply-)(\d+)$/)?.[1];
  if(jump)setTimeout(()=>document.getElementById(`gzk-reply-${jump}`)?.scrollIntoView({block:'center'}),100);
  if(new URL(location.href).searchParams.has('p'))document.querySelector('.topic-reply')?.scrollIntoView();
  return {update(s:Settings){if(disposed)return;if(settings.enabled!==s.enabled||settings.preload!==s.preload)preloadRevision++;settings=s;render();void preload();},hot(){if(disposed)return;mode='hot';render();header.scrollIntoView({behavior:'smooth',block:'start'});},destroy(){disposed=true;preloadRevision++;votes.disconnect();restoreNativeReplies();tabs.remove();feedback.remove();}};
}
