import { browser } from 'wxt/browser';
import { defaults, validateSettings, type Settings } from './settings';
import type { ReadingItem, Topic } from './types';
export interface AppState { settings: Settings; tags: Record<string, string[]>; reading: ReadingItem[]; }
export const emptyState = (): AppState => ({ settings: { ...defaults }, tags: {}, reading: [] });
export async function getState(): Promise<AppState> {
  const response = await browser.runtime.sendMessage({ type: 'state:get' });
  if (!response?.ok) throw new Error(response?.error || '无法读取插件数据');
  return response.data;
}
export async function mutate(action: string, payload?: unknown): Promise<AppState> {
  const response = await browser.runtime.sendMessage({ type: 'state:mutate', action, payload });
  if (!response?.ok) throw new Error(response?.error || '保存失败');
  return response.data;
}
export const saveSettings = (settings: Partial<Settings>) => mutate('settings', settings);
export const setTags = (username: string, tags: string[]) => mutate('tags', { username, tags });
export const addReading = (topic: Topic) => mutate('reading:add', topic);
export const removeReading = (id: string) => mutate('reading:remove', id);
export const markRead = (id: string, read: boolean) => mutate('reading:read', { id, read });
export function watchState(callback: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if ((area === 'local' || area === 'sync') && ('gzk:state' in changes || 'gzk:prefs' in changes)) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
export { validateSettings };
