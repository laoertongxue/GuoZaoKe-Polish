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

it('工具栏仍可手动打开图片上传窗口', async () => {
  const input = document.querySelector('textarea')!;
  const cleanup = enhanceEditors();
  const toolbarButtons = [...document.querySelectorAll<HTMLButtonElement>('.gzk-editor-toolbar button')];
  expect(toolbarButtons.map(b => b.textContent)).toContain('上传图片');
  const uploadButton = toolbarButtons.find(button => button.textContent === '上传图片')!;
  uploadButton.click();
  await vi.waitFor(()=>expect(imageDialog).toHaveBeenCalledOnce());
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

it('原站图片组件存在时粘贴和拖放只交给原站，保留手动插件图床', () => {
  const loader=document.createElement('script');loader.src='/static/js/image-host-loader-20261102.js?v=1';document.body.append(loader);
  const input=document.querySelector('textarea')!;
  const nativePaste=vi.fn(),nativeDrop=vi.fn();
  document.addEventListener('paste',nativePaste);document.addEventListener('drop',nativeDrop);
  const cleanup=enhanceEditors();
  expect(pasteImage(input).defaultPrevented).toBe(false);
  expect(dropImage(input).defaultPrevented).toBe(false);
  expect(autoUploadImage).not.toHaveBeenCalled();
  expect(nativePaste).toHaveBeenCalledOnce();expect(nativeDrop).toHaveBeenCalledOnce();
  expect(document.querySelector('.gzk-editor-toolbar')!.textContent).toContain('插件图床');
  cleanup();document.removeEventListener('paste',nativePaste);document.removeEventListener('drop',nativeDrop);
});

it('原站实时预览编辑器保留原预览和播放器，不增加第二个预览', () => {
  const input=document.querySelector('textarea')!;input.id='contentArea';
  input.insertAdjacentHTML('afterend','<div id="previewDiv"><iframe title="原站视频"></iframe></div>');
  const preview=document.getElementById('previewDiv')!;
  const cleanup=enhanceEditors();
  expect(document.querySelector('.gzk-editor-preview')).toBeNull();
  expect([...document.querySelectorAll('.gzk-editor-toolbar button')].some(x=>x.textContent==='预览')).toBe(false);
  expect(document.getElementById('previewDiv')).toBe(preview);
  cleanup();expect(preview.querySelector('iframe')).not.toBeNull();
});
