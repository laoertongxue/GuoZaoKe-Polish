import type { Account, MemberInfo, Reply, Topic, TopicDetail, Notice } from '../shared/types';
import { ORIGIN, safeLink, topicUrl, readableUrl } from './urls';
const txt = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.trim() || '';
const avatar = (root: ParentNode) => safeLink(root.querySelector('img.avatar')?.getAttribute('src') || '');
export function parseTopics(doc: Document): Topic[] {
  return [...doc.querySelectorAll('.topic-item')].flatMap(el => {
    const link = el.querySelector<HTMLAnchorElement>('.title a[href]');
    if (!link) return [];
    try {
      const url = topicUrl(link.getAttribute('href')!);
      return [{id: url.split('/').pop()!, url, title: link.textContent?.trim() || '', author:txt(el,'.meta .username'), avatar:avatar(el),node:txt(el,'.node'),replies:Number(txt(el,'.count')) || 0,time:txt(el,'.last-touched')}];
    } catch { return []; }
  });
}
export function parseHotTopics(doc: Document): Topic[] {
  return [...doc.querySelectorAll('.hot-topics .cell')].flatMap(el => {
    const link = el.querySelector<HTMLAnchorElement>('.hot_topic_title a');
    if (!link) return [];
    try { const url=topicUrl(link.getAttribute('href')!); return [{id:url.split('/').pop()!,url,title:link.textContent?.trim()||'',author:el.querySelector('a[href^="/u/"]')?.getAttribute('href')?.split('/')[2]||'',avatar:avatar(el),node:'今日热议',replies:0,time:''}]; } catch { return []; }
  });
}
export function parseTopic(doc: Document, value: string): TopicDetail {
  const root = doc.querySelector('.topic-detail');
  if (!root) throw new Error(doc.querySelector('form[action="/login"]') ? '请先登录过早客后重试' : '未找到主题正文，页面可能已删除或需要登录');
  const url=topicUrl(value), content=root.querySelector(':scope > .ui-content');
  return { id:url.split('/').pop()!, url, title:txt(root,'.title'), author:txt(root,'.meta .username'), avatar:avatar(root),node:txt(root,'.node'), replies:Number(txt(doc,'.topic-reply > .ui-header').match(/(\d+)\s*条回复/)?.[1])||0,time:txt(root,'.created-time'),html:content?.innerHTML||'',text:content?.textContent?.trim()||'' };
}
export function parseReplies(doc: Document): Reply[] {
  return [...doc.querySelectorAll<HTMLElement>('.topic-reply .reply-item')].flatMap((el,index) => {
    const content = el.querySelector(':scope > .main > .content');
    const vote=el.querySelector<HTMLAnchorElement>(':scope > .main > .meta .J_replyVote');
    const floorEl = [...el.querySelectorAll(':scope > .main > .meta .floor')].find(e => /^#\d+$/.test(e.textContent?.trim()||''));
    const floor = Number(floorEl?.textContent?.trim().slice(1)) || index+1;
    const author=txt(el,':scope > .main > .meta .reply-username');
    if (!content || !author) return [];
    const text=content.textContent?.trim()||'';
    const mentions=[...new Set([...content.querySelectorAll('a[href*="/u/"]')].filter(a=>a.textContent?.trim().startsWith('@')).map(a=>(a.getAttribute('href')||'').split('/u/')[1]?.split(/[?#/]/)[0]||'').filter(Boolean))];
    return [{id:vote?.getAttribute('href')?.match(/reply_id=(\d+)/)?.[1]||`floor-${floor}`,floor,author,avatar:avatar(el),html:content.innerHTML,text,likes:Number(vote?.dataset.count)||0,mentions,references:[...text.matchAll(/(?:^|[\s，,])#(\d+)\b/g)].map(m=>Number(m[1])),element:el}];
  });
}
export function parseMember(doc: Document, username: string): MemberInfo {
  const root=doc.querySelector('.profile');
  if (!root) throw new Error('未找到用户信息');
  const about=[...root.querySelectorAll('dl')].filter(el=>['昵称','签名','个人简介','所在地','网站'].includes(txt(el,'dt'))).map(el=>`${txt(el,'dt')}：${txt(el,'dd')}`);
  return {username:txt(root,'.username')||username,avatar:avatar(root),description:[txt(root,'.user-number'),...about].join('\n'),url:`${ORIGIN}/u/${encodeURIComponent(username)}`};
}
export function parseAccount(doc: Document): Account {
  const user=doc.querySelector('.navbar-right a[href^="/u/"]')?.getAttribute('href')?.split('/')[2]||'';
  const unread=Number(doc.querySelector('a.notification-indicator')?.getAttribute('title')?.match(/(\d+)\s*条未读/)?.[1])||0;
  return {username:user,unread};
}
export function parseNotices(doc: Document): Notice[] {
  // Verified against the signed-in /notifications page on 2026-09-12.
  return [...doc.querySelectorAll('.notification-item')].map(el=>({text:el.textContent?.trim()||'',url:safeLink(el.querySelector('a[href*="/t/"]')?.getAttribute('href')||'/notifications')}));
}
export function replyPages(doc: Document, current: string): string[] {
  const topic=topicUrl(current);
  return [...new Set([...doc.querySelectorAll<HTMLAnchorElement>('.pagination a[href]')].flatMap(a=>{
    try { const url=readableUrl(new URL(a.getAttribute('href')!,current).href); return topicUrl(url)===topic && url!==readableUrl(current)?[url]:[]; } catch {return [];}
  }))].sort((a,b)=>Number(new URL(a).searchParams.get('p')||new URL(a).searchParams.get('page')||1)-Number(new URL(b).searchParams.get('p')||new URL(b).searchParams.get('page')||1));
}
