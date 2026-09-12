import { browser } from 'wxt/browser';
import '../../src/styles/app.css';
import { fetchAccount, fetchNotices, fetchTopics } from '../../src/site/client';
import { ORIGIN } from '../../src/site/urls';
import { addReading, getState, markRead, removeReading, watchState, type AppState } from '../../src/shared/store';
import type { Notice, ReadingItem, Topic } from '../../src/shared/types';
import { applyTheme, button, el, emptyState, errorMessage, icon, iconButton, link, watchSystemTheme } from '../../src/shared/app-ui';

type Tab = 'reading' | 'hot' | 'latest' | 'message';
const root = document.querySelector<HTMLElement>('#app')!;
root.className = 'popup-page';
let state: AppState | undefined;
let stateError: unknown;
let activeTab: Tab = 'reading';
let requestId = 0;
const cachedTopics = new Map<'hot' | 'latest', Topic[]>();
let cachedNotices: Notice[] | undefined;
const body = el('section', 'popup-body');
body.id = 'popup-panel';
body.setAttribute('role', 'tabpanel');
body.tabIndex = 0;
const feedback = el('div', 'status');
feedback.setAttribute('role', 'status');
const tabs = new Map<Tab, HTMLButtonElement>();
const accountNode = el('div');

function report(message: string, error = false): void {
  feedback.textContent = message;
  feedback.classList.toggle('error', error);
  feedback.classList.toggle('success', !error && Boolean(message));
}

async function openOptions(): Promise<void> {
  try { await browser.runtime.openOptionsPage(); }
  catch (error) { report(`无法打开设置：${errorMessage(error)}`, true); }
}

function makeHeader(): HTMLElement {
  const header = el('header', 'popup-header');
  const tabList = el('div', 'popup-tabs');
  tabList.setAttribute('role', 'tablist');
  tabList.setAttribute('aria-label', '主题和消息');
  const items: { key: Tab; label: string }[] = [
    { key: 'reading', label: '稍后阅读' }, { key: 'hot', label: '最热' },
    { key: 'latest', label: '最新' }, { key: 'message', label: '消息' },
  ];
  for (const item of items) {
    const tab = button(item.label, 'popup-tab', () => { activate(item.key); });
    tab.id = `tab-${item.key}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', body.id);
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = items.findIndex(other => other.key === item.key);
      const targetIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
      const target = items[targetIndex]!;
      activate(target.key);
      tabs.get(target.key)?.focus();
    });
    tabs.set(item.key, tab);
    tabList.append(tab);
  }
  const tools = el('div', 'popup-tools');
  const menu = el('div', 'popup-menu');
  menu.id = 'popup-more-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '更多操作');
  function closeMenu(returnFocus = false): void {
    menu.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    if (returnFocus) more.focus();
  }
  const more = iconButton('更多操作', 'more', () => {
    menu.hidden = !menu.hidden;
    more.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  });
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-controls', menu.id);
  const website = link('', ORIGIN);
  website.append(icon('external'), el('span', '', '打开过早客'));
  website.setAttribute('role', 'menuitem');
  const refresh = button('', '', () => { closeMenu(); void renderActive(true); void loadAccount(); });
  refresh.append(icon('refresh'), el('span', '', '刷新当前列表'));
  refresh.setAttribute('role', 'menuitem');
  const options = button('', '', () => { closeMenu(); void openOptions(); });
  options.append(icon('sliders'), el('span', '', '控制选项与数据备份'));
  options.setAttribute('role', 'menuitem');
  menu.append(website, refresh, options, el('p', '', '每日自动签到：过早客尚未确认独立的签到奖励入口，当前暂不可用。'));
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return; }
    if (event.key === 'Tab') { closeMenu(); return; }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const links = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const index = links.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
    links[next]?.focus();
  });
  document.addEventListener('click', event => {
    if (!menu.contains(event.target as Node) && !more.contains(event.target as Node)) closeMenu();
  });
  tools.append(more, iconButton('打开控制选项', 'settings', () => { void openOptions(); }));
  header.append(tabList, tools, menu);
  return header;
}

function activate(tab: Tab): void {
  activeTab = tab;
  for (const [key, item] of tabs) {
    item.setAttribute('aria-selected', String(key === tab));
    item.tabIndex = key === tab ? 0 : -1;
  }
  body.setAttribute('aria-labelledby', `tab-${tab}`);
  body.scrollTop = 0;
  report('');
  void renderActive();
}

function loading(message: string): void {
  const placeholder = emptyState(message, '正在从过早客读取，请稍候。');
  const dot = el('span', 'loading-dot');
  placeholder.querySelector('h3')?.prepend(dot);
  placeholder.setAttribute('role', 'status');
  body.setAttribute('aria-busy', 'true');
  body.replaceChildren(placeholder);
}

function failure(title: string, error: unknown): void {
  body.setAttribute('aria-busy', 'false');
  const message = errorMessage(error);
  const box = emptyState(title, message, 'info');
  box.append(button('重试', 'button small', () => { void renderActive(true); }));
  if (message.includes('请先登录')) box.append(link('登录过早客', `${ORIGIN}/login`, 'button primary small'));
  body.replaceChildren(box);
}

function toolbar(text: string): HTMLElement {
  const row = el('div', 'list-toolbar');
  row.append(el('span', '', text), iconButton('刷新列表', 'refresh', () => { void renderActive(true); }));
  return row;
}

function avatar(topic: Topic): HTMLElement {
  if (topic.avatar) {
    try {
      const url = new URL(topic.avatar, ORIGIN);
      if (url.protocol === 'https:') {
        const img = el('img', 'topic-avatar');
        img.src = url.href;
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.addEventListener('error', () => { img.replaceWith(avatar({ ...topic, avatar: '' })); }, { once: true });
        return img;
      }
    } catch { /* Fall back to a text avatar. */ }
  }
  const placeholder = el('div', 'topic-avatar topic-avatar-placeholder', topic.author.slice(0, 1).toLocaleUpperCase() || 'G');
  placeholder.setAttribute('aria-hidden', 'true');
  return placeholder;
}

async function openReading(item: ReadingItem): Promise<void> {
  try {
    const url = new URL(item.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('主题链接无效');
    // Commit read status before opening a tab, which can close the popup.
    state = await markRead(item.id, true);
    await browser.tabs.create({ url: url.href });
  } catch (error) { report(`打开失败：${errorMessage(error)}`, true); }
}

function topicRow(topic: Topic, reading?: ReadingItem): HTMLLIElement {
  const row = el('li', `topic-row${reading?.read ? ' is-read' : ''}`);
  const main = el('div', 'topic-main');
  const title = link(topic.title, topic.url, 'topic-title');
  if (reading) title.addEventListener('click', event => { event.preventDefault(); void openReading(reading); });
  const metadata = el('div', 'topic-meta');
  metadata.append(el('span', '', topic.author || '未知作者'));
  if (topic.node) metadata.append(el('span', 'node-name', topic.node));
  if (topic.time) metadata.append(el('span', '', topic.time));
  const count = el('span', 'reply-count', String(topic.replies));
  count.title = `${topic.replies} 条回复`;
  count.setAttribute('aria-label', `${topic.replies} 条回复`);
  metadata.append(count);
  main.append(title, metadata);
  const actions = el('div', 'topic-actions');
  if (reading) {
    const mark = button(reading.read ? '已读' : '标为已读', 'button text-button', async () => {
      mark.disabled = true;
      try {
        state = await markRead(reading.id, !reading.read);
        if (activeTab === 'reading') renderReading();
        report(reading.read ? '已标为未读' : '已标为已读');
      } catch (error) { report(`操作失败：${errorMessage(error)}`, true); }
      finally { mark.disabled = false; }
    });
    mark.prepend(icon('check'));
    mark.setAttribute('aria-pressed', String(reading.read));
    mark.setAttribute('aria-label', `${reading.read ? '标为未读' : '标为已读'}：${topic.title}`);
    const open = button('打开', 'button text-button', () => { void openReading(reading); });
    open.prepend(icon('external'));
    const remove = button('删除', 'button text-button delete-reading', async () => {
      remove.disabled = true;
      try {
        state = await removeReading(reading.id);
        if (activeTab === 'reading') renderReading();
        report('已从稍后阅读中移除');
      } catch (error) { report(`删除失败：${errorMessage(error)}`, true); }
      finally { remove.disabled = false; }
    });
    remove.prepend(icon('trash'));
    remove.setAttribute('aria-label', `从稍后阅读中删除：${topic.title}`);
    actions.append(mark, open, remove);
  } else {
    const saved = state?.reading.some(item => item.id === topic.id) ?? false;
    const save = button(saved ? '已在稍后阅读' : '稍后阅读', 'button text-button', async () => {
      save.disabled = true;
      try {
        state = await addReading(topic);
        save.replaceChildren(icon('check'), document.createTextNode('已在稍后阅读'));
        save.setAttribute('aria-pressed', 'true');
        report('已加入稍后阅读');
      } catch (error) { report(`保存失败：${errorMessage(error)}`, true); }
      finally { save.disabled = false; }
    });
    save.prepend(icon(saved ? 'check' : 'book'));
    save.setAttribute('aria-pressed', String(saved));
    save.setAttribute('aria-label', `加入稍后阅读：${topic.title}`);
    actions.append(save);
  }
  main.append(actions);
  row.append(avatar(topic), main);
  return row;
}

function renderReading(): void {
  body.setAttribute('aria-busy', 'false');
  if (!state) { failure('无法读取稍后阅读', stateError); return; }
  if (!state.reading.length) {
    const blank = emptyState('暂时没有稍后阅读', '浏览主题时点击「稍后阅读」，把感兴趣的讨论留在这里。');
    blank.append(link('去过早客逛逛', ORIGIN, 'button small'));
    body.replaceChildren(blank);
    return;
  }
  const list = el('ul', 'topic-list');
  [...state.reading].sort((a, b) => b.addedAt - a.addedAt).forEach(item => list.append(topicRow(item, item)));
  body.replaceChildren(toolbar(`${state.reading.length} 个主题 · ${state.reading.filter(item => !item.read).length} 个未读`), list);
}

function renderTopics(mode: 'hot' | 'latest', topics: Topic[]): void {
  body.setAttribute('aria-busy', 'false');
  if (!topics.length) {
    const blank = emptyState('暂时没有主题', '过早客当前页面没有返回可展示的主题。');
    blank.append(button('重新加载', 'button small', () => { void renderActive(true); }));
    body.replaceChildren(blank);
    return;
  }
  const list = el('ul', 'topic-list');
  topics.forEach(topic => list.append(topicRow(topic)));
  body.replaceChildren(toolbar(`${mode === 'hot' ? '最热讨论' : '最新主题'} · ${topics.length} 个主题`), list);
}

function renderNotices(notices: Notice[]): void {
  body.setAttribute('aria-busy', 'false');
  if (!notices.length) {
    const blank = emptyState('没有新消息', '当前登录账户的通知页面没有返回消息。', 'bell');
    blank.append(link('前往站点消息页', `${ORIGIN}/notifications`, 'button small'));
    body.replaceChildren(blank);
    return;
  }
  const list = el('ul', 'topic-list');
  notices.forEach(notice => {
    const row = el('li', 'notice-row');
    row.append(link(notice.text, notice.url));
    list.append(row);
  });
  body.replaceChildren(toolbar(`${notices.length} 条消息`), list);
}

async function renderActive(refresh = false): Promise<void> {
  const tab = activeTab;
  const token = ++requestId;
  if (tab === 'reading') {
    if (refresh || !state) {
      loading('正在读取稍后阅读');
      try { state = await getState(); stateError = undefined; applyTheme(state.settings); }
      catch (error) { stateError = error; if (token === requestId) failure('无法读取稍后阅读', error); return; }
    }
    if (token === requestId) renderReading();
    return;
  }
  if (tab === 'hot' || tab === 'latest') {
    const cached = cachedTopics.get(tab);
    if (!refresh && cached) { renderTopics(tab, cached); return; }
    loading(tab === 'hot' ? '正在加载最热讨论' : '正在加载最新主题');
    try {
      const topics = await fetchTopics(tab);
      cachedTopics.set(tab, topics);
      if (token === requestId) renderTopics(tab, topics);
    } catch (error) { if (token === requestId) failure('主题加载失败', error); }
    return;
  }
  if (!refresh && cachedNotices) { renderNotices(cachedNotices); return; }
  loading('正在加载消息');
  try {
    const notices = await fetchNotices();
    cachedNotices = notices;
    if (token === requestId) renderNotices(notices);
    void loadAccount();
  } catch (error) { if (token === requestId) failure('无法读取消息', error); }
}

async function loadAccount(): Promise<void> {
  try {
    const account = await fetchAccount();
    const username = account.username.trim();
    const unread = username ? account.unread : 0;
    accountNode.replaceChildren(username
      ? link(username, `${ORIGIN}/u/${encodeURIComponent(username)}`)
      : link('登录过早客', `${ORIGIN}/login`));
    const message = tabs.get('message');
    if (message) {
      message.textContent = unread > 0 ? `消息 ${unread > 99 ? '99+' : unread}` : '消息';
      message.setAttribute('aria-label', `消息，${unread} 条未读`);
    }
  } catch (error) {
    const message = errorMessage(error);
    if (message.includes('请先登录')) accountNode.replaceChildren(link('登录过早客', `${ORIGIN}/login`));
    else {
      accountNode.textContent = '账户状态暂不可用';
      accountNode.title = message;
    }
  }
}

async function initialize(): Promise<void> {
  const footer = el('footer', 'popup-footer');
  accountNode.textContent = '正在读取账户…';
  const footRight = el('div');
  footRight.append(feedback);
  const branding = el('span', '', 'GuoZaoKe Polish');
  footRight.append(branding);
  const observer = new MutationObserver(() => { branding.hidden = Boolean(feedback.textContent); });
  observer.observe(feedback, { childList: true, characterData: true, subtree: true });
  footer.append(accountNode, footRight);
  root.append(makeHeader(), body, footer);
  try { state = await getState(); applyTheme(state.settings); }
  catch (error) { stateError = error; }
  activate('reading');
  void loadAccount();
  const unwatch = watchState(() => {
    void getState().then(next => {
      state = next;
      stateError = undefined;
      applyTheme(next.settings);
      if (activeTab === 'reading') renderReading();
      else if ((activeTab === 'hot' || activeTab === 'latest') && cachedTopics.has(activeTab)) renderTopics(activeTab, cachedTopics.get(activeTab)!);
    }).catch(error => { report(`同步失败：${errorMessage(error)}`, true); });
  });
  const unwatchTheme = watchSystemTheme(() => state?.settings);
  window.addEventListener('pagehide', () => { unwatch(); unwatchTheme(); observer.disconnect(); });
}

void initialize();
