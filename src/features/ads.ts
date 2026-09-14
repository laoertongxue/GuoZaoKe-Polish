// AdSense writes inline !important styles and places its grip in a closed
// shadow root. Hide the host/slot itself and remember only the display property
// we own; never remove nodes or overwrite the ad's other live styles.
const adSelector = [
  'ins.adsbygoogle', '.google-auto-placed', '.google-side-rail', '.grippy-host',
  'div[id^="aswift_"][id$="_host"]', 'iframe[id^="aswift_"]',
  'iframe[id^="google_ads_iframe_"]',
  'iframe[src^="https://googleads.g.doubleclick.net/pagead/"]',
  'iframe[src^="https://tpc.googlesyndication.com/"]',
].join(',');
const anchorSelector = 'ins.adsbygoogle[data-anchor-status],.grippy-host';

export function installAdFilter() {
  const saved = new Map<HTMLElement, { value: string; priority: string }>();
  let active = false;
  let body: HTMLElement | null = null;
  let padding = { top: '0px', bottom: '0px' };
  let anchored = false;

  function rememberBody() {
    if (body || !document.body) return;
    body = document.body;
    // Normally captured at document_start, before ads execute. If an anchor
    // already exists, its padding is contaminated: Guozaoke's native body has
    // zero vertical padding. Do not infer a baseline from the ad's dimensions.
    if (!document.querySelector(anchorSelector)) {
      const style = getComputedStyle(body);
      padding = { top: style.paddingTop || '0px', bottom: style.paddingBottom || '0px' };
    }
  }
  function restore(element: HTMLElement) {
    const original = saved.get(element);
    if (!original) return;
    if (element.style.getPropertyValue('display') === 'none' && element.style.getPropertyPriority('display') === 'important') {
      if (original.value) element.style.setProperty('display', original.value, original.priority);
      else element.style.removeProperty('display');
      if (!element.getAttribute('style')) element.removeAttribute('style');
    }
    saved.delete(element);
  }
  function reconcile(element: Element) {
    if (!(element instanceof HTMLElement)) return;
    if (!active || !element.matches(adSelector)) { restore(element); return; }
    if (!anchored && element.matches(anchorSelector)) {
      anchored = true;
      const html = document.documentElement;
      html.style.setProperty('--gzk-ad-padding-top', padding.top);
      html.style.setProperty('--gzk-ad-padding-bottom', padding.bottom);
      html.setAttribute('data-gzk-ad-anchor', '');
    }
    const value = element.style.getPropertyValue('display');
    const priority = element.style.getPropertyPriority('display');
    if (value === 'none' && priority === 'important') return;
    // Track the latest display the ad requests, including a late refresh.
    saved.set(element, { value, priority });
    element.style.setProperty('display', 'none', 'important');
  }
  function scan(root: ParentNode) {
    if (root instanceof Element) reconcile(root);
    root.querySelectorAll(adSelector).forEach(reconcile);
  }
  function clear() {
    saved.forEach((_original, element) => restore(element));
    anchored = false;
    const html = document.documentElement;
    html?.removeAttribute('data-gzk-ad-anchor');
    html?.style.removeProperty('--gzk-ad-padding-top');
    html?.style.removeProperty('--gzk-ad-padding-bottom');
  }
  const observer = new MutationObserver(records => {
    rememberBody();
    const enabled = document.documentElement?.classList.contains('gzk-hide-ads') ?? false;
    if (active !== enabled) {
      active = enabled;
      if (active) scan(document); else clear();
      return;
    }
    if (!active) return;
    // Inspect only changed elements/subtrees, not the whole page on every
    // reply, animation or unrelated extension mutation.
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) reconcile(record.target);
      for (const node of record.addedNodes) if (node instanceof Element) scan(node);
    }
    saved.forEach((_original, element) => { if (!element.isConnected) restore(element); });
  });
  rememberBody();
  active = document.documentElement?.classList.contains('gzk-hide-ads') ?? false;
  if (active) scan(document);
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'id', 'src', 'style', 'data-anchor-status'] });
  return { destroy() { observer.disconnect(); active = false; clear(); } };
}
