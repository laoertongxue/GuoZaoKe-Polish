import type { Settings } from '../shared/settings';
import { button, el, overlayHost, lockPageScroll } from '../shared/ui';
import { safeLink } from '../site/urls';

export function installImagePreview(getSettings:()=>Settings) {
  let closePreview:(()=>void)|undefined;
  const click=(event:MouseEvent)=>{
    const settings=getSettings();if(!settings.enabled||!settings.imagePreview)return;
    const img=(event.target as Element).closest<HTMLImageElement>('.topic-detail > .ui-content img, .reply-item .content img');if(!img)return;
    const src=safeLink(img.currentSrc||img.src);if(!src)return;
    event.preventDefault();closePreview?.();
    const {host,root}=overlayHost(),dialog=el('dialog','','image-preview');dialog.setAttribute('aria-label','查看图片');
    const content=el('div','','image-preview-content'),large=el('img');large.src=src;large.alt=img.alt||'帖子图片';large.referrerPolicy='no-referrer';
    let scale=1;large.style.transform='scale(1)';
    const zoom=(step:number)=>{scale=Math.min(3,Math.max(0.5,scale+step));large.style.transform=`scale(${scale})`;};
    const controls=el('div','','image-preview-controls');controls.append(button('放大',()=>zoom(0.5)),button('缩小',()=>zoom(-0.5)));
    content.append(large);dialog.append(content,controls);root.append(dialog);
    const unlock=lockPageScroll();
    let closed=false,startedOnMask=false;
    const cleanup=()=>{if(closed)return;closed=true;host.remove();unlock();closePreview=undefined;};
    const close=()=>{dialog.close();cleanup();};closePreview=close;
    dialog.addEventListener('close',cleanup);
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.addEventListener('mousedown',event=>{startedOnMask=event.target===dialog;});
    dialog.addEventListener('mouseup',event=>{if(startedOnMask&&event.target===dialog)close();startedOnMask=false;});
    try{dialog.showModal();}catch(error){cleanup();throw error;}
  };
  document.addEventListener('click',click);
  return ()=>{document.removeEventListener('click',click);closePreview?.();};
}
