import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaults } from '../src/shared/settings';
import type { AppState } from '../src/shared/store';
import { el, link } from '../src/shared/app-ui';

const api = vi.hoisted(() => ({
  getState: vi.fn(), saveSettings: vi.fn(), setTags: vi.fn(), mutate: vi.fn(), watchState: vi.fn(),
  permissionsRequest: vi.fn(), permissionsContains:vi.fn(), permissionsRemove:vi.fn(), storageGet: vi.fn(), storageSet: vi.fn(),
}));
vi.mock('../src/shared/store', () => api);
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { getURL:(path:string)=>`chrome-extension://test${path}`,getManifest: () => ({ version: '0.1.0' }) },
  permissions: { request: api.permissionsRequest, contains:api.permissionsContains,remove:api.permissionsRemove },
  storage: { local: { get: api.storageGet, set: api.storageSet } },
} }));

let state: AppState;
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
const findButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  window.location.hash = '';
  document.body.innerHTML = '<main id="app"></main>';
  state = { settings: { ...defaults }, tags: {}, reading: [] };
  api.getState.mockImplementation(async () => structuredClone(state));
  api.watchState.mockReturnValue(() => {});
  api.storageGet.mockResolvedValue({});
  api.storageSet.mockResolvedValue(undefined);
  api.permissionsRequest.mockResolvedValue(true);
  api.permissionsContains.mockResolvedValue(false);api.permissionsRemove.mockResolvedValue(true);
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); });

describe('options page persistence', () => {
  it('offers automatic, vertical and horizontal layout and persists the selected enum', async () => {
    api.saveSettings.mockImplementation(async patch => ({ ...state, settings: { ...state.settings, ...patch } }));
    await import('../entrypoints/options/main');
    await settle();
    const choices = [...document.querySelectorAll<HTMLInputElement>('input[name="layout"]')];
    expect(choices.map(input => input.value)).toEqual(['auto', 'vertical', 'horizontal']);
    expect(choices.find(input => input.checked)?.value).toBe('vertical');
    expect(document.querySelector('input[name="horizontal"]')).toBeNull();
    const horizontal = choices.find(input => input.value === 'horizontal')!;
    horizontal.checked = true;
    horizontal.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(api.saveSettings).toHaveBeenCalledWith({ layout: 'horizontal' });
    expect(horizontal.checked).toBe(true);
    expect(document.querySelector('.save-indicator')?.textContent).toBe('已保存');
  });

  it('renders every shared setting and restores the saved value after failure', async () => {
    api.saveSettings.mockRejectedValue(new Error('存储空间不足'));
    await import('../entrypoints/options/main');
    await settle();
    const represented = new Set([...document.querySelectorAll<HTMLInputElement>('.settings-card input')].map(input => input.name));
    expect([...represented].sort()).toEqual(Object.keys(defaults).sort());
    const enabled = document.querySelector<HTMLInputElement>('#enabled')!;
    expect(enabled.checked).toBe(true);
    enabled.checked = false;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
    expect(enabled.disabled).toBe(true);
    await settle();
    expect(api.saveSettings).toHaveBeenCalledWith({ enabled: false });
    expect(enabled.checked).toBe(true);
    expect(enabled.disabled).toBe(false);
    expect(document.querySelector('.save-indicator')?.textContent).toContain('存储空间不足');
    expect(document.querySelector('.save-indicator')?.textContent).not.toBe('已保存');
  });

  it('keeps the tag editor and original tags when persistence fails', async () => {
    state.tags = { alice: ['原有标签'] };
    api.setTags.mockRejectedValue(new Error('写入失败'));
    await import('../entrypoints/options/main');
    await settle();
    expect(document.querySelector<HTMLAnchorElement>('.tag-user')?.href).toBe('https://www.guozaoke.com/u/alice');
    document.querySelector<HTMLButtonElement>('[aria-label="编辑 alice 的标签"]')!.click();
    const input = document.querySelector<HTMLInputElement>('.tag-edit input')!;
    input.value = '未保存的新标签';
    document.querySelector<HTMLFormElement>('.tag-edit')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(api.setTags).toHaveBeenCalledWith('alice', ['未保存的新标签']);
    expect(document.querySelector('.tag-chip')?.textContent).toBe('原有标签');
    expect(document.querySelector<HTMLInputElement>('.tag-edit input')?.value).toBe('未保存的新标签');
    expect(document.querySelector<HTMLInputElement>('.tag-edit input')?.disabled).toBe(false);
    expect(document.body.textContent).toContain('写入失败');
  });

  it('requires a visible import confirmation and keeps current data after validation rejection', async () => {
    state.tags = { alice: ['保留标签'] };
    api.mutate.mockRejectedValue(new Error('备份版本无效'));
    await import('../entrypoints/options/main');
    await settle();
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const payload = { version: 9, settings: {}, tags: {}, reading: [] };
    Object.defineProperty(fileInput, 'files', { value: [new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' })] });
    fileInput.dispatchEvent(new Event('change'));
    await settle();
    expect(api.mutate).not.toHaveBeenCalled();
    expect(document.querySelector('.backup-preview')?.textContent).toContain('导入会替换当前全部设置');
    findButton('确认替换并导入').click();
    await settle();
    expect(api.mutate).toHaveBeenCalledWith('import', payload);
    expect(document.querySelector('.tag-chip')?.textContent).toBe('保留标签');
    expect(document.body.textContent).toContain('备份版本无效');
    expect(findButton('确认替换并导入').disabled).toBe(false);
  });

  it('saves the image host client ID only after the optional permission is granted', async () => {
    api.permissionsRequest.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await import('../entrypoints/options/main');
    await settle();
    const input = document.querySelector<HTMLInputElement>('#imgur-client-id')!;
    input.value = 'my-client-id';
    findButton('授权并保存').click();
    await settle();
    expect(api.permissionsRequest).toHaveBeenCalledWith({ origins: ['https://api.imgur.com/*'] });
    expect(api.storageSet).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('未获得 Imgur 访问权限，配置未保存');
    findButton('授权并保存').click();
    await settle();
    expect(api.storageSet).toHaveBeenCalledWith({ 'gzk:imgur-client': 'my-client-id', 'gzk:image-provider':'imgur' });
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Imgur Client ID 已保存到本机');
  });
  it('B站启用只请求必要权限并保存非凭据偏好，拒绝时不保存',async()=>{
    api.permissionsRequest.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await import('../entrypoints/options/main');await settle();
    expect(document.querySelector('input[name="SESSDATA"]')).toBeNull();
    findButton('启用 B 站上传').click();await settle();
    expect(api.permissionsRequest).toHaveBeenCalledWith({permissions:['cookies'],origins:['https://api.bilibili.com/*']});
    expect(api.storageSet).not.toHaveBeenCalled();
    findButton('启用 B 站上传').click();await settle();
    expect(api.storageSet).toHaveBeenCalledExactlyOnceWith({'gzk:image-provider':'bilibili'});
    expect(document.body.textContent).toContain('已启用');
  });
  it('停用B站可撤销权限，并保留Imgur配置',async()=>{
    api.permissionsContains.mockResolvedValue(true);
    api.storageGet.mockResolvedValue({'gzk:imgur-client':'keep-client'});
    await import('../entrypoints/options/main');await settle();
    findButton('停用 B 站上传').click();await settle();
    expect(api.permissionsRemove).toHaveBeenCalledWith({permissions:['cookies'],origins:['https://api.bilibili.com/*']});
    expect(api.storageSet).toHaveBeenCalledWith({'gzk:image-provider':'imgur'});
    expect(document.querySelector<HTMLInputElement>('#imgur-client-id')!.value).toBe('keep-client');
  });
});

describe('untrusted UI content', () => {
  it('renders imported strings as text and rejects executable links', () => {
    const node = el('div', '', '<img src=x onerror=alert(1)>');
    expect(node.querySelector('img')).toBeNull();
    expect(node.textContent).toContain('<img');
    expect(link('unsafe', 'javascript:alert(1)').hasAttribute('href')).toBe(false);
    expect(link('safe', 'https://www.guozaoke.com/t/123').href).toBe('https://www.guozaoke.com/t/123');
  });
});
