import { browser } from 'wxt/browser';
import { el, button } from './app-ui';

export const author = {
  name:'拾贰画生',
  blog:'https://www.shierhuasheng.cn',
  signature:'有那么点儿追求的中年男人',
} as const;

export function authorCard() {
  const card=el('div','gzk-author');
  const avatar=el('img','gzk-author-avatar');
  avatar.src=browser.runtime.getURL('/author-avatar.jpeg');
  avatar.alt=`${author.name}的头像`;avatar.width=72;avatar.height=72;
  const copy=el('div','gzk-author-copy');
  const name=el('a','gzk-author-name',author.name);
  name.href=author.blog;name.target='_blank';name.rel='noopener noreferrer';name.title=`作者博客：${author.blog}`;
  const heading=el('div','gzk-author-heading');
  heading.append(name);
  copy.append(heading,el('p','gzk-author-signature',author.signature));
  const blog=el('a','gzk-author-blog',author.blog);
  blog.href=author.blog;blog.target='_blank';blog.rel='noopener noreferrer';copy.append(blog);
  card.append(avatar,copy);return card;
}

export function footerAuthor() {
  const wrapper=el('div','gzk-footer-author');
  const trigger=button(author.name,'gzk-author-trigger');
  trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','gzk-author-popover');
  const card=el('div','gzk-author-popover');card.id='gzk-author-popover';card.hidden=true;
  card.setAttribute('role','region');card.setAttribute('aria-label','作者信息');card.append(authorCard());
  const show=(open:boolean)=>{card.hidden=!open;trigger.setAttribute('aria-expanded',String(open));};
  wrapper.append(el('span','','Made by '),trigger,card);
  trigger.addEventListener('mouseenter',()=>show(true));
  wrapper.addEventListener('mouseleave',()=>{if(!wrapper.contains(document.activeElement))show(false);});
  wrapper.addEventListener('focusin',()=>show(true));
  wrapper.addEventListener('focusout',event=>{if(!wrapper.contains(event.relatedTarget as Node)&&!wrapper.matches(':hover'))show(false);});
  trigger.addEventListener('click',()=>show(true));
  wrapper.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();trigger.focus();show(false);}});
  return wrapper;
}
