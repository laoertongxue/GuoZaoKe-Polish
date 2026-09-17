import { browser } from 'wxt/browser';
import { parseReplies } from '../site/parse';
import { topicUrl } from '../site/urls';
import { el, button, icon } from '../shared/app-ui';

export function installAnalysisEntry(url: string) {
  const currentTopic = topicUrl(url); let disposed = false; let enabled = true;
  const entry = button('', 'gzk-button'); entry.append(icon('book'), el('span', '', '讨论分析'));
  entry.disabled = true;
  // Prepare without opening a UI or making a model call; only an explicit click requests automatic analysis.
  void (async () => {
    try {
      const response = await browser.runtime.sendMessage({ type: 'analysis:panel:prepare', url: currentTopic });
      if (!response?.ok) throw new Error();
    } catch { if (!disposed) entry.title = '侧栏暂不可用，点击打开本帖分析工作区'; }
    finally { if (!disposed) entry.disabled = false; }
  })();
  entry.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || !enabled || entry.disabled) return;
    entry.disabled = true;
    try {
      try {
        const response = await browser.runtime.sendMessage({ type: 'analysis:panel:open', url: currentTopic, start: true });
        if (!response?.ok) throw new Error();
      } catch {
        const response = await browser.runtime.sendMessage({ type: 'analysis:open', url: currentTopic, start: true });
        if (!response?.ok) throw new Error();
      }
    } catch { entry.title = '分析页面未能打开，请重新加载扩展后刷新本帖'; }
    finally { if (!disposed) entry.disabled = false; }
  });
  const locate = () => {
    const id = location.hash.match(/^#gzk-reply-(\d+)$/)?.[1]; if (!id) return;
    const reply = parseReplies(document).find(r => r.id === id); if (!reply) return;
    reply.element.scrollIntoView({ block: 'center', behavior: 'smooth' }); reply.element.tabIndex = -1; reply.element.focus({ preventScroll: true });
  };
  window.addEventListener('hashchange', locate); locate();
  return { entry, update(value: boolean) { enabled = value; entry.hidden = !value; }, destroy() { disposed = true; entry.remove(); window.removeEventListener('hashchange', locate); } };
}
