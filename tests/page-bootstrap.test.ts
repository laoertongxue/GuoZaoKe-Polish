import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { applyPageAppearance, bootstrapPage } from '../src/features/page-bootstrap';
import { initialState } from '../src/shared/state';
const cleanups:(()=>void)[]=[];
beforeEach(()=>{
  vi.useFakeTimers();document.documentElement.removeAttribute('data-gzk-theme');
  vi.stubGlobal('matchMedia',()=>({matches:false}));
  vi.spyOn(document,'readyState','get').mockReturnValue('complete');
});
afterEach(()=>{cleanups.splice(0).forEach(fn=>fn());vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('读取偏好与页面适配期间隐藏原站，主题先应用再显示',async()=>{
  let resolve!:(state:ReturnType<typeof initialState>)=>void;let finish!:()=>void;
  const mount=vi.fn(()=>new Promise<void>(r=>{finish=r;}));
  const boot=bootstrapPage(()=>new Promise(r=>{resolve=r;}),mount);cleanups.push(boot.destroy);
  expect(document.documentElement.hasAttribute('data-gzk-booting')).toBe(true);
  const state=initialState();state.settings.autoTheme=false;state.settings.theme='dark';resolve(state);await Promise.resolve();
  expect(document.documentElement.dataset.gzkTheme).toBe('dark');await Promise.resolve();expect(mount).toHaveBeenCalledWith(state);
  expect(document.documentElement.hasAttribute('data-gzk-booting')).toBe(true);finish();await boot.ready;
  expect(document.documentElement.hasAttribute('data-gzk-booting')).toBe(false);
});
it('等 DOM 解析后再挂载，失效后的迟到偏好不能重新注入',async()=>{
  vi.spyOn(document,'readyState','get').mockReturnValue('loading');
  const mount=vi.fn(async()=>{});const boot=bootstrapPage(async()=>initialState(),mount);cleanups.push(boot.destroy);
  await Promise.resolve();expect(mount).not.toHaveBeenCalled();document.dispatchEvent(new Event('DOMContentLoaded'));await boot.ready;expect(mount).toHaveBeenCalledOnce();
  let resolve!:(state:ReturnType<typeof initialState>)=>void;
  const late=bootstrapPage(()=>new Promise(r=>{resolve=r;}),mount);late.destroy();document.documentElement.removeAttribute('data-gzk-theme');resolve(initialState());await late.ready;
  expect(document.documentElement.hasAttribute('data-gzk-theme')).toBe(false);expect(mount).toHaveBeenCalledOnce();
});
it('读取失败或挂载失败立即恢复可见，挂起读取在 1500ms 自动恢复',async()=>{
  const failed=bootstrapPage(async()=>{throw Error('读取失败');},async()=>{});await expect(failed.ready).rejects.toThrow('读取失败');expect(document.documentElement.hasAttribute('data-gzk-booting')).toBe(false);
  const mount=bootstrapPage(async()=>initialState(),async()=>{throw Error('挂载失败');});await expect(mount.ready).rejects.toThrow('挂载失败');expect(document.documentElement.hasAttribute('data-gzk-booting')).toBe(false);
  const hanging=bootstrapPage(()=>new Promise(()=>{}),async()=>{});cleanups.push(hanging.destroy);
  await vi.advanceTimersByTimeAsync(1499);expect(document.documentElement.hasAttribute('data-gzk-booting')).toBe(true);
  await vi.advanceTimersByTimeAsync(1);expect(document.documentElement.hasAttribute('data-gzk-booting')).toBe(false);
});
it('已停用增强时读取完成就显示原站，不等待功能挂载',async()=>{
  const state=initialState();state.settings.enabled=false;
  const boot=bootstrapPage(async()=>state,()=>new Promise(()=>{}));cleanups.push(boot.destroy);await Promise.resolve();
  expect(document.documentElement.hasAttribute('data-gzk-booting')).toBe(false);expect(document.documentElement.hasAttribute('data-gzk-theme')).toBe(false);
});

it('插件主题与原站开关同步，停用恢复原站主题与内联颜色且不改原站存储',()=>{
  const html=document.createElement('html');html.dataset.theme='dark';html.style.backgroundColor='rgb(32, 47, 61)';html.style.colorScheme='dark';
  html.innerHTML='<head><meta id="gzk-theme-color"></head><body><button data-gzk-theme-toggle aria-checked="true"></button><div id="gzk-night-notice"></div></body>';
  const settings={...initialState().settings,autoTheme:false,theme:'light' as const};
  const storage={getItem:()=> 'dark',setItem:vi.fn()};vi.stubGlobal('localStorage',storage);
  const before={cookie:document.cookie,storage:storage.getItem()};
  applyPageAppearance(html,settings,false);
  expect(html.dataset.theme).toBe('light');expect(html.dataset.gzkTheme).toBe('light');
  expect(html.style.backgroundColor).toBe('var(--gzp-bg)');
  expect(html.querySelector('button')!.getAttribute('aria-checked')).toBe('false');
  applyPageAppearance(html,{...settings,theme:'dawn'},false);expect(html.dataset.theme).toBe('light');
  applyPageAppearance(html,{...settings,theme:'dark'},false);expect(html.dataset.theme).toBe('dark');
  applyPageAppearance(html,{...settings,enabled:false},false);
  expect(html.dataset.theme).toBe('dark');expect(html.style.backgroundColor).toBe('rgb(32, 47, 61)');expect(html.style.colorScheme).toBe('dark');
  expect(html.hasAttribute('data-gzk-theme')).toBe(false);
  expect({cookie:document.cookie,storage:storage.getItem()}).toEqual(before);expect(storage.setItem).not.toHaveBeenCalled();
});

it('原站启动脚本恢复夜间偏好后，停用插件应还原该偏好而不是 HTML 默认值',async()=>{
  const html=document.documentElement;html.dataset.theme='light';html.style.backgroundColor='';html.style.colorScheme='';
  vi.spyOn(document,'readyState','get').mockReturnValue('loading');
  const state=initialState();state.settings.autoTheme=false;state.settings.theme='light';
  const boot=bootstrapPage(async()=>state,async s=>{applyPageAppearance(html,s.settings,false);});cleanups.push(boot.destroy);
  await Promise.resolve();
  html.dataset.theme='dark';html.style.backgroundColor='rgb(32, 47, 61)';html.style.colorScheme='dark';
  document.dispatchEvent(new Event('DOMContentLoaded'));await boot.ready;
  applyPageAppearance(html,{...state.settings,enabled:false},false);
  expect(html.dataset.theme).toBe('dark');expect(html.style.colorScheme).toBe('dark');
  delete html.dataset.theme;html.style.backgroundColor='';html.style.colorScheme='';
});

it('挂载失败撤销已应用的插件主题和广告标记，恢复原站界面',async()=>{
  const html=document.documentElement;html.dataset.theme='dark';
  const boot=bootstrapPage(async()=>initialState(),async s=>{applyPageAppearance(html,s.settings,false);throw Error('mount failed');});
  await expect(boot.ready).rejects.toThrow('mount failed');
  expect(html.hasAttribute('data-gzk-theme')).toBe(false);expect(html.classList.contains('gzk-hide-ads')).toBe(false);expect(html.dataset.theme).toBe('dark');
  delete html.dataset.theme;
});
