import { browser } from 'wxt/browser';
import { fetchTopic } from '../../src/site/client';
import { topicUrl, ORIGIN } from '../../src/site/urls';
import { mountShareWorkspace } from '../../src/features/share-card';
import { button, el } from '../../src/shared/ui';
import type { ShareImageResult } from '../../src/site/share-images';
const root = document.getElementById('app')!;
let cleanup: (() => void) | undefined;
async function load() {
  cleanup?.(); root.className=''; root.textContent = '正在读取主题…';
  try {
    const id = new URL(location.href).searchParams.get('topic');
    if (!id || !/^\d+$/.test(id)) throw new Error('请从过早客主题页面点击「分享图片」。');
    const topic = await fetchTopic(topicUrl(`${ORIGIN}/t/${id}`));
    cleanup = await mountShareWorkspace(root, topic, {
      readImage: async url => { const result = await browser.runtime.sendMessage({ type: 'share:image', url }); if (!result?.ok) throw new Error(result?.error || '读取分享图片失败'); return result.data as ShareImageResult; },
      authorize: origins => browser.permissions.request({ origins }),
    });
  } catch (error) { root.replaceChildren(el('p', error instanceof Error ? error.message : '无法读取主题'), button('重试', load)); root.className = 'share-error'; }
}
void load(); window.addEventListener('pagehide', () => cleanup?.(), { once: true });
