import { authorCard } from '../../src/shared/author';
import { browser } from 'wxt/browser';
import '../../src/styles/app.css';
import { getState, mutate, saveSettings, setTags, watchState, type AppState } from '../../src/shared/store';
import type { Settings } from '../../src/shared/settings';
import { applyTheme, button, el, emptyState, errorMessage, icon, iconButton, link, watchSystemTheme } from '../../src/shared/app-ui';
import { ORIGIN } from '../../src/site/urls';

type Page = 'controls' | 'tags' | 'backup' | 'about';
type BooleanSetting = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
const root = document.querySelector<HTMLElement>('#app')!;
let state: AppState;
let saving = false;
let tagEditing = false;
let stopWatching: (() => void) | undefined;
const settingsControls: HTMLInputElement[] = [];
const panels = new Map<Page, HTMLElement>();
const navigation = new Map<Page, HTMLAnchorElement>();
const saveStatus = el('div', 'status save-indicator', '设置会自动保存');
const tagStatus = el('div', 'status');
const backupStatus = el('div', 'status');
const tagList = el('div', 'tag-list');
const tagSearch = el('input', 'field-input');
saveStatus.setAttribute('role', 'status');
tagStatus.setAttribute('role', 'status');
backupStatus.setAttribute('role', 'status');

function status(node: HTMLElement, text: string, type: 'success' | 'error' | '' = ''): void {
  node.textContent = text;
  node.classList.toggle('success', type === 'success');
  node.classList.toggle('error', type === 'error');
}

function syncControls(): void {
  for (const input of settingsControls) {
    const value = state.settings[input.name as keyof Settings];
    input.checked = input.type === 'checkbox' ? Boolean(value) : input.value === value;
    input.disabled = saving;
  }
  applyTheme(state.settings);
}

async function changeSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  if (saving) return;
  saving = true;
  settingsControls.forEach(input => { input.disabled = true; });
  status(saveStatus, '正在保存…');
  try {
    state = await saveSettings({ [key]: value });
    status(saveStatus, '已保存', 'success');
  } catch (error) {
    status(saveStatus, `保存失败：${errorMessage(error)}`, 'error');
  } finally {
    saving = false;
    syncControls();
  }
}

function toggle(key: BooleanSetting, title: string, description: string): HTMLElement {
  const row = el('div', 'setting-row');
  const copy = el('div', 'setting-copy');
  const label = el('label', 'setting-label', title);
  label.htmlFor = key;
  const detail = el('p', 'setting-description', description);
  detail.id = `${key}-description`;
  copy.append(label, detail);
  const wrap = el('div', 'switch');
  const input = el('input');
  input.type = 'checkbox';
  input.id = key;
  input.name = key;
  input.setAttribute('role', 'switch');
  input.setAttribute('aria-describedby', detail.id);
  input.addEventListener('change', () => { void changeSetting(key, input.checked); });
  settingsControls.push(input);
  wrap.append(input);
  row.append(copy, wrap);
  return row;
}

function choice<K extends 'theme' | 'nested' | 'tagDisplay' | 'layout'>(
  key: K, title: string, description: string,
  values: { value: Settings[K]; label: string; icon?: string }[],
): HTMLElement {
  const row = el('div', 'choice-setting');
  const fieldset = el('fieldset');
  fieldset.append(el('legend', '', title));
  const detail = el('p', 'setting-description', description);
  detail.id = `${key}-description`;
  fieldset.setAttribute('aria-describedby', detail.id);
  fieldset.append(detail);
  const list = el('div', 'choice-list');
  for (const item of values) {
    const label = el('label', 'choice');
    const input = el('input');
    input.type = 'radio';
    input.name = key;
    input.value = item.value;
    input.setAttribute('aria-label', item.label);
    input.addEventListener('change', () => { if (input.checked) void changeSetting(key, item.value); });
    label.append(input);
    const content = el('span', 'choice-content');
    if (key === 'theme') {
      const preview = el('div', `theme-preview ${item.value}`);
      preview.setAttribute('aria-hidden', 'true');
      label.append(preview);
    }
    if (item.icon) content.append(icon(item.icon));
    content.append(el('span', '', item.label));
    label.append(content);
    settingsControls.push(input);
    list.append(label);
  }
  fieldset.append(list);
  row.append(fieldset);
  return row;
}

function card(title: string, ...rows: HTMLElement[]): HTMLElement {
  const node = el('section', 'settings-card');
  node.append(el('h3', 'card-heading', title), ...rows);
  return node;
}

function buildControls(): HTMLElement {
  const node = el('section');
  const availability = el('div', 'availability-note');
  const note = el('div');
  note.append(el('strong', '', '每日自动签到'), el('span', '', '此版本暂不提供自动签到。'));
  availability.append(icon('info'), note);
  node.append(
    card('基础设置',
      toggle('enabled', '启用 GuoZaoKe Polish', '在过早客页面启用浏览和阅读增强。'),
      toggle('hideAds', '隐藏站点广告', '隐藏过早客的 Google 广告及广告占位，包括侧边和底部浮动广告；仅影响页面显示，不拦截网络请求。'),
      toggle('openInNewTab', '新标签页打开主题', '从过早客主题列表打开主题时，保留当前列表。'),
      toggle('topicPreview', '主题列表内容预览', '在列表中直接预览主题内容，再决定是否打开。'),
      availability,
    ),
    card('外观',
      choice('theme', '颜色主题', '关闭“跟随系统”后，使用所选颜色主题。', [
        { value: 'light', label: '浅色', icon: 'sun' },
        { value: 'dark', label: '深色', icon: 'moon' },
        { value: 'dawn', label: '晨曦', icon: 'sunrise' },
      ]),
      toggle('autoTheme', '跟随系统颜色模式', '根据系统浅色或深色模式自动切换，设置页和弹窗同步生效。'),
      toggle('compact', '紧凑布局', '减小页面留白，在同一屏幕中展示更多内容。'),
      choice('layout', '主题内容布局', '自动模式在正文高度达到 600 像素时并排展示正文和回复；窄屏保持垂直布局。', [
        { value: 'auto', label: '自动（长文横向）' }, { value: 'vertical', label: '垂直' }, { value: 'horizontal', label: '水平' },
      ]),
    ),
    card('回复与楼中楼',
      choice('nested', '楼中楼回复的展现形式', '根据回复中的 @ 提及和楼层引用组织讨论。', [
        { value: 'indent', label: '缩进嵌套' }, { value: 'align', label: '平齐显示' }, { value: 'off', label: '关闭嵌套' },
      ]),
      toggle('multipleMention', '多用户提及参与嵌套', '一条回复提及多个用户时，也参与楼中楼整理。'),
      toggle('preload', '预加载多页回复', '在第一页自动合并后续最多两页回复，更多回复可使用原站翻页查看。'),
      toggle('autoFold', '自动折叠长回复', '将较长的回复收起，需要时展开完整内容。'),
      toggle('hideReplyTime', '隐藏回复时间', '减少回复区时间信息的视觉干扰。'),
      toggle('hideRefName', '隐藏 @ 提及用户名', '在回复内容中隐藏已显示的 @ 提及名称。'),
    ),
    card('图片与用户信息',
      toggle('imagePreview', '页内图片预览', '点击主题和回复中的图片，在当前页面查看大图。'),
      choice('tagDisplay', '用户标签展现形式', '为用户设置的个人标签只在你的浏览器中展示。', [
        { value: 'inline', label: '用户名旁边' }, { value: 'block', label: '独立一行' },
      ]),
      toggle('hideAccount', '隐藏个人账户信息', '在过早客页面隐藏个人账户区域，方便专注阅读。'),
    ),
    buildImageHosting(),
  );
  return node;
}

function buildImageHosting(): HTMLElement {
  const card = el('section', 'panel-card');
  const content = el('div', 'panel-content');
  const label = el('label', 'form-label', 'Imgur Client ID');
  label.htmlFor = 'imgur-client-id';
  const input = el('input', 'field-input');
  input.id = 'imgur-client-id';
  input.placeholder = '填写你自己注册的 Imgur Client ID';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = 128;
  input.disabled = true;
  label.append(input);
  const detail = el('p', 'setting-description', '仅保存在当前浏览器本机，不纳入 JSON 备份。未配置时，仍可在编辑器中通过图片 URL 插入图片。');
  detail.id = 'imgur-client-description';
  input.setAttribute('aria-describedby', detail.id);
  const feedback = el('div', 'status', '正在读取图床配置…');
  feedback.setAttribute('role', 'status');
  const save = button('授权并保存', 'button primary small', async () => {
    const clientId = input.value.trim();
    if (!clientId || /\s/.test(clientId)) { status(feedback, '请输入有效的 Imgur Client ID，不要包含空格。', 'error'); return; }
    save.disabled = input.disabled = clear.disabled = true;
    status(feedback, '正在请求 Imgur 访问权限…');
    try {
      const allowed = await browser.permissions.request({ origins: ['https://api.imgur.com/*'] });
      if (!allowed) { status(feedback, '未获得 Imgur 访问权限，配置未保存。', 'error'); return; }
      await browser.storage.local.set({ 'gzk:imgur-client': clientId });
      input.value = clientId;
      status(feedback, 'Imgur Client ID 已保存到本机。', 'success');
    } catch (error) { status(feedback, `配置保存失败：${errorMessage(error)}`, 'error'); }
    finally { save.disabled = input.disabled = clear.disabled = false; }
  });
  save.disabled = true;
  const clear = button('清除配置', 'button small', async () => {
    save.disabled = input.disabled = clear.disabled = true;
    status(feedback, '正在清除图床配置…');
    try {
      await browser.storage.local.set({ 'gzk:imgur-client': '' });
      input.value = '';
      status(feedback, '已清除本机图床配置，可以继续使用图片 URL。', 'success');
    } catch (error) { status(feedback, `清除失败：${errorMessage(error)}`, 'error'); }
    finally { save.disabled = input.disabled = clear.disabled = false; }
  });
  clear.disabled = true;
  const actions = el('div', 'action-row');
  actions.append(save, clear);
  const links = el('div', 'action-row');
  links.style.marginTop = '14px';
  links.append(link('注册 Imgur 应用', 'https://api.imgur.com/oauth2/addclient', 'small-text'), link('过早客图片上传帮助', `${ORIGIN}/image_upload`, 'small-text'));
  content.append(el('h3', '', '图床配置'), el('p', '', '配置后，编辑器中的图片上传会将图片发送至 Imgur 并生成公开链接。请只上传你愿意公开的图片。保存时会向浏览器申请访问 Imgur 的权限。'), label, detail, actions, links, feedback);
  card.append(content);
  void (async () => {
    try {
      const stored = await browser.storage.local.get('gzk:imgur-client');
      input.value = typeof stored['gzk:imgur-client'] === 'string' ? stored['gzk:imgur-client'] : '';
      status(feedback, input.value ? '已配置本机 Imgur Client ID' : '尚未配置图床');
    } catch (error) { status(feedback, `读取配置失败：${errorMessage(error)}`, 'error'); }
    finally { save.disabled = input.disabled = clear.disabled = false; }
  })();
  return card;
}

const splitTags = (text: string) => [...new Set(text.split(/[,，\n]/).map(item => item.trim()).filter(Boolean))];

async function writeTags(username: string, tags: string[]): Promise<boolean> {
  status(tagStatus, '正在保存标签…');
  try {
    state = await setTags(username, tags);
    tagEditing = false;
    tagSearch.disabled = false;
    renderTags();
    status(tagStatus, '标签已保存', 'success');
    return true;
  } catch (error) {
    status(tagStatus, `保存失败：${errorMessage(error)}`, 'error');
    return false;
  }
}

function editTags(row: HTMLElement, username: string, tags: string[], editButton: HTMLButtonElement): void {
  if (row.querySelector('.tag-edit')) return;
  if (tagEditing || document.querySelector('.add-tag-form:not([hidden])')) {
    status(tagStatus, '请先保存或取消当前标签编辑，再编辑其他用户。');
    return;
  }
  tagEditing = true;
  tagSearch.disabled = true;
  editButton.disabled = true;
  const form = el('form', 'tag-edit');
  const label = el('label', 'form-label', `编辑 ${username} 的标签（用逗号分隔）`);
  const input = el('input', 'field-input');
  input.value = tags.join('，');
  input.required = true;
  label.append(input);
  const save = button('保存标签', 'button primary small');
  save.type = 'submit';
  const cancel = button('取消', 'button small', () => {
    tagEditing = false;
    tagSearch.disabled = false;
    form.remove();
    editButton.disabled = false;
    editButton.focus();
  });
  const actions = el('div', 'action-row');
  actions.append(save, cancel);
  form.append(label, actions);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const nextTags = splitTags(input.value);
    if (!nextTags.length) { status(tagStatus, '请输入至少一个标签；需要删除时请使用删除按钮。', 'error'); return; }
    save.disabled = true;
    cancel.disabled = true;
    input.disabled = true;
    await writeTags(username, nextTags);
    save.disabled = false;
    cancel.disabled = false;
    input.disabled = false;
  });
  row.append(form);
  input.focus();
}

function renderTags(): void {
  const search = tagSearch.value.trim().toLocaleLowerCase();
  const entries = Object.entries(state.tags).filter(([username, tags]) =>
    [username, ...tags].some(value => value.toLocaleLowerCase().includes(search)),
  ).sort(([a], [b]) => a.localeCompare(b));
  tagList.replaceChildren();
  if (!entries.length) {
    tagList.append(emptyState(search ? '没有匹配的用户标签' : '还没有用户标签', search ? '试试搜索其他用户名或标签。' : '给用户添加自己的备注标签，之后就能在浏览时认出他们。', 'tag'));
    return;
  }
  for (const [username, tags] of entries) {
    const row = el('div', 'tag-row');
    const line = el('div', 'tag-row-main');
    const chips = el('div', 'tag-chips');
    tags.forEach(tag => chips.append(el('span', 'tag-chip', tag)));
    const actions = el('div', 'tag-actions');
    const edit = iconButton(`编辑 ${username} 的标签`, 'edit', () => editTags(row, username, tags, edit));
    const remove = iconButton(`删除 ${username} 的全部标签`, 'trash', () => {
      if (tagEditing) { status(tagStatus, '请先保存或取消当前标签编辑，再删除标签。'); return; }
      if (!window.confirm(`删除 ${username} 的全部个人标签？`)) return;
      remove.disabled = true;
      edit.disabled = true;
      void writeTags(username, []).finally(() => { remove.disabled = false; edit.disabled = false; });
    });
    remove.classList.add('danger');
    actions.append(edit, remove);
    line.append(link(username, `${ORIGIN}/u/${encodeURIComponent(username)}`, 'tag-user'), chips, actions);
    row.append(line);
    tagList.append(row);
  }
}

function buildTags(): HTMLElement {
  const panel = el('section', 'panel-card');
  const toolbar = el('div', 'tag-toolbar');
  const search = el('label', 'search-field');
  search.append(el('span', 'sr-only', '搜索用户名或标签'), icon('search'));
  tagSearch.type = 'search';
  tagSearch.placeholder = '搜索用户名或标签';
  tagSearch.addEventListener('input', renderTags);
  search.append(tagSearch);
  const form = el('form', 'add-tag-form');
  form.hidden = true;
  const showForm = button('添加用户标签', 'button small', () => {
    if (tagEditing) { status(tagStatus, '请先保存或取消当前标签编辑，再添加用户标签。'); return; }
    form.hidden = !form.hidden;
    showForm.setAttribute('aria-expanded', String(!form.hidden));
    if (!form.hidden) username.focus();
  });
  showForm.setAttribute('aria-expanded', 'false');
  toolbar.append(search, showForm);
  const userLabel = el('label', 'form-label', '用户名');
  const username = el('input', 'field-input');
  username.required = true;
  username.placeholder = '过早客用户名';
  username.autocomplete = 'off';
  userLabel.append(username);
  const tagsLabel = el('label', 'form-label', '标签（用逗号分隔）');
  const tags = el('input', 'field-input');
  tags.required = true;
  tags.placeholder = '例如：技术分享，摄影';
  tagsLabel.append(tags);
  const save = button('保存标签', 'button primary small');
  save.type = 'submit';
  const cancel = button('取消', 'button small', () => { form.hidden = true; showForm.setAttribute('aria-expanded', 'false'); showForm.focus(); });
  const actions = el('div', 'action-row');
  actions.append(save, cancel);
  form.append(userLabel, tagsLabel, el('p', 'small-text muted', '添加到已有用户名时，会保留该用户现有标签。'), actions);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const name = username.value.trim().replace(/^@/, '');
    const enteredTags = splitTags(tags.value);
    if (!name || !enteredTags.length) { status(tagStatus, '请填写用户名和至少一个标签。', 'error'); return; }
    save.disabled = cancel.disabled = username.disabled = tags.disabled = true;
    try {
      // Refresh before merging so a tag added from a website tab is not lost.
      state = await getState();
      const merged = [...new Set([...(state.tags[name] ?? []), ...enteredTags])];
      if (await writeTags(name, merged)) {
        form.reset();
        form.hidden = true;
        showForm.setAttribute('aria-expanded', 'false');
      }
    } catch (error) { status(tagStatus, errorMessage(error), 'error'); }
    finally { save.disabled = cancel.disabled = username.disabled = tags.disabled = false; }
  });
  const footer = el('div', 'panel-content');
  footer.append(tagStatus);
  panel.append(toolbar, form, tagList, footer);
  return panel;
}

async function exportBackup(): Promise<void> {
  status(backupStatus, '正在准备备份…');
  try {
    const current = await getState();
    const blob = new Blob([JSON.stringify({ version: 1, ...current }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const download = el('a');
    download.href = url;
    download.download = `guozaoke-polish-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(download);
    download.click();
    download.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    status(backupStatus, '备份文件已生成，请在浏览器下载列表中确认。', 'success');
  } catch (error) { status(backupStatus, `导出失败：${errorMessage(error)}`, 'error'); }
}

function buildBackup(): HTMLElement {
  const card = el('section', 'panel-card');
  const exporting = el('div', 'panel-content');
  const exportButton = button('导出 JSON 备份', 'button', () => { void exportBackup(); });
  exportButton.prepend(icon('download'));
  exporting.append(el('h3', '', '导出数据'), el('p', '', '备份包含全部控制选项、用户标签和稍后阅读列表。数据保存在当前浏览器的扩展存储中，卸载前请先导出备份。'), exportButton);
  const importing = el('div', 'panel-content');
  const file = el('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.hidden = true;
  file.setAttribute('aria-label', '选择 JSON 备份文件');
  const choose = button('选择备份文件', 'button', () => file.click());
  choose.prepend(icon('upload'));
  const preview = el('div', 'backup-preview');
  preview.hidden = true;
  file.addEventListener('change', async () => {
    const selected = file.files?.[0];
    if (!selected) return;
    preview.hidden = true;
    try {
      if (selected.size > 10 * 1024 * 1024) throw new Error('备份文件超过 10 MB，请检查是否选择了正确文件');
      const payload: unknown = JSON.parse(await selected.text());
      const candidate = payload as Partial<AppState> & { version?: unknown } | null;
      const tagsCount = candidate && typeof candidate.tags === 'object' && candidate.tags !== null ? Object.keys(candidate.tags).length : '待校验';
      const readingCount = candidate && Array.isArray(candidate.reading) ? candidate.reading.length : '待校验';
      preview.replaceChildren(el('h4', '', selected.name), el('p', '', `备份概览：${tagsCount} 位用户的标签，${readingCount} 个稍后阅读主题。`), el('p', '', '导入会替换当前全部设置、标签和阅读列表，无法自动撤销。建议先导出当前数据。后台校验通过后才会写入。'));
      const actions = el('div', 'action-row');
      const importButton = button('确认替换并导入', 'button primary', async () => {
        importButton.disabled = true;
        cancel.disabled = true;
        choose.disabled = true;
        status(backupStatus, '正在校验并导入…');
        try {
          state = await mutate('import', payload);
          tagEditing = false;
          tagSearch.disabled = false;
          syncControls();
          renderTags();
          preview.hidden = true;
          file.value = '';
          status(backupStatus, '数据已导入，设置、标签和阅读列表均已更新。', 'success');
        } catch (error) { status(backupStatus, `导入失败：${errorMessage(error)}`, 'error'); }
        finally { importButton.disabled = cancel.disabled = choose.disabled = false; }
      });
      const cancel = button('取消', 'button', () => { preview.hidden = true; file.value = ''; status(backupStatus, '已取消导入'); });
      actions.append(importButton, cancel);
      preview.append(actions);
      preview.hidden = false;
      status(backupStatus, '文件已读取，请确认导入范围。');
    } catch (error) { status(backupStatus, `无法读取备份：${errorMessage(error)}`, 'error'); file.value = ''; }
  });
  importing.append(el('h3', '', '导入数据'), el('p', '', '选择 GuoZaoKe Polish 导出的 JSON 文件。文件将先进行格式与内容校验；错误文件不会覆盖当前数据。'), choose, file, preview);
  const reset = el('div', 'panel-content');
  const resetButton = button('恢复默认设置', 'button danger', async () => {
    if (!window.confirm('恢复全部控制选项的默认值？用户标签和稍后阅读列表会保留。')) return;
    resetButton.disabled = true;
    status(backupStatus, '正在恢复默认设置…');
    try {
      state = await mutate('reset');
      syncControls();
      status(backupStatus, '已恢复默认设置，用户标签和稍后阅读列表已保留。', 'success');
    } catch (error) { status(backupStatus, `恢复失败：${errorMessage(error)}`, 'error'); }
    finally { resetButton.disabled = false; }
  });
  reset.append(el('h3', '', '恢复默认设置'), el('p', '', '仅重置控制选项，保留用户标签和稍后阅读列表。'), resetButton);
  const feedback = el('div', 'panel-content');
  feedback.append(backupStatus);
  card.append(exporting, importing, reset, feedback);
  return card;
}

function buildAbout(): HTMLElement {
  const card = el('section', 'panel-card');
  const content = el('div', 'panel-content');
  const brand = el('div', 'about-brand');
  const text = el('div');
  text.append(el('h3', '', 'GuoZaoKe Polish'), el('p', '', `版本 ${browser.runtime.getManifest().version} · 为过早客阅读体验而作`));
  brand.append(el('div', 'brand-mark', 'G'), text);
  const list = el('dl', 'about-list');
  for (const [term, description] of [
    ['独立作品', '本扩展独立实现，非过早客官方产品，与 V2EX Polish 无隶属关系。'],
    ['交互参考', '参考 V2EX Polish 的阅读增强功能与交互安排，适配过早客站点。'],
    ['数据与登录', '设置、标签和阅读列表保存在浏览器本地。站点内容通过过早客公开页面或当前登录会话读取。'],
    ['自动签到', '过早客尚未确认独立的签到奖励入口，当前不执行自动签到。'],
  ]) {
    const item = el('div');
    item.append(el('dt', '', term), el('dd', '', description));
    list.append(item);
  }
  const links = el('div', 'action-row');
  links.style.marginTop = '24px';
  links.append(link('GitHub 项目', 'https://github.com/laoertongxue/GuoZaoKe-Polish', 'button small'), link('访问过早客', ORIGIN, 'button small'), link('V2EX Polish 参考项目', 'https://github.com/coolpace/V2EX_Polish', 'button small'));
  const authorPanel=el('section','about-author');
  authorPanel.setAttribute('aria-label','关于作者');authorPanel.append(authorCard());
  content.append(brand, authorPanel, list, links);
  card.append(content);
  return card;
}

function showPage(): void {
  const raw = location.hash.slice(1) as Page;
  const page = panels.has(raw) ? raw : 'controls';
  panels.forEach((panel, key) => { panel.hidden = key !== page; });
  navigation.forEach((item, key) => {
    item.classList.toggle('active', key === page);
    if (key === page) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  });
  document.title = `${navigation.get(page)?.textContent} · GuoZaoKe Polish`;
}

async function initialize(): Promise<void> {
  root.replaceChildren(el('div', 'loading-page status', '正在读取插件设置…'));
  try {
    state = await getState();
    root.className = 'options-shell';
    root.replaceChildren();
    const sidebar = el('aside', 'sidebar');
    const brand = el('div', 'brand');
    const brandText = el('div');
    brandText.append(el('h1', '', 'GuoZaoKe Polish'), el('p', '', '让阅读更从容'));
    brand.append(el('div', 'brand-mark', 'G'), brandText);
    const nav = el('nav', 'side-nav');
    nav.setAttribute('aria-label', '设置导航');
    const content = el('div', 'options-content');
    const pages: { key: Page; title: string; description: string; icon: string; build: () => HTMLElement }[] = [
      { key: 'controls', title: '控制选项', description: '按你的习惯，调整过早客的浏览与阅读体验。', icon: 'sliders', build: buildControls },
      { key: 'tags', title: '用户标签', description: '用自己的方式，记住遇见的人。', icon: 'tag', build: buildTags },
      { key: 'backup', title: '数据备份', description: '导出、导入和管理保存在浏览器中的插件数据。', icon: 'archive', build: buildBackup },
      { key: 'about', title: '关于', description: 'GuoZaoKe Polish · 过早客浏览体验增强', icon: 'info', build: buildAbout },
    ];
    for (const page of pages) {
      const item = el('a', 'nav-link');
      item.href = `#${page.key}`;
      item.append(icon(page.icon), el('span', '', page.title));
      navigation.set(page.key, item);
      nav.append(item);
      const panel = el('section');
      panel.id = `page-${page.key}`;
      panel.setAttribute('aria-labelledby', `heading-${page.key}`);
      const header = el('header', 'page-header');
      const heading = el('div');
      const title = el('h2', '', page.title);
      title.id = `heading-${page.key}`;
      heading.append(title, el('p', '', page.description));
      header.append(heading);
      if (page.key === 'controls') header.append(saveStatus);
      panel.append(header, page.build());
      panels.set(page.key, panel);
      content.append(panel);
    }
    sidebar.append(brand, nav, el('p', 'sidebar-note', '设置自动保存。用户标签和稍后阅读保存在当前浏览器，可随时在「数据备份」中导出。'), el('p', 'sidebar-footer', `GuoZaoKe Polish ${browser.runtime.getManifest().version}`));
    root.append(sidebar, content);
    syncControls();
    renderTags();
    showPage();
    stopWatching?.();
    stopWatching = watchState(() => {
      void getState().then(next => {
        state = next;
        if (!saving) syncControls();
        if (!tagEditing) renderTags();
      }).catch(error => { status(saveStatus, `同步失败：${errorMessage(error)}`, 'error'); });
    });
  } catch (error) {
    root.className = 'loading-page';
    const failure = emptyState('无法读取插件数据', errorMessage(error), 'info');
    failure.append(button('重试', 'button', () => { void initialize(); }));
    root.replaceChildren(failure);
  }
}

window.addEventListener('hashchange', showPage);
const stopTheme = watchSystemTheme(() => state?.settings);
window.addEventListener('pagehide', () => { stopWatching?.(); stopTheme(); });
void initialize();
