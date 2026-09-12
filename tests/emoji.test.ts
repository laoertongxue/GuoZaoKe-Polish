import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enhanceEditors } from '../src/features/editor';
import { emojiSubmissionText } from '../src/features/emoji';

vi.mock('../src/features/upload', () => ({ imageDialog: vi.fn() }));

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const input = () => document.querySelector<HTMLTextAreaElement>('#inputor')!;
const form = () => input().form!;
const picker = () => document.querySelector('.gzk-overlay-host')?.shadowRoot;
const toolbarButton = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.gzk-editor-toolbar button')).find(button => button.textContent === label)!;
// jsdom does not yet emit formdata from its FormData constructor. Dispatch the
// same browser event with the native entry list; no request or submit is made.
const payload = (data = new FormData(form())) => {
  const event = new Event('formdata');
  Object.defineProperty(event, 'formData', { value: data });
  form().dispatchEvent(event);
  return data;
};

beforeEach(() => {
  document.documentElement.classList.remove('gzk-disabled');
  document.body.innerHTML = '<form action="/reply/create" method="post"><input name="_xsrf" value="csrf-keep"><input name="topic_id" value="123"><textarea id="inputor" class="J_replyContent" name="content"></textarea><button type="submit">原站回复</button></form>';
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
  enhanceEditors();
});

describe('图片表情选择器', () => {
  it('取消选择器时恢复原先反向选区', async () => {
    input().value='前选中后';input().setSelectionRange(1,3,'backward');
    toolbarButton('☺ 表情').click();await settle();
    picker()!.querySelector('dialog')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    expect([input().selectionStart,input().selectionEnd,input().selectionDirection]).toEqual([1,3,'backward']);
  });
  it('模态弹层期间浏览器重置 textarea 光标后仍连续插在原选区，并恢复最终光标', async () => {
    input().value='前选中后';input().setSelectionRange(1,3);
    // Reproduced in Chrome: setRangeText on the inert background textarea
    // updates its value but selectionStart/End return to zero after input.
    input().addEventListener('input',()=>input().setSelectionRange(0,0));
    toolbarButton('☺ 表情').click();await settle();
    const doge=picker()!.querySelector<HTMLButtonElement>('button[aria-label="[doge]"]')!;
    doge.click();await settle();doge.click();await settle();
    expect(input().value).toBe('前[doge][doge]后');
    picker()!.querySelector('dialog')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    expect(input().selectionStart).toBe('前[doge][doge]'.length);
    expect(input().selectionEnd).toBe(input().selectionStart);
  });
  it('提供全部分组和31个高清图片表情，连续选择保留光标和代码', async () => {
    input().value = '前后'; input().setSelectionRange(1, 1);
    const draft = vi.fn(); input().addEventListener('input', () => draft(input().value));
    toolbarButton('☺ 表情').click(); await settle();
    expect(Array.from(picker()!.querySelectorAll('h3')).map(node => node.textContent)).toEqual(['流行', '小黄脸', '手势', '庆祝', '其他', '颜文字']);
    expect(picker()!.querySelectorAll('img')).toHaveLength(31);
    const doge = picker()!.querySelector<HTMLButtonElement>('button[aria-label="[doge]"]')!;
    expect(doge.querySelector('img')?.src).toBe('https://i.imgur.com/HZL0hOa.png');
    expect(doge.querySelector('img')?.referrerPolicy).toBe('no-referrer');
    doge.click(); await settle(); doge.click(); await settle();
    expect(input().value).toBe('前[doge][doge]后');
    expect(draft).toHaveBeenLastCalledWith('前[doge][doge]后');
    expect(picker()!.querySelector('dialog')?.open).toBe(true);
    picker()!.querySelector('dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(picker()).toBeUndefined();
    expect(document.activeElement).toBe(input());
  });

  it('图片加载失败仍可见代码并可点击，键盘可移动和关闭', async () => {
    toolbarButton('☺ 表情').click(); await settle();
    const doge = picker()!.querySelector<HTMLButtonElement>('button[aria-label="[doge]"]')!;
    doge.querySelector('img')!.dispatchEvent(new Event('error'));
    expect(doge.textContent).toContain('[doge]');
    expect(doge.querySelector('img')).toBeNull();
    doge.focus(); doge.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(picker()!.activeElement).not.toBe(doge);
    doge.click(); await settle(); expect(input().value).toBe('[doge]');
    picker()!.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.click(); await settle();
    expect(picker()).toBeUndefined();
  });
});

describe('真实表单边界', () => {
  it('只在formdata转换低清链接并保留CSRF、其他字段、代码草稿及提交行为', () => {
    input().value = '你好[doge][哇R]';
    const draft = vi.fn(); input().addEventListener('input', draft);
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    form().dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(false);
    expect(input().value).toBe('你好[doge][哇R]');
    const data = payload();
    expect(Array.from(data)).toEqual([['_xsrf', 'csrf-keep'], ['topic_id', '123'], ['content', '你好https://i.imgur.com/agAJ0Rd.png https://i.imgur.com/OZySWIG.png ']]);
    expect(input().value).toBe('你好[doge][哇R]'); expect(draft).not.toHaveBeenCalled();
  });

  it('普通Markdown、未知代码、原有URL和代码示例保持不变', () => {
    const unchanged = '[标题](https://example.com) [doge](https://example.com) [未知表情] `[doge]` https://i.imgur.com/agAJ0Rd.png';
    input().value = `${unchanged} [doge]`;
    expect(payload().get('content')).toBe(`${unchanged} https://i.imgur.com/agAJ0Rd.png `);
  });

  it.each([
    ['*[doge]*', '*https://i.imgur.com/agAJ0Rd.png*', 'em'],
    ['**[doge]**', '**https://i.imgur.com/agAJ0Rd.png**', 'strong'],
    ['~~[doge]~~', '~~https://i.imgur.com/agAJ0Rd.png~~', 'del'],
    ['_[doge]_', '_https://i.imgur.com/agAJ0Rd.png_', 'em'],
    ['__[doge]__', '__https://i.imgur.com/agAJ0Rd.png__', 'strong'],
    ['***[doge]***', '***https://i.imgur.com/agAJ0Rd.png***', 'em strong'],
    ['**[doge][doge]**', '**https://i.imgur.com/agAJ0Rd.png https://i.imgur.com/agAJ0Rd.png**', 'strong'],
  ])('表单转换%s保留强调语义，预览与提交格式一致', async (source, expected, selector) => {
    input().value = source;
    toolbarButton('预览').click(); await settle();
    expect(document.querySelector(`.gzk-editor-preview ${selector} img`)).not.toBeNull();
    const submitted = payload().get('content');
    expect(submitted).toBe(expected);
    expect(input().value).toBe(source);
    input().value = String(submitted); input().dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector(`.gzk-editor-preview ${selector} img`)).not.toBeNull();
  });

  it('保留原始换行与Markdown结构，在列表、引用和表格里转换正文代码', () => {
    const original = '# 标题\r\n\r\n- [doge]\r\n\r\n> [doge]\n\n| 内容 |\n| --- |\n| [doge] |\n\n```\n[doge]\n```';
    const url = 'https://i.imgur.com/agAJ0Rd.png ';
    expect(emojiSubmissionText(original)).toBe(`# 标题\r\n\r\n- ${url}\r\n\r\n> ${url}\n\n| 内容 |\n| --- |\n| ${url} |\n\n\`\`\`\n[doge]\n\`\`\``);
  });

  it('多行引用与列表保持前缀，嵌套代码块仍保留表情代码', () => {
    const original = '> [doge]\n> [doge]\n\n- [doge]\n  [doge]\n\n> ```\n> [doge]\n> ```';
    const url = 'https://i.imgur.com/agAJ0Rd.png ';
    expect(emojiSubmissionText(original)).toBe(`> ${url}\n> ${url}\n\n- ${url}\n  ${url}\n\n> \`\`\`\n> [doge]\n> \`\`\``);
  });

  it('停用插件后不改提交字段且无法再插入表情', async () => {
    toolbarButton('☺ 表情').click(); await settle();
    input().value = '[doge]'; document.documentElement.classList.add('gzk-disabled');
    expect(payload().get('content')).toBe('[doge]');
    picker()!.querySelector<HTMLButtonElement>('button[aria-label="[doge]"]')!.click(); await settle();
    expect(input().value).toBe('[doge]');
  });

  it('不创建缺失字段，不覆盖同名字段，不转换禁用输入或其他表单', () => {
    input().value = '[doge]';
    input().removeAttribute('name'); expect(Array.from(payload())).toEqual([['_xsrf', 'csrf-keep'], ['topic_id', '123']]);
    input().name = 'content'; input().disabled = true; expect(payload().has('content')).toBe(false);
    input().disabled = false;
    const duplicate = document.createElement('input'); duplicate.name = 'content'; duplicate.value = 'other'; form().append(duplicate);
    expect(payload().getAll('content')).toEqual(['[doge]', 'other']); duplicate.remove();
    const data = new FormData(); data.append('content', 'unrelated [doge]');
    expect(payload(data).get('content')).toBe('unrelated [doge]');
  });

  it('无name输入框不借用同表单中同值的隐藏content字段', () => {
    input().value = '[doge]'; input().removeAttribute('name');
    const hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.name = 'content'; hidden.value = '[doge]'; form().append(hidden);
    expect(Array.from(payload())).toEqual([['_xsrf', 'csrf-keep'], ['topic_id', '123'], ['content', '[doge]']]);
    expect(input().value).toBe('[doge]'); expect(hidden.value).toBe('[doge]');
  });
});

describe('编辑器预览', () => {
  it('图片代码、原站表情和粘贴图片URL可见且不改草稿，失败显示原文', async () => {
    input().value = '[doge] :joy: https://example.com/photo.png?x=1';
    toolbarButton('预览').click(); await settle();
    const preview = document.querySelector('.gzk-editor-preview')!;
    const images = Array.from(preview.querySelectorAll('img'));
    expect(images.map(img => img.src)).toEqual(['https://i.imgur.com/HZL0hOa.png', 'https://static.guozaoke.com//static/emoji/joy.png', 'https://example.com/photo.png?x=1']);
    expect(images.every(img => img.referrerPolicy === 'no-referrer')).toBe(true);
    expect(input().value).toBe('[doge] :joy: https://example.com/photo.png?x=1');
    images[0]!.dispatchEvent(new Event('error')); expect(preview.textContent).toContain('[doge]');
  });

  it('预览保留Markdown链接和代码、去掉活动HTML和危险URL', async () => {
    input().value = '`[doge] :joy:` [doge](https://example.com) <img src="javascript:alert(1)" onerror="alert(1)"><script>alert(1)</script> ![图](https://example.com/a.jpg)';
    toolbarButton('预览').click(); await settle();
    const preview = document.querySelector('.gzk-editor-preview')!;
    expect(preview.querySelector('code')?.textContent).toBe('[doge] :joy:');
    expect(preview.querySelector('a')?.textContent).toBe('doge');
    expect(preview.querySelectorAll('img')).toHaveLength(1);
    expect(preview.querySelector('script,[onerror],[src^="javascript:"]')).toBeNull();
  });

  it('预览不把转义后的方括号或冒号转成表情', async () => {
    input().value = '\\[doge] \\:joy: [doge]';
    toolbarButton('预览').click(); await settle();
    const preview = document.querySelector('.gzk-editor-preview')!;
    expect(preview.querySelectorAll('img')).toHaveLength(1);
    expect(preview.textContent).toContain('[doge] :joy:');
  });
});
