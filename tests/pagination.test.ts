import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { enhancePagination } from '../src/features/pagination';
let narrow = false;
let resize = () => {};
const cleanups: (()=>void)[] = [];
beforeEach(() => {
  narrow = false;
  vi.stubGlobal('matchMedia', (query:string) => ({ get matches(){return query==='(max-width:767px)'&&narrow;}, addEventListener: (_:string, fn:()=>void)=>{resize=fn;}, removeEventListener:vi.fn() }));
});
afterEach(() => { cleanups.splice(0).forEach(fn=>fn()); vi.unstubAllGlobals(); });
function setup(current=1, total=7392) {
  const numbers = [...new Set([1,2,3,current,total-1,total])].filter(p=>p>0&&p<=total).sort((a,b)=>a-b);
  document.body.innerHTML=`<nav class="hidden-xs"><ul class="pagination"><li class="${current===1?'disabled':''}"><a href="/u/demo/replies?sort=latest&p=${Math.max(1,current-1)}#replies">上一页</a></li>${numbers.map(p=>`<li class="${p===current?'active':''}"><a href="${p===current?'javascript:;':`/u/demo/replies?sort=latest&p=${p}#replies`}">${p}</a></li>`).join('')}<li class="${current===total?'disabled':''}"><a href="/u/demo/replies?sort=latest&p=${Math.min(total,current+1)}#replies">下一页</a></li></ul></nav><div class="pagination-wap">原移动分页</div>`;
}
it('首页展示十个独立页码和末页，翻页键在末尾，保留原链接和点击监听',()=>{
  setup();
  const ul=document.querySelector('ul')!;const original=[...ul.childNodes];
  const two=ul.querySelector<HTMLAnchorElement>('a[href*="p=2"]')!;const click=vi.fn((e:Event)=>e.preventDefault());two.addEventListener('click',click);
  const controller=enhancePagination(true);cleanups.push(controller.destroy);
  expect([...ul.querySelectorAll('li[data-page]')].map(li=>Number((li as HTMLElement).dataset.page))).toEqual([1,2,3,4,5,6,7,8,9,10,7392]);
  expect(ul.querySelector('[data-page="2"] a')).toBe(two);two.click();expect(click).toHaveBeenCalledOnce();
  expect(ul.querySelector('[data-page="10"] a')!.getAttribute('href')).toBe('/u/demo/replies?sort=latest&p=10#replies');
  expect(ul.querySelector('[aria-current="page"]')!.textContent).toBe('1');
  expect(ul.querySelector('.gzk-page-prev a')!.hasAttribute('href')).toBe(false);
  expect(ul.querySelector('.gzk-page-prev a')!.getAttribute('aria-disabled')).toBe('true');
  expect(ul.lastElementChild!.classList.contains('gzk-page-next')).toBe(true);
  controller.update(false);expect([...ul.childNodes]).toEqual(original);expect(ul.firstElementChild!.textContent).toBe('上一页');
  expect(ul.querySelector('[data-page]')).toBeNull();expect(document.querySelector('.gzk-pagination-nav')).toBeNull();
  controller.update(true);expect(ul.querySelectorAll('.gzk-page-prev')).toHaveLength(1);
});
it('中间页有两侧省略号，窄屏保留当前页及首末页',()=>{
  setup(50,100);const c=enhancePagination(true);cleanups.push(c.destroy);
  expect(document.querySelectorAll('.gzk-page-ellipsis')).toHaveLength(2);
  expect(document.querySelector('[aria-current="page"]')!.textContent).toBe('50');
  narrow=true;resize();
  expect(document.querySelectorAll('[data-page]')).toHaveLength(5);
  expect(document.querySelector('[data-page="1"]')).not.toBeNull();expect(document.querySelector('[data-page="100"]')).not.toBeNull();
  expect(document.querySelector('.gzk-page-next a')!.getAttribute('href')).toContain('p=51');
});
it('末页下一页不可点击，少量页码不会重复或生成越界链接',()=>{
  setup(3,3);const c=enhancePagination(true);cleanups.push(c.destroy);
  expect(document.querySelectorAll('[data-page]')).toHaveLength(3);
  expect(document.querySelector('.gzk-page-next a')!.getAttribute('tabindex')).toBe('-1');
  expect(document.querySelector('.gzk-page-next a')!.hasAttribute('href')).toBe(false);
  expect(document.querySelectorAll('.gzk-page-ellipsis')).toHaveLength(0);
});
it('不能确认分页地址时保留原列表，不猜测站外或无效链接',()=>{
  document.body.innerHTML='<ul class="pagination"><li class="active"><a>1</a></li><li><a href="https://other.example/?p=2">2</a></li></ul>';
  const before=document.body.innerHTML;const c=enhancePagination(true);cleanups.push(c.destroy);expect(document.body.innerHTML).toBe(before);
});
it.each([
  ['(min-width:992px) and (max-width:1199px)',9],
  ['(max-width:359px)',3],
])('较窄布局 %s 减少页码但保留当前页和首末页', (query, count)=>{
  vi.stubGlobal('matchMedia',(value:string)=>({matches:value===query,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
  setup(5000,7392);const c=enhancePagination(true);cleanups.push(c.destroy);
  expect(document.querySelectorAll('[data-page]')).toHaveLength(count);
  expect(document.querySelector('[aria-current="page"]')!.textContent).toBe('5000');
  expect(document.querySelector('[data-page="1"]')).not.toBeNull();expect(document.querySelector('[data-page="7392"]')).not.toBeNull();
});
