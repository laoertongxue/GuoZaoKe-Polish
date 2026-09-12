import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installMemberCards } from '../src/features/members';
import { fetchMember } from '../src/site/client';
vi.mock('../src/site/client', () => ({ fetchMember: vi.fn() }));
vi.mock('../src/shared/store', () => ({ getState: vi.fn(), setTags: vi.fn() }));

let cards: ReturnType<typeof installMemberCards> | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchMember).mockReset();
  document.documentElement.dataset.gzkTheme = 'light';
  document.body.innerHTML = '<a href="https://www.guozaoke.com/u/demo">demo</a>';
});
afterEach(() => { cards?.destroy(); vi.useRealTimers(); });

it('悬停等待期间停用增强，不再请求或显示用户卡片', async () => {
  cards = installMemberCards();
  document.querySelector('a')!.dispatchEvent(new Event('pointerover', { bubbles: true }));
  delete document.documentElement.dataset.gzkTheme;
  await vi.advanceTimersByTimeAsync(400);
  expect(fetchMember).not.toHaveBeenCalled();
  expect(document.querySelector('.gzk-overlay-host')).toBeNull();
});

it('停用时关闭已打开卡片，迟到响应不重开，销毁后取消监听', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof fetchMember>>) => void;
  vi.mocked(fetchMember).mockReturnValue(new Promise(yes => { resolve = yes; }));
  cards = installMemberCards();
  const link = document.querySelector('a')!;
  link.dispatchEvent(new Event('pointerover', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(350);
  expect(document.querySelector('.gzk-overlay-host')).not.toBeNull();
  delete document.documentElement.dataset.gzkTheme;
  cards.update();
  expect(document.querySelector('.gzk-overlay-host')).toBeNull();
  resolve({ username: 'demo', avatar: '', description: '迟到资料', url: 'https://www.guozaoke.com/u/demo' });
  await Promise.resolve();
  expect(document.querySelector('.gzk-overlay-host')).toBeNull();
  cards.destroy();
  document.documentElement.dataset.gzkTheme = 'light';
  link.dispatchEvent(new Event('pointerover', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(400);
  expect(fetchMember).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.gzk-overlay-host')).toBeNull();
});
