import { browser } from 'wxt/browser';
import { initialState, readableReading, readableTags, type AppState } from './state';
import { readSettingsLenient } from './settings';

/**
 * Loads stored state tolerantly: values this build cannot interpret fall back to defaults, so a
 * single unknown value cannot block the page, the options page, or any later write.
 */
export async function readStoredState(): Promise<AppState> {
  const [local, sync] = await Promise.all([
    browser.storage.local.get('gzk:state'), browser.storage.sync.get('gzk:prefs'),
  ]);
  const state = initialState();
  const prefs = sync['gzk:prefs'] as { settings?: unknown; tags?: unknown } | undefined;
  if (prefs) { state.settings = readSettingsLenient(prefs.settings); state.tags = readableTags(prefs.tags); }
  state.reading = readableReading((local['gzk:state'] as { reading?: unknown } | undefined)?.reading);
  return state;
}
