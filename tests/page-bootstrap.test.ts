import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bootstrapPage } from '../src/features/page-bootstrap';
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
