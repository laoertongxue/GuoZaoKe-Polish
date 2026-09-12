import { browser } from 'wxt/browser';
import type { TopicDetail } from '../shared/types';
export async function shareImage(topic: TopicDetail) {
  const result = await browser.runtime.sendMessage({ type: 'share:open', url: topic.url });
  if (!result?.ok) throw new Error(result?.error || '无法打开分享页面');
}
