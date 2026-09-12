import type { Settings } from './settings';

/** Build extension UI with text nodes; site and imported strings never become HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function button(label: string, className = 'button', onClick?: () => void): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

const paths: Record<string, string> = {
  sliders: 'M4 7h8m4 0h4M4 17h4m4 0h8M12 4v6M8 14v6',
  tag: 'M20 13l-7 7-10-10V3h7l10 10zM7 7h.01',
  archive: 'M4 8h16v13H4zM3 3h18v5H3zM9 12h6',
  info: 'M12 8h.01M12 11v6M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  settings: 'M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2 1-4zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  book: 'M4 4h6l2 2 2-2h6v16h-6l-2 2-2-2H4zM12 6v16',
  check: 'M5 12l4 4L19 6',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  external: 'M14 3h7v7M21 3l-11 11M10 3H3v18h18v-7',
  download: 'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5',
  upload: 'M12 16V4M7 9l5-5 5 5M4 17v4h16v-4',
  refresh: 'M20 7a9 9 0 1 0 1 9M20 3v5h-5',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  edit: 'M14 5l5 5M3 21l2-7L17 2l5 5L10 19l-7 2z',
  sun: 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
  moon: 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11z',
  sunrise: 'M3 17h18M5 21h14M12 3v3M3 9l2 2M21 9l-2 2M7 17a5 5 0 0 1 10 0',
  bell: 'M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10M9 21h6',
  top: 'M5 10l7-7 7 7M12 3v18',
  heart: 'M12 20l-8-8C-2 5 7 0 12 7c5-7 14-2 8 5z',
  reply: 'M9 4L3 10l6 6M3 10h9c6 0 9 3 9 10',
  image: 'M3 3h18v18H3zM3 17l6-6 5 5 3-3 4 4M16 7h.01',
  horizontal: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
  vertical: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4',
  plus: 'M12 4v16M4 12h16',
};

export function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', name === 'more' ? '3.5' : '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name] ?? paths.info!);
  svg.append(path);
  return svg;
}

export function iconButton(label: string, name: string, onClick: () => void): HTMLButtonElement {
  const node = button('', 'icon-button', onClick);
  node.title = label;
  node.setAttribute('aria-label', label);
  node.append(icon(name));
  return node;
}

export function link(label: string, url: string, className = ''): HTMLAnchorElement {
  const node = el('a', className, label);
  // Extension pages only navigate to web pages, never executable URLs from a backup.
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') node.href = parsed.href;
  } catch { /* Invalid imported URL is left as plain text. */ }
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请重试';
}

export function applyTheme(settings: Settings): void {
  const dark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = settings.autoTheme ? (dark ? 'dark' : 'light') : settings.theme;
}

export function watchSystemTheme(getSettings: () => Settings | undefined): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => { const settings = getSettings(); if (settings) applyTheme(settings); };
  query.addEventListener('change', update);
  return () => query.removeEventListener('change', update);
}

export function emptyState(title: string, description: string, name = 'book'): HTMLDivElement {
  const node = el('div', 'empty-state');
  const symbol = el('div', 'empty-symbol');
  symbol.append(icon(name));
  node.append(symbol, el('h3', '', title), el('p', '', description));
  return node;
}
