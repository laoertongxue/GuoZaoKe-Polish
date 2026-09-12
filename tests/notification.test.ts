import { afterEach, expect, it, vi } from 'vitest';
import { positionNotification } from '../src/features/notification';
afterEach(()=>vi.unstubAllGlobals());
it('同一个原生铃铛移入账号卡片，窄屏和停用还原并保留未读状态与监听',()=>{
  let narrow=false;let resize=()=>{};
  vi.stubGlobal('matchMedia',()=>({get matches(){return narrow;},addEventListener:(_:string,fn:()=>void)=>{resize=fn;},removeEventListener:vi.fn()}));
  document.body.innerHTML='<nav class="top-navbar"><a id="bell" class="notification-indicator" href="/notifications"><span class="mail-status unread"></span></a><a id="home" href="/">首页</a></nav><aside class="sidebar-right"><div class="usercard"><div class="ui-header">用户名</div></div></aside>';
  const bell=document.querySelector<HTMLAnchorElement>('#bell')!;const click=vi.fn((e:Event)=>e.preventDefault());bell.addEventListener('click',click);
  const c=positionNotification(true);expect(bell.parentElement!.classList.contains('ui-header')).toBe(true);bell.click();expect(click).toHaveBeenCalledOnce();expect(bell.querySelector('.unread')).not.toBeNull();
  narrow=true;resize();expect(bell.nextElementSibling!.id).toBe('home');
  narrow=false;resize();c.update(false);expect(bell.nextElementSibling!.id).toBe('home');c.update(true);expect(bell.parentElement!.classList.contains('ui-header')).toBe(true);
  c.destroy();expect(bell.nextElementSibling!.id).toBe('home');expect(bell.className).toBe('notification-indicator');
});
it('无账号头部时保留原入口',()=>{
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
  document.body.innerHTML='<nav class="top-navbar"><a class="notification-indicator" href="/notifications">消息</a></nav><aside class="sidebar-right"><div class="usercard">只有统计</div></aside>';
  const before=document.body.innerHTML;const c=positionNotification(true);expect(document.body.innerHTML).toBe(before);c.destroy();
});
