import { expect, it } from 'vitest';
import { defaults, validateSettings } from '../src/shared/settings';
import { validateBackup } from '../src/shared/state';
it('枚举设置拒绝可转换为字符串的数组与对象', () => {
  for (const [key, value] of [['theme', ['dark']], ['nested', ['indent']], ['tagDisplay', ['inline']], ['layout', ['auto']]]) {
    expect(() => validateSettings({ [String(key)]: value })).toThrow();
  }
});
it('默认纵向布局，三个枚举可保存且拒绝无效类型', () => {
  expect(defaults.layout).toBe('vertical');
  expect(defaults).not.toHaveProperty('horizontal');
  for (const layout of ['auto', 'vertical', 'horizontal']) expect(validateSettings({ layout }).layout).toBe(layout);
  for (const layout of [true, 1, null, {}, 'wide']) expect(() => validateSettings({ layout })).toThrow();
});
it('旧备份横向布尔值迁移为布局枚举，显式布局优先且不影响其他设置', () => {
  for (const horizontal of [true, false]) {
    const restored = validateBackup({ version: 1, settings: { horizontal, compact: true, imagePreview: false }, tags: {}, reading: [] });
    expect(restored.settings.layout).toBe(horizontal ? 'horizontal' : 'vertical');
    expect(restored.settings).not.toHaveProperty('horizontal');
    expect(restored.settings.compact).toBe(true);
    expect(restored.settings.imagePreview).toBe(false);
  }
  expect(validateSettings({ horizontal: true, layout: 'auto' }).layout).toBe('auto');
  expect(validateSettings({ horizontal: false, layout: 'horizontal' }).layout).toBe('horizontal');
  expect(validateSettings({}).layout).toBe('vertical');
  expect(() => validateSettings({ horizontal: 'true' })).toThrow();
});
