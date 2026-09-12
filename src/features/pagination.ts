import { el } from '../shared/ui';

function pageWindow(current: number, total: number, count: number) {
  const start = Math.max(1, Math.min(current - Math.floor((count - 1) / 2), total - count + 1));
  return [...new Set([1, ...Array.from({ length: Math.min(count, total) }, (_, i) => start + i), total])].sort((a, b) => a - b);
}

// Enhance the original pagination, retaining its URLs and nodes so native
// handlers and reply-preload markers survive. Disabling restores the same DOM.
export function enhancePagination(enabled: boolean) {
  const narrow = matchMedia('(max-width:767px)');
  const small = matchMedia('(max-width:359px)');
  const medium = matchMedia('(min-width:992px) and (max-width:1199px)');
  const queries = [narrow, small, medium];
  const controllers = [...document.querySelectorAll<HTMLUListElement>('ul.pagination')].flatMap(list => {
    const items = [...list.children].filter((node): node is HTMLLIElement => node instanceof HTMLLIElement);
    const numbered = items.flatMap(item => {
      const link = item.querySelector<HTMLAnchorElement>('a');
      const value = Number(link?.textContent?.trim());
      return link && Number.isSafeInteger(value) && value > 0 ? [{ item, link, value }] : [];
    });
    const current = numbered.find(({ item }) => item.classList.contains('active'))?.value;
    const total = Math.max(...numbered.map(({ value }) => value));
    const template = numbered.flatMap(({ link, value }) => {
      try {
        const url = new URL(link.getAttribute('href') || '', location.href);
        return url.origin === location.origin && url.searchParams.get('p') === String(value) ? [url] : [];
      } catch { return []; }
    })[0];
    if (!current || !template || !Number.isSafeInteger(total)) return [];
    const originalNodes = [...list.childNodes];
    const previous = items.find(item => item.textContent?.trim() === '上一页');
    const next = items.find(item => item.textContent?.trim() === '下一页');
    const attributes = new Map<Element, Map<string, string | null>>();
    const arrowContents = [previous, next].flatMap(item => {
      const link = item?.querySelector('a'); return link ? [{ link, children: [...link.childNodes] }] : [];
    });
    const set = (node: Element, name: string, value: string | null) => {
      if (!attributes.has(node)) attributes.set(node, new Map());
      const saved = attributes.get(node)!;
      if (!saved.has(name)) saved.set(name, node.getAttribute(name));
      if (value === null) node.removeAttribute(name); else node.setAttribute(name, value);
    };
    const addClass = (node: Element, name: string) => set(node, 'class', `${node.getAttribute('class') || ''} ${name}`.trim());
    const nav = list.closest('nav');
    const mobile = nav?.nextElementSibling?.matches('.pagination-wap') ? nav.nextElementSibling : null;
    let rendered = false;
    const restore = () => {
      if (!rendered) return;
      list.replaceChildren(...originalNodes);
      arrowContents.forEach(({ link, children }) => link.replaceChildren(...children));
      for (const [node, attrs] of attributes) for (const [name, value] of attrs) {
        if (value === null) node.removeAttribute(name); else node.setAttribute(name, value);
      }
      attributes.clear(); rendered = false;
    };
    function href(page: number) {
      const url = new URL(template!.href); url.searchParams.set('p', String(page));
      return `${url.pathname}${url.search}${url.hash}`;
    }
    function render() {
      restore(); if (!enabled) return; rendered = true;
      addClass(list, 'gzk-pagination'); set(list, 'aria-label', '分页');
      if (nav) addClass(nav, 'gzk-pagination-nav');
      if (mobile) addClass(mobile, 'gzk-pagination-mobile');
      const nodes: HTMLElement[] = [];
      let last = 0;
      for (const page of pageWindow(current!, total, small.matches ? 1 : narrow.matches ? 3 : medium.matches ? 7 : 10)) {
        if (last && page > last + 1) {
          const gap = el('li', '…', 'gzk-page-ellipsis'); gap.setAttribute('aria-hidden', 'true'); nodes.push(gap);
        }
        const original = numbered.find(item => item.value === page);
        const item = original?.item || el('li');
        const link = original?.link || el('a', String(page));
        if (!original) { link.href = href(page); item.append(link); }
        set(item, 'data-page', String(page));
        set(link, 'aria-label', `第 ${page} 页`);
        if (page === current) { set(link, 'aria-current', 'page'); set(link, 'tabindex', '-1'); set(link, 'href', null); }
        nodes.push(item); last = page;
      }
      for (const [direction, original, page, disabled] of [
        ['prev', previous, current! - 1, current === 1],
        ['next', next, current! + 1, current === total],
      ] as const) {
        const item = original || el('li'); const link = item.querySelector('a') || el('a');
        if (!link.parentElement) item.append(link);
        const label = direction === 'prev' ? '上一页' : '下一页';
        addClass(item, `gzk-page-${direction}`); set(link, 'aria-label', label); set(link, 'title', label);
        link.replaceChildren(el('span', direction === 'prev' ? '❮' : '❯'));
        link.firstElementChild!.setAttribute('aria-hidden', 'true');
        if (disabled) { addClass(item, 'disabled'); set(link, 'href', null); set(link, 'aria-disabled', 'true'); set(link, 'tabindex', '-1'); }
        else if (!original) link.href = href(page);
        nodes.push(item);
      }
      list.replaceChildren(...nodes);
    }
    return [{ render, restore }];
  });
  const render = () => controllers.forEach(controller => controller.render());
  render(); queries.forEach(query => query.addEventListener('change', render));
  return {
    update(active: boolean) { if (enabled !== active) { enabled = active; render(); } },
    destroy() { queries.forEach(query => query.removeEventListener('change', render)); controllers.forEach(controller => controller.restore()); },
  };
}
