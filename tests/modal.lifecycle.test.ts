import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { el, modal, overlayHost, toast } from '../src/shared/ui';

const views: ReturnType<typeof modal>[] = [];
const open = () => { const view = modal('测试弹窗'); views.push(view); return view; };
const pointer = (target: Element, type: string, x: number, y: number, options: PointerEventInit = {}) => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, ...options }));
};

beforeEach(() => {
  document.body.innerHTML = '<button id="opener">打开</button>';
  document.body.removeAttribute('style');
  document.querySelector<HTMLButtonElement>('#opener')!.focus();
  // jsdom does not implement the native dialog APIs. Keep their close event asynchronous.
  HTMLDialogElement.prototype.showModal = function () { this.open = true; this.querySelector<HTMLElement>('button')?.focus(); };
  HTMLDialogElement.prototype.close = function () {
    if (!this.open) return;
    this.open = false;
    queueMicrotask(() => this.dispatchEvent(new Event('close')));
  };
});
afterEach(async () => {
  views.splice(0).reverse().forEach(view => view.close());
  await Promise.resolve();
  document.body.replaceChildren();
  document.body.removeAttribute('style');
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('modal scroll ownership', () => {
  it('locks the page while open and restores original overflow values and priorities without replacing other styles', () => {
    document.body.style.cssText = 'overflow: auto !important; overflow-x: scroll; overflow-y: visible !important; color: red;';
    const view = open();
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
    document.body.style.color = 'blue';
    view.close();
    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
    expect(document.body.style.overflowX).toBe('scroll');
    expect(document.body.style.getPropertyPriority('overflow-x')).toBe('');
    expect(document.body.style.overflowY).toBe('visible');
    expect(document.body.style.getPropertyPriority('overflow-y')).toBe('important');
    expect(document.body.style.color).toBe('blue');
  });

  it('does not leave an overflow override when the page had none', () => {
    const view = open();
    expect(document.body.style.overflow).toBe('hidden');
    view.close();
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.overflowX).toBe('');
    expect(document.body.style.overflowY).toBe('');
  });

  it.each(['outer-first', 'inner-first'])('keeps nested dialogs locked until the final dialog closes (%s)', order => {
    document.body.style.setProperty('overflow-y', 'scroll', 'important');
    const outer = open(), inner = open();
    const [first, last] = order === 'outer-first' ? [outer, inner] : [inner, outer];
    first.close();
    first.close();
    expect(document.body.style.overflow).toBe('hidden');
    last.close();
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.overflowY).toBe('scroll');
    expect(document.body.style.getPropertyPriority('overflow-y')).toBe('important');
  });

  it('cleans up the overlay and lock when native showModal fails', () => {
    HTMLDialogElement.prototype.showModal = function () { throw new Error('Cannot open dialog'); };
    expect(open).toThrow('Cannot open dialog');
    expect(document.querySelector('.gzk-overlay-host')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('modal backdrop gestures', () => {
  const setup = () => {
    const view = open();
    vi.spyOn(view.dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 400, top: 100, bottom: 300 } as DOMRect);
    return view;
  };

  it('keeps the dialog open after dragging from content onto the backdrop', () => {
    const view = setup();
    pointer(view.body, 'pointerdown', 200, 200);
    pointer(view.dialog, 'pointerup', 20, 20);
    view.dialog.dispatchEvent(new MouseEvent('click', { clientX: 20, clientY: 20, bubbles: true }));
    expect(view.dialog.open).toBe(true);
  });

  it('closes only when the same primary pointer starts and ends on the backdrop', () => {
    const view = setup();
    pointer(view.dialog, 'pointerdown', 20, 20);
    pointer(view.body, 'pointerup', 200, 200);
    expect(view.dialog.open).toBe(true);
    pointer(view.dialog, 'pointerdown', 20, 20);
    pointer(view.dialog, 'pointerup', 25, 25);
    expect(view.dialog.open).toBe(false);
    expect(view.host.isConnected).toBe(false);
  });

  it('ignores cancelled, secondary and mismatched pointers', () => {
    const view = setup();
    pointer(view.dialog, 'pointerdown', 20, 20);
    pointer(view.dialog, 'pointercancel', 20, 20);
    pointer(view.dialog, 'pointerup', 20, 20);
    expect(view.dialog.open).toBe(true);
    pointer(view.dialog, 'pointerdown', 20, 20, { button: 2 });
    pointer(view.dialog, 'pointerup', 20, 20, { button: 2 });
    expect(view.dialog.open).toBe(true);
    pointer(view.dialog, 'pointerdown', 20, 20);
    pointer(view.dialog, 'pointerup', 20, 20, { pointerId: 2 });
    expect(view.dialog.open).toBe(true);
  });

  it('does not treat empty dialog space as the backdrop', () => {
    const view = setup();
    pointer(view.dialog, 'pointerdown', 200, 200);
    pointer(view.dialog, 'pointerup', 200, 200);
    expect(view.dialog.open).toBe(true);
  });

  it('does not dismiss on synthetic pointer releases with no pointer ID or press', () => {
    const view = setup();
    const event = new MouseEvent('pointerup', { bubbles: true, clientX: 20, clientY: 20, button: 0 });
    Object.defineProperty(event, 'isPrimary', { value: true });
    view.dialog.dispatchEvent(event);
    expect(view.dialog.open).toBe(true);
  });
});

describe('modal dismissal and focus', () => {
  it('Escape cancellation removes the overlay and immediately restores the invoker and scroll', () => {
    const invoker = document.activeElement;
    const view = open();
    view.dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(view.dialog.open).toBe(false);
    expect(view.host.isConnected).toBe(false);
    expect(document.activeElement).toBe(invoker);
    expect(document.body.style.overflow).toBe('');
  });

  it('restores the actual invoker through nested shadow roots', () => {
    const host = el('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const innerHost = el('div'); root.append(innerHost);
    const innerRoot = innerHost.attachShadow({ mode: 'open' });
    const invoker = el('button', '嵌套入口'); innerRoot.append(invoker); invoker.focus();
    const view = open();
    view.close();
    expect(innerRoot.activeElement).toBe(invoker);
  });

  it('restores focus inside the parent dialog before returning to the page opener', () => {
    const opener = document.activeElement;
    const outer = open();
    const invoker = el('button', '打开子弹窗'); outer.body.append(invoker); invoker.focus();
    const inner = open();
    inner.close();
    expect(outer.root.activeElement).toBe(invoker);
    outer.close();
    expect(document.activeElement).toBe(opener);
  });

  it('closing a covered dialog does not steal focus from the top dialog', () => {
    const outer = open(), inner = open();
    const focused = inner.root.activeElement;
    outer.close();
    expect(inner.root.activeElement).toBe(focused);
  });

  it('native close events use the same cleanup without restoring focus twice', async () => {
    const invoker = document.activeElement as HTMLElement;
    const focus = vi.spyOn(invoker, 'focus');
    const view = open();
    view.dialog.close();
    await Promise.resolve();
    expect(view.host.isConnected).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(focus).toHaveBeenCalledTimes(1);
    view.close();
    await Promise.resolve();
    expect(focus).toHaveBeenCalledTimes(1);
  });
});

describe('toast ownership', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('places feedback inside the top dialog and removes only the toast after four seconds', () => {
    const outer = open(), inner = open();
    toast('复制成功');
    const message = inner.dialog.querySelector('[role=status]');
    expect(message?.textContent).toBe('复制成功');
    expect(outer.dialog.querySelector('.toast')).toBeNull();
    expect(document.querySelectorAll('.gzk-overlay-host')).toHaveLength(2);
    vi.advanceTimersByTime(3999);
    expect(message?.isConnected).toBe(true);
    vi.advanceTimersByTime(1);
    expect(message?.isConnected).toBe(false);
    expect(inner.host.isConnected).toBe(true);
    expect(inner.dialog.open).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses and cleans up a standalone overlay when no dialog is open', () => {
    toast('复制失败', true);
    const host = document.querySelector('.gzk-overlay-host')!;
    expect(host.shadowRoot?.querySelector('[role=alert]')?.textContent).toBe('复制失败');
    vi.advanceTimersByTime(4000);
    expect(host.isConnected).toBe(false);
    expect(document.querySelector('.gzk-overlay-host')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('supports open image preview dialogs outside the shared modal helper', () => {
    const outer = open();
    const preview = overlayHost();
    const dialog = el('dialog', '', 'image-preview');
    preview.root.append(dialog); dialog.showModal();
    toast('图片操作成功');
    expect(dialog.querySelector('.toast')?.textContent).toBe('图片操作成功');
    expect(outer.dialog.querySelector('.toast')).toBeNull();
    vi.advanceTimersByTime(4000);
    expect(preview.host.isConnected).toBe(true);
    expect(dialog.open).toBe(true);
  });

  it('excludes closed dialogs even before their native close cleanup event runs', () => {
    const view = open();
    view.dialog.close();
    toast('已保存');
    expect(view.dialog.querySelector('.toast')).toBeNull();
    const hosts = [...document.querySelectorAll('.gzk-overlay-host')];
    expect(hosts.at(-1)?.shadowRoot?.querySelector('.toast')?.textContent).toBe('已保存');
    vi.advanceTimersByTime(4000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
