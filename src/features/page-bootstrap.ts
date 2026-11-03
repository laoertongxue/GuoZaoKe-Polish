import type { AppState } from '../shared/state';
import type { Settings } from '../shared/settings';
import { installAdFilter } from './ads';

const nativeThemes = new WeakMap<HTMLElement, { theme: string; background: string; colorScheme: string }>();

export function applyPageAppearance(html: HTMLElement, settings: Settings, systemDark: boolean, syncNative = true) {
  html.classList.toggle('gzk-disabled', !settings.enabled);
  if (settings.enabled) html.dataset.gzkTheme = settings.autoTheme ? (systemDark ? 'dark' : 'light') : settings.theme;
  else delete html.dataset.gzkTheme;
  if (syncNative) {
    if (settings.enabled && html.hasAttribute('data-theme')) {
      if (!nativeThemes.has(html)) nativeThemes.set(html, { theme: html.dataset.theme!, background: html.style.backgroundColor, colorScheme: html.style.colorScheme });
      html.dataset.theme = html.dataset.gzkTheme === 'dark' ? 'dark' : 'light';
      html.style.backgroundColor = 'var(--gzp-bg)';
      html.style.colorScheme = html.dataset.theme;
    } else if (!settings.enabled && nativeThemes.has(html)) {
      const native = nativeThemes.get(html)!;
      html.dataset.theme = native.theme; html.style.backgroundColor = native.background; html.style.colorScheme = native.colorScheme;
      nativeThemes.delete(html);
    }
    const dark = html.dataset.theme === 'dark';
    html.querySelectorAll<HTMLElement>('[data-gzk-theme-toggle]').forEach(button => {
      button.setAttribute('aria-checked', String(dark)); button.title = dark ? '关闭夜间模式' : '打开夜间模式';
    });
    const themeColor = html.querySelector<HTMLMetaElement>('#gzk-theme-color');
    if (themeColor) themeColor.content = dark ? '#17232d' : '#f7f7f7';
    const notice = html.querySelector<HTMLElement>('#gzk-night-notice');
    if (notice) notice.hidden = !dark;
  }
  for (const [name, on] of Object.entries({compact: settings.compact, 'hide-ads': settings.hideAds, 'hide-time': settings.hideReplyTime, 'hide-mention': settings.hideRefName, 'hide-account': settings.hideAccount, 'image-preview': settings.imagePreview})) {
    html.classList.toggle(`gzk-${name}`, settings.enabled && on);
  }
}

// Native storage events can apply a different theme after our initial mount.
export function watchNativeTheme(html: HTMLElement, refresh: () => void) {
  const observer = new MutationObserver(() => {
    if (!html.dataset.gzkTheme || !html.hasAttribute('data-theme')) return;
    const expected = html.dataset.gzkTheme === 'dark' ? 'dark' : 'light';
    if (html.dataset.theme === expected && html.style.backgroundColor === 'var(--gzp-bg)' && html.style.colorScheme === expected) return;
    nativeThemes.delete(html);
    refresh();
  });
  observer.observe(html, { attributes: true, attributeFilter: ['data-theme', 'style'] });
  return () => observer.disconnect();
}

// Runs at document_start. Do not display the native DOM while waiting for saved
// preferences and the initial DOM adaptation. A failed extension must fail open.
export function bootstrapPage(load: () => Promise<AppState>, mount: (state: AppState) => Promise<void>) {
  const ads = installAdFilter();
  let released = false, disposed = false, state: AppState | undefined;
  const restore = () => { if (state && document.documentElement) applyPageAppearance(document.documentElement, { ...state.settings, enabled: false }, false); };
  const guard = () => { if (!released) document.documentElement?.setAttribute('data-gzk-booting', ''); };
  guard();
  const rootObserver = new MutationObserver(() => { guard(); if (document.documentElement) rootObserver.disconnect(); });
  if (!document.documentElement) rootObserver.observe(document, { childList: true });
  function release() { released = true; document.documentElement?.removeAttribute('data-gzk-booting'); rootObserver.disconnect(); }
  const timeout = setTimeout(release, 1500);
  let domReady = () => {};
  const dom = document.readyState !== 'loading' ? Promise.resolve() : new Promise<void>(resolve => {
    domReady = resolve; document.addEventListener('DOMContentLoaded', domReady, { once: true });
  });
  const ready = (async () => {
    try {
      state = await load();
      if (disposed) return;
      if (document.documentElement) applyPageAppearance(document.documentElement, state.settings, matchMedia('(prefers-color-scheme: dark)').matches, false);
      if (!state.settings.enabled) release();
      await dom;
      if (!disposed) await mount(state);
    } catch (error) { ads.destroy(); restore(); throw error; }
    finally { clearTimeout(timeout); release(); }
  })();
  return { ready, destroy() { disposed = true; ads.destroy(); restore(); clearTimeout(timeout); release(); document.removeEventListener('DOMContentLoaded', domReady); domReady(); } };
}
