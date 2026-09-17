import { describe, expect, it, vi } from 'vitest';
import { collectSnapshot, snapshotDiff, splitSpans } from '../src/analysis/snapshot';
import { validateSnapshot } from '../src/analysis/contracts';

const url = 'https://www.guozaoke.com/t/121894';
function page(replies: { id?: string; floor: number; author?: string; text: string }[], total: number | null = replies.length, pages = '') {
  const doc = new DOMParser().parseFromString(`<div class="topic-detail"><div class="ui-header"><h3 class="title">测试费用</h3><div class="meta"><span class="username">owner</span><span class="created-time">昨天</span></div></div><div class="ui-content">费用？<img src="https://example.org/a.png"></div><div class="ui-footer">不要抓到收藏入口</div></div><div class="topic-reply"><div class="ui-header">${total === null ? '回复' : `共收到${total}条回复`}</div><div class="ui-content">${replies.map(r => `<div class="reply-item"><div class="main"><div class="meta"><a class="reply-username">${r.author || 'writer'}</a><span class="floor">#${r.floor}</span><time class="time">1 分钟前</time>${r.id ? `<a class="J_replyVote" href="/replyVote?reply_id=${r.id}"></a>` : ''}</div><span class="content">${r.text}</span></div></div>`).join('')}</div></div><div class="pagination">${pages}</div><textarea>私密草稿</textarea><aside>广告菜单</aside>`, 'text/html');
  return doc;
}
describe('thread snapshot collection', () => {
  it('uses actual server IDs, keeps unknown dates unknown and excludes page chrome/drafts', async () => {
    const { snapshot, identities } = await collectSnapshot(page([{ id: '100', floor: 1, text: '😃十元。<b>真的吗？</b>' }]), url);
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages[1]).toMatchObject({ id: 'reply-100', publishedAt: null, displayedTime: '1 分钟前', authorId: 'P02', stableId: true });
    expect(snapshot.messages.map(m => m.text).join('')).not.toMatch(/广告|草稿|收藏/);
    expect(identities).toEqual({ owner: 'P01', writer: 'P02' });
    expect(snapshot.messages[0]?.imageCount).toBe(1);
    expect(snapshot.gaps).toContain('正文含图片，仅采集文字；图片内容未核验。');
    expect(validateSnapshot(snapshot)).toEqual([]);
    const spans = splitSpans(snapshot.messages[1]!);
    expect(spans.map(s => s.quote).join('')).toBe('😃十元。真的吗？');
    expect(spans[0]?.end).toBe(4);
  });
  it('deduplicates stable IDs across overlapping pages and leaves a failed page gap', async () => {
    const first = page([{ id: '100', floor: 1, text: '1' }], 3, '<a href="?p=2">2</a><a href="?p=3">3</a>');
    const fetchPage = vi.fn(async (next: string) => {
      if (next.endsWith('3')) throw new Error('secret error body');
      return page([{ id: '100', floor: 1, text: '1' }, { id: '101', floor: 2, text: '2' }], 3);
    });
    const { snapshot } = await collectSnapshot(first, url, { fetchPage });
    expect(snapshot.messages.map(m => m.id)).toEqual(['topic-121894', 'reply-100', 'reply-101']);
    expect(snapshot.completeness).toBe('partial');
    expect(snapshot.pages.filter(p => p.status === 'failed')).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(validateSnapshot(snapshot)).toEqual([]);
  });
  it('does not guess stable identities or zero replies when metadata is missing', async () => {
    const { snapshot } = await collectSnapshot(page([{ floor: 1, text: '未知原站 ID' }], null), url);
    expect(snapshot.expectedReplies).toBeNull();
    expect(snapshot.messages[1]?.stableId).toBe(false);
    expect(snapshot.completeness).not.toBe('complete');
  });
  it('keeps stable identity across renumbering and invalidates changed content dependants', async () => {
    const initial = await collectSnapshot(page([{ id: '100', floor: 1, text: '十元' }, { id: '101', floor: 2, text: '@writer #1 为什么？' }]), url);
    const updated = await collectSnapshot(page([{ id: '100', floor: 3, text: '七元' }, { id: '101', floor: 4, text: '@writer #1 为什么？' }]), url, { identities: initial.identities });
    const diff = snapshotDiff(initial.snapshot, updated.snapshot);
    expect(diff.changed).toContain('reply-100');
    expect(diff.added).toEqual([]);
    expect(diff.renumbered).toContain('reply-101');
    expect(diff.requiresContextReview).toBe(true);
    expect(updated.snapshot.messages[1]?.authorId).toBe(initial.snapshot.messages[1]?.authorId);
  });
  it('limits pagination and only fetches same-topic read URLs', async () => {
    const fetchPage = vi.fn(async () => page([], 4));
    const { snapshot } = await collectSnapshot(page([], 4, '<a href="?p=2">2</a><a href="?p=3">3</a><a href="/logout">exit</a><a href="https://evil.org/t/121894?p=4">bad</a>'), url, { fetchPage, maxPages: 2 });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(`${url}?p=2`, undefined);
    expect(snapshot.pages.some(p => p.status === 'skipped')).toBe(true);
  });
  it('stops before another page if cancelled', async () => {
    const controller = new AbortController(); controller.abort();
    const fetchPage = vi.fn();
    await expect(collectSnapshot(page([], 1, '<a href="?p=2">2</a>'), url, { signal: controller.signal, fetchPage })).rejects.toThrow('cancelled');
    expect(fetchPage).not.toHaveBeenCalled();
  });
  it('collects nested extension reply DOM once and ignores inserted controls inside content', async () => {
    const doc = page([{ id: '100', floor: 1, text: '原文<span class="gzk-inline-action">分析菜单</span>' }, { id: '101', floor: 2, text: '第二条' }]);
    const replies = doc.querySelectorAll('.reply-item'); replies[0]!.append(replies[1]!);
    const { snapshot } = await collectSnapshot(doc, url);
    expect(snapshot.messages.filter(m => m.kind === 'reply')).toHaveLength(2);
    expect(snapshot.messages[1]?.text).toBe('原文');
  });
});
