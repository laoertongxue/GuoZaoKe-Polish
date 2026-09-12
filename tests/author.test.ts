import { beforeEach,expect,it,vi } from 'vitest';
import { footerAuthor } from '../src/shared/author';
vi.mock('wxt/browser',()=>({browser:{runtime:{getURL:(path:string)=>`chrome-extension://fixture${path}`}}}));
beforeEach(()=>{document.body.replaceChildren(footerAuthor());});
it('作者名聚焦打开信息卡，焦点进入博客后卡片仍保留，Esc 收起并返回作者名',()=>{
  const trigger=document.querySelector('button')!,card=document.querySelector<HTMLElement>('.gzk-author-popover')!;
  expect(card.hidden).toBe(true);trigger.focus();expect(card.hidden).toBe(false);
  const blog=card.querySelector<HTMLAnchorElement>('.gzk-author-blog')!;blog.focus();expect(card.hidden).toBe(false);
  blog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  expect(card.hidden).toBe(true);expect(document.activeElement).toBe(trigger);expect(trigger.getAttribute('aria-expanded')).toBe('false');
});
it('鼠标离开没有焦点的信息卡时收起，触屏点击作者名可打开',()=>{
  const wrapper=document.querySelector('.gzk-footer-author')!,card=document.querySelector<HTMLElement>('.gzk-author-popover')!;
  document.querySelector('button')!.dispatchEvent(new MouseEvent('mouseenter'));expect(card.hidden).toBe(false);
  wrapper.dispatchEvent(new MouseEvent('mouseleave'));expect(card.hidden).toBe(true);
  document.querySelector('button')!.click();expect(card.hidden).toBe(false);
});
it('焦点离开作者区域后收起，不拦截外部的键盘导航',()=>{
  const outside=document.createElement('button');document.body.append(outside);
  document.querySelector('button')!.focus();outside.focus();
  expect(document.querySelector<HTMLElement>('.gzk-author-popover')!.hidden).toBe(true);
});
