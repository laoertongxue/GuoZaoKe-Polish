import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaults, type Settings } from '../src/shared/settings';
import type { AppState } from '../src/shared/store';

const api = vi.hoisted(() => ({
  getState: vi.fn(), saveSettings: vi.fn(), watchState: vi.fn(), markRead: vi.fn(),
}));
vi.mock('wxt/browser', () => ({ browser: { runtime: {
  getURL:(path:string)=>`chrome-extension://test${path}`,sendMessage: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
} } }));
vi.mock('../src/shared/store', () => api);
vi.mock('../src/site/parse', () => ({ parseTopic: () => ({ id: '1', title: '主题', url: 'https://www.guozaoke.com/t/1' }), parseTopics: () => [] }));
vi.mock('../src/features/members', () => ({ installMemberCards: vi.fn(() => ({ update: vi.fn(), destroy: vi.fn() })), paintTags: vi.fn(), editTags: vi.fn() }));
vi.mock('../src/features/replies', () => ({ enhanceReplies: () => ({ hot: vi.fn(), update: vi.fn(), destroy: vi.fn() }) }));
vi.mock('../src/features/reading', () => ({ previewTopic: vi.fn(), saveTopic: vi.fn(), showReading: vi.fn() }));
vi.mock('../src/features/editor', () => ({ enhanceEditors: vi.fn(), decodePage: vi.fn(), showDecode: vi.fn() }));
vi.mock('../src/features/share', () => ({ shareImage: vi.fn() }));
import { installTopicLayout, startPage } from '../src/features/page';
import { browser } from 'wxt/browser';
import { showReading } from '../src/features/reading';

let pendingFrame: FrameRequestCallback | undefined;
let resizeTools: (() => void) | undefined;
const disconnectTools = vi.fn();
const cleanup: (() => void)[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.className = '';
  delete document.documentElement.dataset.gzkMounted;
  delete document.documentElement.dataset.gzkTheme;
  document.body.innerHTML = '<div class="topic-detail"><div class="ui-content"><img alt="正文图片"></div></div><aside class="sidebar-right"></aside>';
  pendingFrame = undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pendingFrame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { pendingFrame = undefined; });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('innerWidth', 1600);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resizeTools = callback; }
    observe() {}
    disconnect = disconnectTools;
  });
});

it('关闭新标签选项或全局增强时，恢复原链接属性和个人页原生入口', async () => {
  document.body.insertAdjacentHTML('beforeend', '<div class="topic-item"><h3 class="title"><a id="original-link" href="https://www.guozaoke.com/t/1" target="_self" rel="nofollow noreferrer">原主题</a><a id="plain-link" href="https://www.guozaoke.com/t/2">无属性主题</a></h3></div><div class="profile"><div class="ui-header"><span class="username">demo</span><a id="native-follow" href="/follow">关注</a></div></div>');
  let state: AppState = { settings: { ...defaults, openInNewTab: true }, tags: {}, reading: [] };
  let changed = () => {};
  api.getState.mockImplementation(async () => structuredClone(state));
  api.watchState.mockImplementation(callback => { changed = callback; return () => {}; });
  const context = { onInvalidated: (stop: () => void) => cleanup.push(stop) };
  await startPage(context as unknown as Parameters<typeof startPage>[0]);
  const link = document.querySelector<HTMLAnchorElement>('#original-link')!;
  const plain = document.querySelector<HTMLAnchorElement>('#plain-link')!;
  const tagAction = document.querySelector<HTMLButtonElement>('.profile button')!;
  expect(link.target).toBe('_blank');
  expect([...link.relList]).toEqual(expect.arrayContaining(['nofollow', 'noreferrer', 'noopener']));
  state.settings.openInNewTab = false;
  changed();
  await vi.waitFor(() => expect(link.target).toBe('_self'));
  expect(link.getAttribute('rel')).toBe('nofollow noreferrer');
  expect(plain.hasAttribute('target')).toBe(false);
  expect(plain.hasAttribute('rel')).toBe(false);
  state.settings.openInNewTab = true;
  changed();
  await vi.waitFor(() => expect(link.target).toBe('_blank'));
  state.settings.enabled = false;
  changed();
  await vi.waitFor(() => expect(document.documentElement.hasAttribute('data-gzk-theme')).toBe(false));
  expect(link.target).toBe('_self');
  expect(link.getAttribute('rel')).toBe('nofollow noreferrer');
  expect(tagAction.hidden).toBe(true);
  expect(document.querySelector('#native-follow')!.getAttribute('href')).toBe('/follow');
  state.settings.enabled = true;
  changed();
  await vi.waitFor(() => expect(link.target).toBe('_blank'));
  expect(tagAction.hidden).toBe(false);
});
afterEach(() => {
  cleanup.splice(0).forEach(stop => stop());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('自动布局使用垂直正文高度，在图片加载后更新且不受横向布局尺寸反馈影响', () => {
  const html = document.documentElement;
  const content = document.querySelector<HTMLElement>('.ui-content')!;
  let verticalHeight = 600;
  vi.spyOn(content, 'getBoundingClientRect').mockImplementation(() => ({ height: html.classList.contains('gzk-horizontal') ? 400 : verticalHeight }) as DOMRect);
  const controller = installTopicLayout(html, content, () => ({ ...defaults, layout: 'auto' }));
  cleanup.push(controller.destroy);
  expect(html.classList.contains('gzk-horizontal')).toBe(true);
  controller.update();
  controller.update();
  expect(html.classList.contains('gzk-horizontal')).toBe(true);
  verticalHeight = 599;
  content.querySelector('img')!.dispatchEvent(new Event('load'));
  pendingFrame!(0);
  expect(html.classList.contains('gzk-horizontal')).toBe(false);
  verticalHeight = 720;
  content.querySelector('img')!.dispatchEvent(new Event('load'));
  pendingFrame!(0);
  expect(html.classList.contains('gzk-horizontal')).toBe(true);
});

it('手动布局覆盖正文高度，停用增强会恢复垂直并清理重测监听', () => {
  const html = document.documentElement;
  const content = document.querySelector<HTMLElement>('.ui-content')!;
  const measure = vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({ height: 800 } as DOMRect);
  let settings: Settings = { ...defaults, layout: 'vertical' };
  const controller = installTopicLayout(html, content, () => settings);
  expect(html.classList.contains('gzk-horizontal')).toBe(false);
  expect(measure).not.toHaveBeenCalled();
  settings = { ...settings, layout: 'horizontal' };
  controller.update();
  expect(html.classList.contains('gzk-horizontal')).toBe(true);
  settings = { ...settings, enabled: false };
  controller.update();
  expect(html.classList.contains('gzk-horizontal')).toBe(false);
  controller.destroy();
  pendingFrame = undefined;
  content.querySelector('img')!.dispatchEvent(new Event('load'));
  window.dispatchEvent(new Event('resize'));
  expect(pendingFrame).toBeUndefined();
});

it('侧栏入口根据当前布局切换文案并持久化用户选择', async () => {
  let state: AppState = { settings: { ...defaults, layout: 'vertical' }, tags: {}, reading: [] };
  api.getState.mockImplementation(async () => structuredClone(state));
  api.saveSettings.mockImplementation(async patch => { state = { ...state, settings: { ...state.settings, ...patch } }; return structuredClone(state); });
  api.watchState.mockReturnValue(() => {});
  const context = { onInvalidated: (stop: () => void) => { cleanup.push(stop); } };
  await startPage(context as unknown as Parameters<typeof startPage>[0]);
  const toggle = document.querySelector<HTMLButtonElement>('[data-gzk-layout]')!;
  expect(toggle.textContent).toContain('切换横向');
  toggle.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(api.saveSettings).toHaveBeenLastCalledWith({ layout: 'horizontal' });
  expect(toggle.textContent).toContain('切换纵向');
  expect(document.documentElement.classList.contains('gzk-horizontal')).toBe(true);
  vi.stubGlobal('innerWidth', 1200);
  window.dispatchEvent(new Event('resize'));
  pendingFrame!(0);
  expect(toggle.textContent).toContain('宽屏生效');
  expect(toggle.getAttribute('aria-label')).toContain('1400');
  expect(api.saveSettings).toHaveBeenCalledTimes(1);
  toggle.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(api.saveSettings).toHaveBeenLastCalledWith({ layout: 'vertical' });
  expect(toggle.textContent).toContain('切换横向');
});

it('页脚工具保留原站导航、搜索和备案节点，重复启动不重复插入', async () => {
  document.body.insertAdjacentHTML('afterbegin', '<nav class="top-navbar"><form class="J_search"><input value="原有搜索"></form><a href="/nodes">节点</a></nav>');
  document.body.insertAdjacentHTML('beforeend', '<div class="footer"><div class="container"><div class="footer-bg"><a href="https://beian.miit.gov.cn">原备案链接</a></div></div></div><aside><div class="footer"><div class="container">其他组件页脚</div></div></aside>');
  const form = document.querySelector<HTMLFormElement>('.J_search')!;
  const legalLink = document.querySelector('.footer-bg a');
  const submit = vi.fn((event: Event) => event.preventDefault());
  form.addEventListener('submit', submit);
  api.getState.mockResolvedValue({ settings: { ...defaults }, tags: {}, reading: [] });
  api.watchState.mockReturnValue(() => {});
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const context = { onInvalidated: (stop: () => void) => cleanup.push(stop) };
  await startPage(context as unknown as Parameters<typeof startPage>[0]);
  await startPage();
  expect(document.querySelector('.J_search')).toBe(form);
  expect(form.querySelector('input')!.value).toBe('原有搜索');
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(submit).toHaveBeenCalledOnce();
  expect(document.querySelector('.footer-bg a')).toBe(legalLink);
  expect(document.querySelector('nav a')!.getAttribute('href')).toBe('/nodes');
  expect(document.querySelectorAll('.gzk-site-footer')).toHaveLength(1);
  expect(document.querySelector('aside .gzk-site-footer')).toBeNull();
  const toolbox = document.querySelector('.gzk-toolbox')!;
  vi.spyOn(toolbox, 'getBoundingClientRect').mockReturnValue({ height: 146 } as DOMRect);
  resizeTools!();
  expect(document.documentElement.style.getPropertyValue('--gzk-tools-height')).toBe('146px');
  const actions = document.querySelectorAll<HTMLButtonElement>('.gzk-footer-tools button');
  expect([...actions].map(button => button.type)).toEqual(['button', 'button', 'button']);
  actions[0]!.click();
  await Promise.resolve();
  expect(showReading).toHaveBeenCalledOnce();
  actions[1]!.click();
  await Promise.resolve();
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'options:open' });
  actions[2]!.click();
  await Promise.resolve();
  expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  cleanup.splice(0).forEach(stop => stop());
  expect(disconnectTools).toHaveBeenCalledOnce();
  expect(document.documentElement.style.getPropertyValue('--gzk-tools-height')).toBe('');
});

it('启动已读取偏好时不再等待后台读取，直接完成初始页面适配', async()=>{
  api.getState.mockRejectedValue(new Error('不应再次启动后台读取'));
  api.watchState.mockReturnValue(()=>{});
  const state:AppState={settings:{...defaults},tags:{},reading:[]};
  const context={onInvalidated:(stop:()=>void)=>cleanup.push(stop)};
  await startPage(context as unknown as unknown as Parameters<typeof startPage>[0],state);
  expect(api.getState).not.toHaveBeenCalled();expect(document.documentElement.dataset.gzkTheme).toBe('light');expect(document.querySelectorAll('.gzk-toolbox')).toHaveLength(1);
});

it('扩展失效后撤销页面增强，可重新挂载且不覆盖原生草稿',async()=>{
  document.body.insertAdjacentHTML('beforeend','<form><textarea name="native-draft">保留草稿</textarea></form><div class="footer"><div class="container"></div></div>');
  const input=document.querySelector('textarea')!;input.setSelectionRange(1,3);
  const state:AppState={settings:{...defaults},tags:{},reading:[]};
  api.getState.mockResolvedValue(state);api.watchState.mockReturnValue(()=>{});
  let invalidate=()=>{};
  await startPage({onInvalidated:(fn:()=>void)=>{invalidate=fn;}} as unknown as Parameters<typeof startPage>[0],state);
  invalidate();
  expect(document.documentElement.dataset.gzkMounted).toBeUndefined();
  expect(document.documentElement.dataset.gzkTheme).toBeUndefined();
  expect(document.querySelectorAll('.gzk-toolbox,.gzk-site-footer')).toHaveLength(0);
  expect(document.querySelector('textarea')).toBe(input);expect(input.value).toBe('保留草稿');expect(input.selectionStart).toBe(1);
  await startPage({onInvalidated:(fn:()=>void)=>cleanup.push(fn)} as unknown as Parameters<typeof startPage>[0],state);
  expect(document.querySelectorAll('.gzk-toolbox')).toHaveLength(1);expect(document.querySelectorAll('.gzk-site-footer')).toHaveLength(1);
});
