import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaults } from '../src/shared/settings';
import type { AppState } from '../src/shared/store';
import type { Topic } from '../src/shared/types';

const api = vi.hoisted(() => ({
  getState: vi.fn(), addReading: vi.fn(), markRead: vi.fn(), removeReading: vi.fn(), watchState: vi.fn(),
  fetchTopics: vi.fn(), fetchAccount: vi.fn(), fetchNotices: vi.fn(), openOptionsPage: vi.fn(), createTab: vi.fn(),
}));
vi.mock('../src/shared/store', () => api);
vi.mock('../src/site/client', () => api);
vi.mock('wxt/browser', () => ({ browser: { runtime: { openOptionsPage: api.openOptionsPage }, tabs: { create: api.createTab } } }));

let state: AppState;
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
const topic = (title: string, id: string): Topic => ({ id, title, url: `https://www.guozaoke.com/t/${id}`, author: 'alice', avatar: '', node: '分享', replies: 3, time: '刚刚' });
const tab = (key: string) => document.querySelector<HTMLButtonElement>(`#tab-${key}`)!;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '<main id="app"></main>';
  state = { settings: { ...defaults }, tags: {}, reading: [] };
  api.getState.mockImplementation(async () => structuredClone(state));
  api.watchState.mockReturnValue(() => {});
  api.fetchAccount.mockResolvedValue({ username: '', unread: 0 });
  api.fetchNotices.mockRejectedValue(new Error('请先登录过早客后重试'));
  api.fetchTopics.mockResolvedValue([]);
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); });

describe('popup navigation and persistence', () => {
  it('shows the target site login route for a successful guest account response', async () => {
    await import('../entrypoints/popup/main');
    await settle();
    const account = document.querySelector<HTMLAnchorElement>('.popup-footer a')!;
    expect(account.textContent).toBe('登录过早客');
    expect(account.href).toBe('https://www.guozaoke.com/login');
    expect(document.querySelector('.popup-footer a[href*="/member/"]')).toBeNull();
    expect(tab('message').getAttribute('aria-label')).toBe('消息，0 条未读');
  });

  it('links a signed-in account to the target site user profile route', async () => {
    api.fetchAccount.mockResolvedValue({ username: 'alice', unread: 2 });
    await import('../entrypoints/popup/main');
    await settle();
    const account = document.querySelector<HTMLAnchorElement>('.popup-footer a')!;
    expect(account.textContent).toBe('alice');
    expect(account.href).toBe('https://www.guozaoke.com/u/alice');
    expect(tab('message').getAttribute('aria-label')).toBe('消息，2 条未读');
  });

  it('does not allow a slow previous tab to replace the active tab', async () => {
    let resolveHot!: (topics: Topic[]) => void;
    const hot = new Promise<Topic[]>(resolve => { resolveHot = resolve; });
    api.fetchTopics.mockImplementation((mode: string) => mode === 'hot' ? hot : Promise.resolve([topic('最新主题', '2')]));
    await import('../entrypoints/popup/main');
    await settle();
    tab('hot').click();
    tab('latest').click();
    await settle();
    expect(document.querySelector('#popup-panel')?.textContent).toContain('最新主题');
    resolveHot([topic('旧的热门请求', '1')]);
    await settle();
    expect(document.querySelector('#popup-panel')?.textContent).not.toContain('旧的热门请求');
    expect(tab('latest').getAttribute('aria-selected')).toBe('true');
    tab('latest').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await settle();
    expect(tab('hot').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('hot'));
  });

  it('shows a login link only for an authentication error in the messages panel', async () => {
    await import('../entrypoints/popup/main');
    await settle();
    tab('message').click();
    await settle();
    expect(document.querySelector<HTMLAnchorElement>('#popup-panel a')?.href).toBe('https://www.guozaoke.com/login');
    api.fetchNotices.mockRejectedValue(new Error('站点响应无法解析'));
    document.querySelector<HTMLButtonElement>('#popup-panel button')!.click();
    await settle();
    expect(document.querySelector('#popup-panel')?.textContent).toContain('站点响应无法解析');
    expect(document.querySelector('#popup-panel a')).toBeNull();
  });

  it('does not remove a reading item or claim success when storage rejects deletion', async () => {
    state.reading = [{ ...topic('需要保留的主题', '10'), addedAt: Date.now(), read: false }];
    api.removeReading.mockRejectedValue(new Error('存储暂不可用'));
    await import('../entrypoints/popup/main');
    await settle();
    document.querySelector<HTMLButtonElement>('.delete-reading')!.click();
    await settle();
    expect(api.removeReading).toHaveBeenCalledWith('10');
    expect(document.querySelector('.topic-title')?.textContent).toBe('需要保留的主题');
    expect(document.querySelector('.popup-footer .status')?.textContent).toContain('删除失败：存储暂不可用');
  });

  it('persists read status before opening a tab', async () => {
    state.reading = [{ ...topic('打开之前持久化', '10'), addedAt: Date.now(), read: false }];
    let resolveMark!: (state: AppState) => void;
    api.markRead.mockImplementation(() => new Promise<AppState>(resolve => { resolveMark = resolve; }));
    await import('../entrypoints/popup/main');
    await settle();
    document.querySelector<HTMLAnchorElement>('.topic-title')!.click();
    await settle();
    expect(api.markRead).toHaveBeenCalledWith('10', true);
    expect(api.createTab).not.toHaveBeenCalled();
    resolveMark(state);
    await settle();
    expect(api.createTab).toHaveBeenCalledWith({ url: 'https://www.guozaoke.com/t/10' });
  });
});
