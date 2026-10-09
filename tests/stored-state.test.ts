import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  localGet: vi.fn(),
  syncGet: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: { storage: { local: { get: api.localGet }, sync: { get: api.syncGet } } },
}));

import { readStoredState } from '../src/shared/storage';
import { readSettingsLenient, defaults, validateSettings } from '../src/shared/settings';
import { applyAction, readableReading, readableTags, validateBackup } from '../src/shared/state';

beforeEach(() => {
  api.localGet.mockReset();
  api.syncGet.mockReset();
});

const READING = {
  id: '42', url: 'https://www.guozaoke.com/t/42', title: '主题', author: 'alice', avatar: '', node: 'x', replies: 1, time: 't', addedAt: 1, read: false,
};

it('a synced value this build does not know falls back to its default instead of blocking the load', async () => {
  api.syncGet.mockResolvedValue({ 'gzk:prefs': { settings: { theme: 'sepia', compact: true, imagePreview: false }, tags: {} } });
  api.localGet.mockResolvedValue({});
  const state = await readStoredState();
  expect(state.settings.theme).toBe(defaults.theme);
  expect(state.settings.compact).toBe(true);
  expect(state.settings.imagePreview).toBe(false);
});

it('the strict validator still rejects the same value, so writes keep their guarantees', () => {
  expect(() => validateSettings({ theme: 'sepia' })).toThrow();
});

it('readSettingsLenient ignores unknown keys and keeps layout compatibility', () => {
  expect(readSettingsLenient({ horizontal: true, nested: 'bogus', unknownKey: 1 })).toMatchObject({ layout: 'horizontal', nested: defaults.nested });
  expect(readSettingsLenient({ horizontal: true, layout: 'auto' }).layout).toBe('auto');
  expect(readSettingsLenient(null)).toEqual(defaults);
  expect(readSettingsLenient('not-an-object')).toEqual(defaults);
});

it('invalid tag users are dropped one by one, valid ones are kept', () => {
  const tags = readableTags({ alice: ['开发'], '__proto__': ['x'], 'bad name!': ['y'], bob: 'not-an-array' });
  expect(tags).toEqual({ alice: ['开发'] });
});

it('invalid reading entries are dropped and duplicates collapsed', () => {
  const items = readableReading([READING, READING, { id: 'nope' }, null]);
  expect(items.map(item => item.id)).toEqual(['42']);
  expect(readableReading('not-a-list')).toEqual([]);
});

it('after a lenient load, a reset or a settings change still writes successfully', async () => {
  api.syncGet.mockResolvedValue({ 'gzk:prefs': { settings: { theme: 'sepia' }, tags: {} } });
  api.localGet.mockResolvedValue({});
  const state = await readStoredState();
  expect(applyAction(state, 'reset').settings).toEqual(defaults);
  expect(applyAction(state, 'settings', { theme: 'dark' }).settings.theme).toBe('dark');
});

it('backup import keeps the strict validation', () => {
  expect(() => validateBackup({ version: 1, settings: { theme: 'sepia' }, tags: {}, reading: [] })).toThrow();
});
