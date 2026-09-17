import { beforeEach, expect, it, vi } from 'vitest';
import { imageDialog } from '../src/features/upload';
const api = vi.hoisted(() => ({ get: vi.fn(), send: vi.fn() }));
// Content scripts have storage/runtime, but no chrome.permissions API.
vi.mock('wxt/browser', () => ({ browser: { storage: { local: { get: api.get } }, runtime: { sendMessage: api.send } } }));
beforeEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  HTMLDialogElement.prototype.close = function() { this.open = false; this.dispatchEvent(new Event('close')); };
  api.get.mockResolvedValue({ 'gzk:imgur-client': 'test-only' });
});
const uploadButton = () => [...document.querySelector('.gzk-overlay-host')!.shadowRoot!.querySelectorAll('button')].find(button => button.textContent === '上传到 Imgur 并插入')!;
it('内容脚本将上传交给后台检查权限并只插入成功链接', async () => {
  api.send.mockResolvedValue({ ok: true, data: 'https://i.imgur.com/test.png' });
  const insert = vi.fn();
  await imageDialog(insert, [new File(['test-image'], 'test.png', { type: 'image/png' })]);
  uploadButton().click();
  await vi.waitFor(() => expect(api.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'image:upload', mime: 'image/png' })));
  expect(insert).toHaveBeenCalledWith('\nhttps://i.imgur.com/test.png\n');
});
it('后台拒绝授权时保留待上传文件且不改变草稿', async () => {
  api.send.mockResolvedValue({ ok: false, error: '请先在控制选项中授权 Imgur' });
  const insert = vi.fn();
  await imageDialog(insert, [new File(['test-image'], 'test.png', { type: 'image/png' })]);
  uploadButton().click();
  await vi.waitFor(() => expect(document.querySelector('.gzk-overlay-host')!.shadowRoot!.textContent).toContain('请先在控制选项中授权 Imgur'));
  expect(insert).not.toHaveBeenCalled();
  expect(uploadButton().disabled).toBe(false);
});
const root=()=>document.querySelector('.gzk-overlay-host')!.shadowRoot!;
const biliUpload=()=>[...root().querySelectorAll('button')].find(b=>b.textContent==='上传到 B 站并插入')!;
it('新用户默认B站，打开对话框不自动上传，也不要求填写凭证',async()=>{
  api.get.mockResolvedValue({});
  await imageDialog(vi.fn(),[new File(['test'],'test.png',{type:'image/png'})]);
  expect(root().querySelector<HTMLSelectElement>('#gzk-image-provider')?.value).toBe('bilibili');
  expect(biliUpload()).toBeDefined();
  expect(api.send).not.toHaveBeenCalled();
  expect(root().querySelector('input[type=password]')).toBeNull();
});
it('B站失败后不改用其他图床，成功的图片不重复上传，保留失败图片',async()=>{
  api.get.mockResolvedValue({});
  api.send.mockResolvedValueOnce({ok:true,data:'https://i0.hdslb.com/bfs/new_dyn/one.png'}).mockResolvedValueOnce({ok:false,error:'请重新登录 B 站'}).mockResolvedValueOnce({ok:true,data:'https://i0.hdslb.com/bfs/new_dyn/two.png'});
  const insert=vi.fn();
  await imageDialog(insert,[new File(['one'],'one.png',{type:'image/png'}),new File(['two'],'two.png',{type:'image/png'})]);
  biliUpload().click();
  await vi.waitFor(()=>expect(root().textContent).toContain('请重新登录 B 站'));
  expect(insert).toHaveBeenCalledTimes(1);expect(root().textContent).toContain('two.png');
  expect(root().querySelector<HTMLSelectElement>('#gzk-image-provider')?.disabled).toBe(false);
  biliUpload().click();
  await vi.waitFor(()=>expect(insert).toHaveBeenCalledTimes(2));
  expect(api.send).toHaveBeenCalledTimes(3);
  expect(api.send.mock.calls.every(([message])=>message.provider==='bilibili')).toBe(true);
});
it('失败后可以明确切换至已有Imgur配置再上传',async()=>{
  api.get.mockResolvedValue({'gzk:image-provider':'bilibili','gzk:imgur-client':'test-only'});
  api.send.mockResolvedValue({ok:true,data:'https://i.imgur.com/test.png'});
  await imageDialog(vi.fn(),[new File(['test'],'test.png',{type:'image/png'})]);
  const provider=root().querySelector<HTMLSelectElement>('#gzk-image-provider')!;
  expect(provider.value).toBe('bilibili');
  provider.value='imgur';provider.dispatchEvent(new Event('change'));
  uploadButton().click();
  await vi.waitFor(()=>expect(api.send).toHaveBeenCalledWith(expect.objectContaining({provider:'imgur'})));
});
it.each([true,false])('上传中关闭不会丢队列或失败提示（请求成功=%s）',async(success)=>{
  let finish!:(value:unknown)=>void;
  api.send.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}))
    .mockResolvedValue({ok:true,data:'https://i.imgur.com/two.png'});
  const insert=vi.fn();
  await imageDialog(insert,[new File(['one'],'one.png',{type:'image/png'}),new File(['two'],'two.png',{type:'image/png'})]);
  const shadow=root(),dialog=shadow.querySelector('dialog')!;
  uploadButton().click();
  await vi.waitFor(()=>expect(api.send).toHaveBeenCalledTimes(1));
  shadow.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.click();
  await Promise.resolve();await Promise.resolve();
  expect(dialog.isConnected).toBe(true);
  dialog.dispatchEvent(new Event('cancel',{cancelable:true}));
  expect(dialog.open).toBe(true);
  expect([...shadow.querySelectorAll('button')].find(b=>b.textContent==='插入链接')?.disabled).toBe(true);
  finish(success?{ok:true,data:'https://i.imgur.com/one.png'}:{ok:false,error:'上传暂时失败，请重试'});
  if(success){
    await vi.waitFor(()=>expect(insert).toHaveBeenCalledTimes(2));
    expect(api.send).toHaveBeenCalledTimes(2);
    expect(dialog.isConnected).toBe(false);
  }else{
    await vi.waitFor(()=>expect(shadow.textContent).toContain('上传暂时失败，请重试'));
    expect(insert).not.toHaveBeenCalled();
    expect(shadow.textContent).toContain('one.png');expect(shadow.textContent).toContain('two.png');
    expect(uploadButton().disabled).toBe(false);
    uploadButton().click();
    await vi.waitFor(()=>expect(insert).toHaveBeenCalledTimes(2));
    expect(api.send).toHaveBeenCalledTimes(3);
  }
});
