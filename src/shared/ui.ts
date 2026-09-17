import DOMPurify from 'dompurify';
import { safeLink } from '../site/urls';
import styles from '../styles/overlay.css?inline';
export function el<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''):HTMLElementTagNameMap[K] {
  const node=document.createElement(tag); if(text)node.textContent=text; if(className)node.className=className; return node;
}
export function button(text:string,action:()=>unknown,className='gzk-button'):HTMLButtonElement {
  const node=el('button',text,className);node.type='button';node.addEventListener('click',()=>{Promise.resolve().then(action).catch(error=>toast(error instanceof Error?error.message:'操作失败',true));});return node;
}
export function richHtml(target:HTMLElement,html:string,base?:string,options: {deferImages?: boolean} = {}) {
  const template=document.createElement('template');
  template.innerHTML=DOMPurify.sanitize(html,{USE_PROFILES:{html:true},FORBID_TAGS:['form','input','button','textarea','select','style','iframe','video','audio'],FORBID_ATTR:['style','id','name','srcset','background']});
  template.content.querySelectorAll<HTMLAnchorElement>('a').forEach(a=>{const href=safeLink(a.getAttribute('href')||'',base);if(href){a.href=href;a.target='_blank';a.rel='noopener noreferrer';}else a.removeAttribute('href');});
  template.content.querySelectorAll<HTMLImageElement>('img').forEach(img=>{const src=safeLink(img.getAttribute('src')||'',base);if(src){img.referrerPolicy='no-referrer';if(options.deferImages){img.dataset.shareSource=src;img.removeAttribute('src');}else img.src=src;img.loading='lazy';}else img.remove();});
  target.replaceChildren(template.content);
}
export function overlayHost() {
  const host=el('div','','gzk-overlay-host');
  const root=host.attachShadow({mode:'open'}); const style=el('style'); style.textContent=styles;root.append(style);document.body.append(host);
  return {host,root};
}
const scrollLocks=new WeakMap<HTMLElement,{count:number;original:{name:string;value:string;priority:string}[]}>();
const overflowProperties=['overflow','overflow-x','overflow-y'];
export function lockPageScroll() {
  const body=document.body;
  let lock=scrollLocks.get(body);
  if(!lock){
    const original=Array.from(body.style).filter(name=>overflowProperties.includes(name)).map(name=>({name,value:body.style.getPropertyValue(name),priority:body.style.getPropertyPriority(name)}));
    lock={count:0,original};scrollLocks.set(body,lock);
    overflowProperties.forEach(name=>body.style.removeProperty(name));
    body.style.setProperty('overflow','hidden','important');
  }
  lock.count++;
  let released=false;
  return ()=>{
    if(released)return;released=true;
    if(--lock.count)return;
    overflowProperties.forEach(name=>body.style.removeProperty(name));
    lock.original.forEach(({name,value,priority})=>body.style.setProperty(name,value,priority));
    scrollLocks.delete(body);
  };
}
const openModals=new Set<HTMLDialogElement>();
export function modal(title:string, options:{compact?:boolean;canClose?:()=>boolean}={}) {
  let active=document.activeElement;
  while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;
  const invoker=active instanceof HTMLElement?active:undefined;
  const {host,root}=overlayHost(); const dialog=el('dialog');if(options.compact)dialog.classList.add('compact'); const header=el('header'); const heading=el('h2',title);heading.id='gzk-dialog-title';dialog.setAttribute('aria-labelledby',heading.id);
  const unlock=lockPageScroll();openModals.add(dialog);
  let closed=false,backdropPointer:number|undefined;
  const cleanup=()=>{
    if(closed)return;closed=true;
    const wasTop=Array.from(openModals).at(-1)===dialog;
    openModals.delete(dialog);host.remove();unlock();
    if(wasTop&&invoker?.isConnected)invoker.focus({preventScroll:true});
  };
  const close=()=>{if(closed||options.canClose?.()===false)return;dialog.close();cleanup();};
  const dismiss=button('×',close);dismiss.setAttribute('aria-label','关闭'); header.append(heading,dismiss);
  const body=el('section','','body'),footer=el('footer','','dialog-footer');dialog.append(header,body,footer);root.append(dialog);
  const onBackdrop=(event:PointerEvent)=>{
    if(event.target!==dialog)return false;
    const rect=dialog.getBoundingClientRect();
    return event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom;
  };
  dialog.addEventListener('close',cleanup);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('pointerdown',event=>{backdropPointer=event.isPrimary&&event.button===0&&onBackdrop(event)?event.pointerId:undefined;});
  dialog.addEventListener('pointerup',event=>{
    const dismissBackdrop=backdropPointer!==undefined&&backdropPointer===event.pointerId&&event.isPrimary&&event.button===0&&onBackdrop(event);
    backdropPointer=undefined;if(dismissBackdrop)close();
  });
  dialog.addEventListener('pointercancel',()=>{backdropPointer=undefined;});
  try{dialog.showModal();}catch(error){cleanup();throw error;}
  return {host,root,dialog,body,footer,close};
}
export function toast(text:string,error=false) {
  const item=el('div',text,`toast${error?' error':''}`);item.setAttribute('role',error?'alert':'status');
  // A dialog's siblings remain behind the browser top layer, regardless of z-index.
  const dialog=Array.from(document.querySelectorAll('.gzk-overlay-host')).reverse().map(host=>host.shadowRoot?.querySelector<HTMLDialogElement>('dialog[open]')).find(Boolean);
  if(dialog){dialog.append(item);setTimeout(()=>item.remove(),4000);}
  else{const {host,root}=overlayHost();root.append(item);setTimeout(()=>host.remove(),4000);}
}
