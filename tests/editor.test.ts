import { beforeEach, expect, it, vi } from 'vitest';
import { enhanceEditors } from '../src/features/editor';
import { imageDialog } from '../src/features/upload';
vi.mock('../src/features/upload', () => ({ imageDialog: vi.fn() }));
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
  expect(imageDialog).not.toHaveBeenCalled();
});

function pasteImage(input: HTMLTextAreaElement) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: [new File(['x'], 'test.png', { type: 'image/png' })] } });
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
  expect(nativePaste).toHaveBeenCalledOnce(); expect(imageDialog).not.toHaveBeenCalled();
  const data = new FormData(form), event = new Event('formdata');
  Object.defineProperty(event, 'formData', { value: data }); form.dispatchEvent(event);
  expect(nativeFormData).toHaveBeenCalledOnce();
  expect(data.get('content')).toBe('原生草稿 [doge]'); expect(data.get('csrf')).toBe('keep');
});

it('卸载后可以重新挂载且一次粘贴只打开一次上传窗口', () => {
  const input = document.querySelector('textarea')!;
  const cleanup = enhanceEditors();
  expect(cleanup).toBeTypeOf('function');
  cleanup();
  const cleanupCurrent = enhanceEditors();
  const cleanupDuplicate = enhanceEditors();
  cleanup(); cleanupDuplicate();
  expect(input.dataset.gzkEditor).toBe('true');
  expect(document.querySelectorAll('.gzk-editor-toolbar')).toHaveLength(1);
  expect(document.querySelectorAll('.gzk-editor-preview')).toHaveLength(1);
  expect(pasteImage(input).defaultPrevented).toBe(true);
  expect(imageDialog).toHaveBeenCalledOnce();
  const insert = vi.mocked(imageDialog).mock.calls[0]![0];
  cleanupCurrent();
  insert('过期上传结果');
  expect(input.value).toBe('');
  expect(pasteImage(input).defaultPrevented).toBe(false);
  expect(imageDialog).toHaveBeenCalledOnce();
});
