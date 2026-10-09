export const defaults = {
  enabled: true,
  hideAds: true,
  openInNewTab: false,
  theme: 'light' as 'light' | 'dark' | 'dawn',
  autoTheme: false,
  compact: false,
  nested: 'indent' as 'indent' | 'align' | 'off',
  multipleMention: true,
  preload: false,
  layout: 'vertical' as 'auto' | 'vertical' | 'horizontal',
  autoFold: true,
  hideReplyTime: true,
  hideRefName: true,
  imagePreview: true,
  tagDisplay: 'inline' as 'inline' | 'block',
  hideAccount: false,
  topicPreview: true,
};
export type Settings = typeof defaults;
export function validateSettings(value: unknown): Settings {
  const out = { ...defaults };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置格式不正确');
  const incoming = value as Record<string, unknown>;
  // Older exports used a boolean; an explicit new layout always takes priority.
  if (!('layout' in incoming) && 'horizontal' in incoming) {
    if (typeof incoming.horizontal !== 'boolean') throw new Error('旧版横向布局设置必须为布尔值');
    out.layout = incoming.horizontal ? 'horizontal' : 'vertical';
  }
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    if (!(key in value)) continue;
    const v = (value as Record<string, unknown>)[key];
    if (typeof defaults[key] === 'boolean' && typeof v !== 'boolean') throw new Error(`设置 ${key} 必须为布尔值`);
    if (key === 'theme' && (typeof v !== 'string' || !['light', 'dark', 'dawn'].includes(v))) throw new Error('颜色主题无效');
    if (key === 'nested' && (typeof v !== 'string' || !['indent', 'align', 'off'].includes(v))) throw new Error('嵌套模式无效');
    if (key === 'tagDisplay' && (typeof v !== 'string' || !['inline', 'block'].includes(v))) throw new Error('标签模式无效');
    if (key === 'layout' && (typeof v !== 'string' || !['auto', 'vertical', 'horizontal'].includes(v))) throw new Error('主题布局无效');
    Object.assign(out, { [key]: v });
  }
  return out;
}

/**
 * Load-time variant used when reading what is already stored. A value this build does not
 * understand (for example a theme added by a newer version and synced here) falls back to its
 * default instead of failing the whole load, which would also block every later write.
 * Writes keep using the strict validateSettings.
 */
export function readSettingsLenient(value: unknown): Settings {
  const out: Settings = { ...defaults };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  const incoming = value as Record<string, unknown>;
  for (const key of Object.keys(incoming)) {
    if (key === 'horizontal') {
      if ('layout' in incoming) continue;
    } else if (!(key in defaults)) {
      continue;
    }
    try {
      const single = validateSettings({ [key]: incoming[key] });
      if (key === 'horizontal') out.layout = single.layout;
      else (out as Record<string, unknown>)[key] = single[key as keyof Settings];
    } catch {
      // Keep the default for this key only.
    }
  }
  return out;
}
