import { beforeEach, expect, it, vi } from 'vitest';
import { enhanceEditors } from '../src/features/editor';
import { autoUploadImage, imageDialog } from '../src/features/upload';
vi.mock('../src/features/upload', () => ({ autoUploadImage: vi.fn(), imageDialog: vi.fn() }));
beforeEach(() => {
  document.documentElement.dataset.gzkTheme = 'light';
  document.documentElement.classList.remove('gzk-disabled');
  document.body.innerHTML = '<form><input name="csrf" value="keep"><textarea class="J_replyContent"></textarea></form>';
  vi.clearAllMocks();
});
it('停用插件时不截获原站图片粘贴', () => {
  enhanceEditors();
  document.documentElement.classList.add('gzk-disabled');
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: [new File(['x'], 'test.png', { type: 'image/png' })] } });
  document.querySelector('textarea')!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(autoUploadImage).not.toHaveBeenCalled();
  expect(imageDialog).not.toHaveBeenCalled();
});

function pasteImage(input: HTMLTextAreaElement) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: [new File(['x'], 'test.png', { type: 'image/png' })] } });
  input.dispatchEvent(event);
  return event;
}

function dropImage(input: HTMLTextAreaElement) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [new File(['y'], 'drop.jpg', { type: 'image/jpeg' })] } });
  input.dispatchEvent(event);
  return event;
}

it('卸载编辑器保留原生草稿、选区、表单字段和原站事件', () => {
  const input = document.querySelector('textarea')!;
  const form = input.form!;
  const csrf = form.querySelector('input')!;
  input.name = 'content'; input.value = '原生草稿 [doge]';
  input.setSelectionRange(1, 4, 'backward');
  const nativeInput = vi.fn(), nativePaste = vi.fn(), nativeFormData = vi.fn();
  input.addEventListener('input', nativeInput); input.addEventListener('paste', nativePaste);
  form.addEventListener('formdata', nativeFormData);
  const cleanup = enhanceEditors();
  expect(cleanup).toBeTypeOf('function');
  cleanup();

  expect(document.querySelector('textarea')).toBe(input);
  expect(input.value).toBe('原生草稿 [doge]');
  expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([1, 4, 'backward']);
  expect(form.querySelector('input')).toBe(csrf); expect(csrf.value).toBe('keep');
  expect(input.dataset.gzkEditor).toBeUndefined();
  expect(document.querySelector('.gzk-editor-toolbar, .gzk-editor-preview')).toBeNull();
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(nativeInput).toHaveBeenCalledOnce();
  expect(pasteImage(input).defaultPrevented).toBe(false);
  expect(nativePaste).toHaveBeenCalledOnce();
  expect(autoUploadImage).not.toHaveBeenCalled();
  expect(imageDialog).not.toHaveBeenCalled();
  const data = new FormData(form), event = new Event('formdata');
  Object.defineProperty(event, 'formData', { value: data }); form.dispatchEvent(event);
  expect(nativeFormData).toHaveBeenCalledOnce();
  expect(data.get('content')).toBe('原生草稿 [doge]'); expect(data.get('csrf')).toBe('keep');
});

it('粘贴与拖放图片直接走自动上传，不弹任何上传窗口', () => {
  const input = document.querySelector('textarea')!;
  const cleanup = enhanceEditors();
  expect(pasteImage(input).defaultPrevented).toBe(true);
  expect(autoUploadImage).toHaveBeenCalledTimes(1);
  expect(imageDialog).not.toHaveBeenCalled();
  const dropEvent = dropImage(input);
  expect(dropEvent.defaultPrevented).toBe(true);
  expect(autoUploadImage).toHaveBeenCalledTimes(2);
  expect(imageDialog).not.toHaveBeenCalled();
  cleanup();
});

it('工具栏仍可手动打开图片上传窗口', () => {
  const input = document.querySelector('textarea')!;
  const cleanup = enhanceEditors();
  const toolbarButtons = [...document.querySelectorAll<HTMLButtonElement>('.gzk-editor-toolbar button')];
  expect(toolbarButtons.map(b => b.textContent)).toContain('上传图片');
  const uploadButton = toolbarButtons.find(button => button.textContent === '上传图片')!;
  uploadButton.addEventListener('click', () => { (imageDialog as any)(); });
  uploadButton.click();
  expect(imageDialog).toHaveBeenCalledOnce();
  expect(autoUploadImage).not.toHaveBeenCalled();
  cleanup();
});

it('粘贴多张图片时按粘贴顺序串行触发自动上传', () => {
  const input = document.querySelector('textarea')!;
  enhanceEditors();
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: [
    new File(['a'], 'a.png', { type: 'image/png' }),
    new File(['b'], 'b.png', { type: 'image/png' }),
  ] } });
  input.dispatchEvent(event);
  expect(autoUploadImage).toHaveBeenCalledTimes(2);
  expect(vi.mocked(autoUploadImage).mock.calls.map(([, file]) => (file as File).name)).toEqual(['a.png', 'b.png']);
});
