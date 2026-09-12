import { beforeEach, expect, it, vi } from 'vitest';
import { initialState } from '../src/shared/state';
const api = vi.hoisted(() => ({ listener: vi.fn(), localGet: vi.fn(), localSet: vi.fn(), syncGet: vi.fn(), syncSet: vi.fn(), fetch: vi.fn(), tabsCreate:vi.fn() }));
vi.mock('wxt/utils/define-background', () => ({ defineBackground: (main: () => void) => main() }));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { id: 'test-extension', getURL:(path:string)=>`chrome-extension://test-extension${path}`, onMessage: { addListener: api.listener }, onInstalled: { addListener: vi.fn() }, openOptionsPage: vi.fn() },
  tabs: {create:api.tabsCreate},
  storage: { local: { get: api.localGet, set: api.localSet }, sync: { get: api.syncGet, set: api.syncSet } },
  contextMenus: { onClicked: { addListener: vi.fn() } },
} }));
let local: Record<string, unknown>, sync: Record<string, unknown>;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); local = {}; sync = {};
  api.localGet.mockImplementation(async () => structuredClone(local));
  api.syncGet.mockImplementation(async () => structuredClone(sync));
  api.localSet.mockImplementation(async data => Object.assign(local, structuredClone(data)));
  api.syncSet.mockImplementation(async data => Object.assign(sync, structuredClone(data)));
  await import('../entrypoints/background');
});
const send = (message: unknown): Promise<{ ok: boolean; data?: ReturnType<typeof initialState>; error?: string }> => new Promise(resolve => api.listener.mock.calls[0]![0](message, { id: 'test-extension' }, resolve));
it('并发修改串行处理，设置与标签不会互相覆盖', async () => {
  const results = await Promise.all([
    send({ type: 'state:mutate', action: 'settings', payload: { theme: 'dark' } }),
    send({ type: 'state:mutate', action: 'tags', payload: { username: 'alice', tags: ['开发者'] } }),
  ]);
  expect(results.every(result => result.ok)).toBe(true);
  const state = await send({ type: 'state:get' });
  expect(state.data?.settings.theme).toBe('dark');
  expect(state.data?.tags.alice).toEqual(['开发者']);
});
it('导入本地写入失败时恢复原同步设置，并返回失败', async () => {
  const original = initialState();
  const payload = { version: 1, ...original, settings: { ...original.settings, theme: 'dark' }, reading: [{ id: '1', url: 'https://www.guozaoke.com/t/1', title: '测试' }] };
  api.localSet.mockRejectedValueOnce(new Error('local write failed'));
  const result = await send({ type: 'state:mutate', action: 'import', payload });
  expect(result).toMatchObject({ ok: false, error: 'local write failed' });
  expect((await send({ type: 'state:get' })).data).toEqual(original);
});
it('网页代理拒绝站内写操作且拒绝其他扩展发送消息', async () => {
  expect(await send({ type: 'site:get', url: '/replyVote?reply_id=1' })).toMatchObject({ ok: false });
  const response = vi.fn();
  const keptOpen = api.listener.mock.calls[0]![0]({ type: 'state:get' }, { id: 'another-extension' }, response);
  expect(keptOpen).toBeUndefined();
  expect(response).not.toHaveBeenCalled();
});
it('分享入口只打开目标站主题对应的本地分享页，拒绝外站和非主题地址', async () => {
  for (const url of ['https://other.example.com/t/1','https://www.guozaoke.com/logout','javascript:alert(1)']) expect(await send({type:'share:open',url})).toMatchObject({ok:false});
  expect(api.tabsCreate).not.toHaveBeenCalled();
  expect(await send({type:'share:open',url:'https://www.guozaoke.com/t/133068#reply-1'})).toMatchObject({ok:true});
  expect(api.tabsCreate).toHaveBeenCalledWith({url:'chrome-extension://test-extension/share.html?topic=133068'});
});
