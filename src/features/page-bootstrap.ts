import type { AppState } from '../shared/state';
import type { Settings } from '../shared/settings';

export function applyPageAppearance(html: HTMLElement, settings: Settings, systemDark: boolean) {
  html.classList.toggle('gzk-disabled', !settings.enabled);
  if (settings.enabled) html.dataset.gzkTheme = settings.autoTheme ? (systemDark ? 'dark' : 'light') : settings.theme;
  else delete html.dataset.gzkTheme;
  for (const [name, on] of Object.entries({compact: settings.compact, 'hide-time': settings.hideReplyTime, 'hide-mention': settings.hideRefName, 'hide-account': settings.hideAccount, 'image-preview': settings.imagePreview})) {
    html.classList.toggle(`gzk-${name}`, settings.enabled && on);
  }
}

// Runs at document_start. Do not display the native DOM while waiting for saved
// preferences and the initial DOM adaptation. A failed extension must fail open.
export function bootstrapPage(load: () => Promise<AppState>, mount: (state: AppState) => Promise<void>) {
  let released = false, disposed = false;
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
      const state = await load();
      if (disposed) return;
      if (document.documentElement) applyPageAppearance(document.documentElement, state.settings, matchMedia('(prefers-color-scheme: dark)').matches);
      if (!state.settings.enabled) release();
      await dom;
      if (!disposed) await mount(state);
    } finally { clearTimeout(timeout); release(); }
  })();
  return { ready, destroy() { disposed = true; clearTimeout(timeout); release(); document.removeEventListener('DOMContentLoaded', domReady); domReady(); } };
}
