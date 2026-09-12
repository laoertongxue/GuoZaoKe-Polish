import { browser } from 'wxt/browser';
import { parseAccount, parseHotTopics, parseMember, parseNotices, parseTopic, parseTopics } from './parse';
import { readableUrl } from './urls';
export async function fetchDocument(url: string): Promise<Document> {
  const response=await browser.runtime.sendMessage({type:'site:get',url:readableUrl(url)});
  if (!response?.ok) throw new Error(response?.error||'读取过早客失败');
  return new DOMParser().parseFromString(response.data,'text/html');
}
export async function fetchTopics(mode:'hot'|'latest') {
  const doc=await fetchDocument(mode==='latest'?'/?tab=latest':'/');
  const topics=mode==='hot'?parseHotTopics(doc):parseTopics(doc);
  if (!topics.length) throw new Error('暂时无法读取主题列表，请重试');
  return topics;
}
export async function fetchAccount() { return parseAccount(await fetchDocument('/')); }
export async function fetchNotices() {
  const doc=await fetchDocument('/notifications');
  if (!parseAccount(doc).username) throw new Error('请先登录过早客后重试');
  return parseNotices(doc);
}
export async function fetchTopic(url: string) { return parseTopic(await fetchDocument(url),url); }
export async function fetchMember(username: string) { return parseMember(await fetchDocument(`/u/${encodeURIComponent(username)}`),username); }
