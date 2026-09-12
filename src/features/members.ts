import { fetchMember } from '../site/client';
import { getState, setTags } from '../shared/store';
import { button, el, overlayHost } from '../shared/ui';
import { browser } from 'wxt/browser';
import { showTagDialog } from './tag-dialog';
import type { AppState } from '../shared/store';
import { ORIGIN } from '../site/urls';
export function usernameOf(a:HTMLAnchorElement):string {
  try{const u=new URL(a.href);return ['www.guozaoke.com','guozaoke.com'].includes(u.hostname)?decodeURIComponent(u.pathname.match(/^\/u\/([\w-]+)\/?$/)?.[1]||''):'';}catch{return '';}
}
export async function editTags(username:string) {
  const state=await getState();
  return showTagDialog(username,state.tags[username]||[],tags=>setTags(username,tags),()=>browser.runtime.sendMessage({type:'options:open',page:'tags'}));
}
export function paintTags(state:AppState) {
  document.querySelectorAll('.gzk-tags').forEach(e=>e.remove());
  document.querySelectorAll<HTMLAnchorElement>('.meta .username a, .reply-username, .profile > .ui-header > a, .usercard > .ui-header > a').forEach(a=>{
    const username=usernameOf(a), tags=state.tags[username];if(!tags?.length)return;
    const span=el('span','',`gzk-tags ${state.settings.tagDisplay==='block'?'gzk-tags-block':''}`);
    tags.forEach(tag=>span.append(button(tag,()=>editTags(username),'gzk-tag')));a.after(span);
  });
}
export function installMemberCards() {
  let timer:ReturnType<typeof setTimeout>|undefined,host:HTMLElement|undefined,active='';
  let disposed=false;
  const enabled=()=>!disposed&&document.documentElement.hasAttribute('data-gzk-theme');
  const cache=new Map<string,ReturnType<typeof fetchMember>>();
  const hide=()=>{clearTimeout(timer);host?.remove();host=undefined;active='';};
  const pointerOver=(event:Event)=>{
    if(!enabled())return;
    const a=(event.target as Element).closest<HTMLAnchorElement>('a[href*="/u/"]');if(!a)return;
    const name=usernameOf(a);if(!name||name===active)return;clearTimeout(timer);
    timer=setTimeout(async()=>{
      if(!enabled())return;
      hide();active=name;const overlay=overlayHost();host=overlay.host;const card=el('div','','member-card');overlay.root.append(card);
      const rect=a.getBoundingClientRect();card.style.left=`${Math.max(12,Math.min(rect.left,window.innerWidth-312))}px`;card.style.top=`${Math.max(12,Math.min(rect.bottom+8,window.innerHeight-330))}px`;
      const title=el('h3',name),info=el('p','正在读取用户信息…','muted');card.append(title,info);
      const actions=el('div','','actions');const link=el('a','个人主页 ↗');link.href=`${ORIGIN}/u/${encodeURIComponent(name)}`;link.target='_blank';link.rel='noopener';actions.append(button('设置标签',()=>{hide();return editTags(name);}),link);card.append(actions);
      card.addEventListener('pointerenter',()=>clearTimeout(timer));card.addEventListener('pointerleave',()=>{timer=setTimeout(hide,200);});
      try{if(cache.size>100)cache.clear();if(!cache.has(name))cache.set(name,fetchMember(name));const data=await cache.get(name)!;if(active!==name||!enabled())return;info.textContent=data.description;if(data.avatar){const img=el('img');img.src=data.avatar;img.alt=name;card.prepend(img);}}
      catch(error){cache.delete(name);if(active===name&&enabled())info.textContent=error instanceof Error?error.message:'读取失败';}
    },350);
  };
  const pointerOut=(event:Event)=>{if((event.target as Element).closest('a[href*="/u/"]')){clearTimeout(timer);timer=setTimeout(hide,300);}};
  const keydown=(event:KeyboardEvent)=>{if(event.key==='Escape')hide();};
  document.addEventListener('pointerover',pointerOver);
  document.addEventListener('pointerout',pointerOut);
  document.addEventListener('keydown',keydown);
  window.addEventListener('scroll',hide,{passive:true});
  return {
    update(){if(!enabled())hide();},
    destroy(){disposed=true;hide();document.removeEventListener('pointerover',pointerOver);document.removeEventListener('pointerout',pointerOut);document.removeEventListener('keydown',keydown);window.removeEventListener('scroll',hide);},
  };
}
