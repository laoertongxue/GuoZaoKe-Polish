import { parseReplies, parseTopic, replyPages } from '../site/parse';
import { readableUrl, safeLink, topicUrl } from '../site/urls';
import { hashValue, validateSnapshot } from './contracts';
import type { Snapshot, TextSpan, ThreadMessage } from './types';

interface CaptureOptions {
  fetchPage?: (url: string, signal?: AbortSignal) => Promise<Document>;
  maxPages?: number; maxMessages?: number; signal?: AbortSignal;
  identities?: Record<string, string>; now?: () => string;
}

function contentOf(element: Element | null, base: string) {
  const clone = element?.cloneNode(true) as Element | undefined;
  if (!clone) return { text: '', links: [], imageCount: 0 };
  clone.querySelectorAll('script,style,textarea,input,button,[contenteditable="true"],[class*="gzk-"],.reply-item').forEach(node => node.remove());
  // Preserve line boundaries that textContent alone loses. Do not turn image alt text into verified text.
  clone.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  clone.querySelectorAll('p,div,li,blockquote,pre,tr,h1,h2,h3,h4').forEach(node => node.append('\n'));
  const links = [...clone.querySelectorAll<HTMLAnchorElement>('a[href]')].flatMap(a => {
    const url = safeLink(a.getAttribute('href') || '', base);
    return url ? [{ url, label: a.textContent?.trim() || '' }] : [];
  });
  return { text: (clone.textContent || '').replace(/\r\n?/g, '\n').trim(), links, imageCount: clone.querySelectorAll('img,video,audio,canvas').length };
}

function actualTime(element: Element | null): string | null {
  const value = element?.getAttribute('datetime');
  // Relative labels and locale-formatted strings have no trustworthy timezone.
  return value && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

export async function collectSnapshot(first: Document, inputUrl: string, options: CaptureOptions = {}): Promise<{ snapshot: Snapshot; identities: Record<string, string> }> {
  const url = topicUrl(inputUrl); const topic = parseTopic(first, url);
  const now = options.now?.() || new Date().toISOString();
  const identities: Record<string, string> = Object.assign(Object.create(null), options.identities || {});
  const existing = Object.values(identities);
  if (existing.some(id => !/^P\d+$/.test(id)) || new Set(existing).size !== existing.length) throw new Error('identities: 无效的本帖代号映射');
  let aliasIndex = Math.max(0, ...existing.map(id => Number(id.slice(1))));
  const alias = (name: string) => identities[name] ?? (identities[name] = `P${String(++aliasIndex).padStart(2, '0')}`);
  const header = first.querySelector('.topic-reply > .ui-header')?.textContent || '';
  const countMatch = header.match(/共收到\s*(\d+)\s*条回复/);
  const snapshot: Snapshot = {
    id: '', topicId: topic.id, url, title: topic.title, capturedAt: now,
    messages: [], pages: [], expectedReplies: countMatch ? Number(countMatch[1]) : null, completeness: 'unknown', gaps: [],
  };
  const addGap = (text: string) => { if (!snapshot.gaps.includes(text)) snapshot.gaps.push(text); };
  const messages = new Map<string, ThreadMessage>();
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 10, 30));
  const maxMessages = Math.max(1, Math.min(options.maxMessages ?? 1000, 3000));
  const firstUrl = readableUrl(inputUrl);
  const queue = [firstUrl]; const documents = new Map([[firstUrl, first]]); const scheduled = new Set(queue);
  for (let pageIndex = 0; pageIndex < queue.length; pageIndex++) {
    if (options.signal?.aborted) throw new Error('cancelled');
    const pageUrl = queue[pageIndex]!;
    if (pageIndex >= maxPages) {
      snapshot.pages.push({ url: pageUrl, status: 'skipped', messageIds: [], error: 'page_limit' });
      addGap('已达到采集页数上限，后续回复未读取。'); continue;
    }
    let doc = documents.get(pageUrl);
    if (!doc) {
      if (!options.fetchPage) {
        snapshot.pages.push({ url: pageUrl, status: 'skipped', messageIds: [], error: 'page_not_loaded' });
        addGap('存在尚未读取的回复分页。'); continue;
      }
      try { doc = await options.fetchPage(pageUrl, options.signal); parseTopic(doc, url); }
      catch {
        if (options.signal?.aborted) throw new Error('cancelled');
        snapshot.pages.push({ url: pageUrl, status: 'failed', messageIds: [], error: 'page_unavailable' });
        addGap('部分回复页读取失败；不会据此判定参与者未举证或回避。'); continue;
      }
    }
    const pageIds: string[] = [];
    if (pageIndex === 0) {
      const body = contentOf(doc.querySelector('.topic-detail > .ui-content'), url);
      const message: ThreadMessage = { id: `topic-${topic.id}`, authorId: alias(topic.author || '[原作者缺失]'), kind: 'topic', floor: null, ...body, publishedAt: actualTime(doc.querySelector('.topic-detail .created-time')), displayedTime: topic.time, stableId: true };
      messages.set(message.id, message); pageIds.push(message.id);
      if (!topic.author) addGap('主题作者标识缺失，归属需要核查。');
    }
    const replies = parseReplies(doc);
    for (const [index, reply] of replies.entries()) {
      const body = contentOf(reply.element.querySelector(':scope > .main > .content'), pageUrl);
      const stableId = /^\d+$/.test(reply.id);
      const id = stableId ? `reply-${reply.id}` : `unstable-${(await hashValue({ pageUrl, index, author: reply.author, text: body.text })).slice(0, 20)}`;
      const previous = messages.get(id);
      if (previous) {
        if (previous.text !== body.text) addGap(`采集期间 ${id} 内容发生变化，保留首次读取版本。`);
        pageIds.push(id); continue;
      }
      if (messages.size - 1 >= maxMessages) { addGap('已达到回复数量上限，后续回复未读取。'); break; }
      const floorText = [...reply.element.querySelectorAll(':scope > .main > .meta .floor')].map(el => el.textContent?.trim() || '').find(t => /^#\d+$/.test(t));
      const time = reply.element.querySelector(':scope > .main > .meta time[datetime]') || reply.element.querySelector(':scope > .main > .meta .time');
      messages.set(id, { id, authorId: alias(reply.author), kind: 'reply', floor: floorText ? Number(floorText.slice(1)) : null, ...body, publishedAt: actualTime(time), displayedTime: time?.textContent?.trim() || '', stableId });
      pageIds.push(id);
      if (!stableId) addGap('部分回复缺少原站稳定 ID，更新时无法保证身份对应。');
    }
    snapshot.pages.push({ url: pageUrl, status: 'read', messageIds: [...new Set(pageIds)], error: null });
    for (const next of replyPages(doc, pageUrl)) if (!scheduled.has(next)) { scheduled.add(next); queue.push(next); }
  }
  snapshot.messages = [...messages.values()].sort((a, b) => a.kind === 'topic' ? -1 : b.kind === 'topic' ? 1 : (a.floor ?? Infinity) - (b.floor ?? Infinity));
  const replyCount = snapshot.messages.filter(m => m.kind === 'reply').length;
  if (snapshot.expectedReplies !== null && replyCount !== snapshot.expectedReplies) addGap(`页面声明 ${snapshot.expectedReplies} 条回复，实际采集 ${replyCount} 条。`);
  if (snapshot.messages.some(m => m.imageCount)) addGap('正文含图片，仅采集文字；图片内容未核验。');
  const floors = new Set(snapshot.messages.flatMap(m => m.floor === null ? [] : [m.floor]));
  for (const message of snapshot.messages) {
    for (const reference of message.text.matchAll(/(?:^|\s|[，,])#(\d+)\b/g)) if (!floors.has(Number(reference[1]))) addGap(`引用的 #${reference[1]} 未在本次快照中定位。`);
  }
  snapshot.completeness = snapshot.gaps.length ? 'partial' : snapshot.expectedReplies === null ? 'unknown' : 'complete';
  snapshot.id = `snapshot-${(await hashValue({ topicId: snapshot.topicId, messages: snapshot.messages, pages: snapshot.pages, expectedReplies: snapshot.expectedReplies })).slice(0, 24)}`;
  const issues = validateSnapshot(snapshot);
  if (issues.length) throw new Error(`${issues[0]!.code}: ${issues[0]!.message}`);
  return { snapshot, identities };
}

/** Fixed sentence spans supplied to models; models choose IDs/offsets, never invent raw text. */
export function splitSpans(message: ThreadMessage): TextSpan[] {
  const chars = Array.from(message.text); const result: TextSpan[] = []; let start = 0;
  for (let i = 0; i < chars.length; i++) {
    if (/[。！？!?\n]/.test(chars[i]!) || i - start >= 799 || i === chars.length - 1) {
      result.push({ messageId: message.id, start, end: i + 1, quote: chars.slice(start, i + 1).join('') }); start = i + 1;
    }
  }
  return result;
}

export function snapshotDiff(before: Snapshot, after: Snapshot) {
  if (before.topicId !== after.topicId) throw new Error('topic_mismatch');
  const previous = new Map(before.messages.map(m => [m.id, m])); const current = new Map(after.messages.map(m => [m.id, m]));
  const added: string[] = []; const changed: string[] = []; const renumbered: string[] = [];
  for (const message of after.messages) {
    const old = previous.get(message.id);
    if (!old) added.push(message.id);
    else {
      if (old.text !== message.text || old.authorId !== message.authorId || JSON.stringify(old.links) !== JSON.stringify(message.links)) changed.push(message.id);
      if (old.floor !== message.floor) renumbered.push(message.id);
    }
  }
  const removed = [...previous.keys()].filter(id => !current.has(id));
  // Without a complete dependency graph, re-evaluate context rather than silently preserving stale judgments.
  return { added, changed, removed, renumbered, requiresContextReview: !!(added.length || changed.length || removed.length || renumbered.length) };
}
