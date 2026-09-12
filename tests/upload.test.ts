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
