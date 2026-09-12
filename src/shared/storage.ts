import { browser } from 'wxt/browser';
import { initialState, type AppState } from './state';
import { validateSettings } from './settings';

export async function readStoredState(): Promise<AppState> {
  const [local, sync] = await Promise.all([
    browser.storage.local.get('gzk:state'), browser.storage.sync.get('gzk:prefs'),
  ]);
  const state = initialState();
  const prefs = sync['gzk:prefs'] as Pick<AppState, 'settings' | 'tags'> | undefined;
  if (prefs) { state.settings = validateSettings(prefs.settings); state.tags = prefs.tags || {}; }
  state.reading = (local['gzk:state'] as Pick<AppState, 'reading'> | undefined)?.reading || [];
  return state;
}
