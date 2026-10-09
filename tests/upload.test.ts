import { beforeEach, expect, it, vi } from 'vitest';
import { autoUploadImage, imageDialog } from '../src/features/upload';
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

function makeInput(): HTMLTextAreaElement {
  const input = document.createElement('textarea');
  document.body.appendChild(input);
  return input;
}
const shadowText = () => document.querySelector('.gzk-overlay-host')!.shadowRoot!.textContent || '';

it('autoUploadImage 在 textarea 中插入占位文本，成功后替换为图床链接', async () => {
  api.send.mockResolvedValue({ ok: true, data: 'https://i.imgur.com/auto.png' });
  const input = makeInput();
  const pending = autoUploadImage(input, new File(['x'], 'auto.png', { type: 'image/png' }));
  await vi.waitFor(() => expect(input.value).toContain('[图片上传中：auto.png…]'));
  await pending;
  expect(api.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'image:upload', provider: 'imgur', mime: 'image/png' }));
  expect(input.value).toBe('\nhttps://i.imgur.com/auto.png\n');
  expect(input.value).not.toContain('图片上传中');
});

it('autoUploadImage 上传失败时移除占位文本并 toast 错误', async () => {
  api.send.mockResolvedValue({ ok: false, error: '网络异常' });
  const input = makeInput();
  await autoUploadImage(input, new File(['x'], 'fail.png', { type: 'image/png' }));
  await vi.waitFor(() => expect(shadowText()).toContain('网络异常'));
  expect(input.value).toBe('');
  expect(input.value).not.toContain('图片上传中');
});

it('autoUploadImage 拒绝超过 10 MB 或非图片类型，且不发送请求', async () => {
  const big = new File([''], 'big.png', { type: 'image/png' });
  Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1, configurable: true });
  const input = makeInput();
  await autoUploadImage(input, big);
  expect(api.send).not.toHaveBeenCalled();
  expect(shadowText()).toContain('每张图片限 PNG/JPG/GIF/WebP');
  const input2 = makeInput();
  await autoUploadImage(input2, new File(['x'], 'doc.pdf', { type: 'application/pdf' }));
  expect(api.send).not.toHaveBeenCalled();
  expect(input2.value).toBe('');
});

it('autoUploadImage 保留用户已配置的图床偏好（哔哩哔哩）', async () => {
  api.get.mockResolvedValue({ 'gzk:image-provider': 'bilibili' });
  api.send.mockResolvedValue({ ok: true, data: 'https://i0.hdslb.com/bfs/upload.png' });
  const input = makeInput();
  await autoUploadImage(input, new File(['x'], 'auto.png', { type: 'image/png' }));
  await vi.waitFor(() => expect(input.value).toContain('https://i0.hdslb.com/bfs/upload.png'));
  expect(api.send).toHaveBeenCalledWith(expect.objectContaining({ provider: 'bilibili' }));
});

it('autoUploadImage 占位被用户删除后仍把链接追加到当前位置', async () => {
  api.send.mockResolvedValue({ ok: true, data: 'https://i.imgur.com/auto.png' });
  const input = makeInput();
  const pending = autoUploadImage(input, new File(['x'], 'auto.png', { type: 'image/png' }));
  await vi.waitFor(() => expect(input.value).toContain('[图片上传中：auto.png…]'));
  input.value = ''; // user removed the placeholder before upload finished
  await pending;
  expect(input.value).toBe('\nhttps://i.imgur.com/auto.png\n');
});

it('autoUploadImage 保留插入位置与选区方向，丢失只在原占位替换时变更', async () => {
  api.send.mockResolvedValue({ ok: true, data: 'https://i.imgur.com/auto.png' });
  const input = makeInput(); input.value = 'hello '; input.setSelectionRange(6, 6, 'forward');
  const pending = autoUploadImage(input, new File(['x'], 'auto.png', { type: 'image/png' }));
  await vi.waitFor(() => expect(input.value).toContain('[图片上传中'));
  input.setSelectionRange(0, 0, 'backward');
  await pending;
  expect(input.value).toBe('hello \nhttps://i.imgur.com/auto.png\n');
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
