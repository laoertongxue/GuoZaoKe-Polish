import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initialState } from '../src/shared/state';
const api = vi.hoisted(() => ({ listener: vi.fn(), localGet: vi.fn(), localSet: vi.fn(), syncGet: vi.fn(), syncSet: vi.fn(), fetch: vi.fn(), tabsCreate:vi.fn(), contains:vi.fn(), cookie:vi.fn() }));
vi.mock('wxt/utils/define-background', () => ({ defineBackground: (main: () => void) => main() }));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { id: 'test-extension', getURL:(path:string)=>`chrome-extension://test-extension${path}`, onMessage: { addListener: api.listener }, onInstalled: { addListener: vi.fn() }, openOptionsPage: vi.fn() },
  tabs: {create:api.tabsCreate},
  permissions: {contains:api.contains}, cookies: {get:api.cookie},
  storage: { local: { get: api.localGet, set: api.localSet }, sync: { get: api.syncGet, set: api.syncSet } },
  contextMenus: { onClicked: { addListener: vi.fn() } },
} }));
let local: Record<string, unknown>, sync: Record<string, unknown>;
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks(); local = {}; sync = {};
  api.localGet.mockImplementation(async () => structuredClone(local));
  api.syncGet.mockImplementation(async () => structuredClone(sync));
  api.localSet.mockImplementation(async data => Object.assign(local, structuredClone(data)));
  api.syncSet.mockImplementation(async data => Object.assign(sync, structuredClone(data)));
  api.contains.mockResolvedValue(true);
  api.cookie.mockResolvedValue({value:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'});
  vi.stubGlobal('fetch', api.fetch);
  await import('../entrypoints/background');
});
afterEach(()=>vi.unstubAllGlobals());
const send = (message: unknown, sender = { id: 'test-extension', url:'https://www.guozaoke.com/t/1', frameId:0 }): Promise<{ ok: boolean; data?: ReturnType<typeof initialState>; error?: string }> => new Promise(resolve => api.listener.mock.calls[0]![0](message, sender, resolve));
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

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=';
const upload = {type:'image:upload',provider:'bilibili',base64:png,mime:'image/png'};
const reply = (data:unknown,status=200)=>({ok:status===200,status,json:async()=>data});
it('B站上传复用浏览器会话，只读取防伪标记，不保存凭证', async()=>{
  api.fetch.mockResolvedValue(reply({code:0,data:{image_url:'http://i0.hdslb.com/bfs/new_dyn/test.png'}}));
  expect(await send(upload)).toEqual({ok:true,data:'https://i0.hdslb.com/bfs/new_dyn/test.png'});
  expect(api.contains).toHaveBeenCalledWith({permissions:['cookies'],origins:['https://api.bilibili.com/*']});
  expect(api.cookie).toHaveBeenCalledExactlyOnceWith({url:'https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs',name:'bili_jct'});
  expect(api.fetch).toHaveBeenCalledExactlyOnceWith('https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs',expect.objectContaining({method:'POST',credentials:'include',redirect:'error',referrerPolicy:'no-referrer'}));
  const request=api.fetch.mock.calls[0]![1];
  expect(request.headers).toBeUndefined();
  expect(request.body.get('file_up').type).toBe('image/png');
  expect(request.body.get('csrf')).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  expect(request.body.get('category')).toBe('daily');
  expect(api.localGet).not.toHaveBeenCalled();expect(api.localSet).not.toHaveBeenCalled();
});
it('未授权或未登录时不发送图片',async()=>{
  api.contains.mockResolvedValueOnce(false);
  expect(await send(upload)).toMatchObject({ok:false,error:expect.stringContaining('启用 B 站上传')});
  expect(api.cookie).not.toHaveBeenCalled();
  api.cookie.mockResolvedValueOnce(null);
  expect(await send(upload)).toMatchObject({ok:false,error:expect.stringContaining('登录 B 站')});
  expect(api.fetch).not.toHaveBeenCalled();
});
it('登录失效或服务错误不回传远程原文、凭证或底层异常',async()=>{
  api.fetch.mockResolvedValueOnce(reply({code:-101,message:'remote-sensitive-marker'}));
  const expired=await send(upload);
  expect(expired).toMatchObject({ok:false,error:expect.stringContaining('登录 B 站')});
  expect(JSON.stringify(expired)).not.toContain('remote-sensitive-marker');
  api.fetch.mockResolvedValueOnce(reply('remote-sensitive-marker',404));
  expect(await send(upload)).toMatchObject({ok:false,error:expect.stringContaining('404')});
  api.fetch.mockRejectedValueOnce(new Error('remote-sensitive-marker'));
  expect(JSON.stringify(await send(upload))).not.toContain('remote-sensitive-marker');
  api.fetch.mockResolvedValueOnce({ok:true,status:200,json:async()=>{throw new Error('remote-sensitive-marker');}});
  expect(await send(upload)).toMatchObject({ok:false,error:expect.stringContaining('响应')});
});
it('只接受B站图片域名和路径，拒绝任意跳转或凭证地址',async()=>{
  for(const image_url of ['https://i0.hdslb.com.evil.test/bfs/a.png','https://u:p@i0.hdslb.com/bfs/a.png','https://i0.hdslb.com:444/bfs/a.png','https://i0.hdslb.com/not-image','javascript:alert(1)']){
    api.fetch.mockResolvedValueOnce(reply({code:0,data:{image_url}}));
    expect(await send(upload)).toMatchObject({ok:false});
  }
});
it('拒绝非本站页面、子框架、未知图床及无效图片，且不访问认证信息',async()=>{
  for(const sender of [{id:'test-extension',url:'https://evil.test/',frameId:0},{id:'test-extension',url:'https://www.guozaoke.com/t/1',frameId:1},{id:'test-extension',url:'chrome-extension://test-extension/analysis-view.html',frameId:0}])expect(await send(upload,sender)).toMatchObject({ok:false});
  for(const patch of [{provider:'unknown'},{base64:'not base64'},{base64:''},{base64:btoa('not an image')},{mime:'image/jpeg'},{base64:'A'.repeat(14_000_000)}])expect(await send({...upload,...patch})).toMatchObject({ok:false});
  expect(api.cookie).not.toHaveBeenCalled();expect(api.fetch).not.toHaveBeenCalled();
});
it('保留已有Imgur上传方式，不携带B站会话',async()=>{
  local['gzk:imgur-client']='test-client';
  api.fetch.mockResolvedValueOnce(reply({success:true,data:{link:'https://i.imgur.com/a.png'}}));
  expect(await send({...upload,provider:'imgur'})).toEqual({ok:true,data:'https://i.imgur.com/a.png'});
  expect(api.fetch).toHaveBeenCalledWith('https://api.imgur.com/3/image',expect.objectContaining({credentials:'omit',headers:{Authorization:'Client-ID test-client'}}));
  expect(api.cookie).not.toHaveBeenCalled();
});
