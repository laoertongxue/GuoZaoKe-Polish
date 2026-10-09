import { describe, expect, it, vi } from 'vitest';
import { findReplyForm, loggedInUsername, postAssistantReply, replyFailureMessage } from '../src/rating/reply';

const NAVBAR_LOGGED_IN = '<ul class="nav navbar-nav navbar-right"><li><a href="/u/gzk-judge">gzk-judge</a></li></ul>';
const NAVBAR_LOGGED_OUT = '<ul class="nav navbar-nav navbar-right"><li><a href="/login">登录</a></li><li><a href="/register">注册</a></li></ul>';
const REPLY_FORM = '<form action="/reply/create" method="post">'
  + '<input type="hidden" name="_xsrf" value="tok-1" />'
  + '<input type="hidden" name="topic_id" value="42" />'
  + '<textarea class="J_replyContent" name="content"></textarea></form>';

function topicPage(navbar: string, form = REPLY_FORM): string {
  return `<html><body><nav>${navbar}</nav><div class="topic-detail"><a href="/u/alice">alice</a></div>${form}</body></html>`;
}

function fetchWith(pages: { topic: string; topicStatus?: number; post?: string; postStatus?: number }) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.endsWith('/t/42')) return new Response(pages.topic, { status: pages.topicStatus ?? 200 });
    return new Response(pages.post ?? '<html>[GuoZaoKe 评分 · 7/10] 不错</html>', { status: pages.postStatus ?? 200 });
  });
}

describe('loggedInUsername', () => {
  it('reads the account from the navbar only, not from author links in the topic body', () => {
    expect(loggedInUsername(topicPage(NAVBAR_LOGGED_IN))).toBe('gzk-judge');
    expect(loggedInUsername(topicPage(NAVBAR_LOGGED_OUT))).toBe('');
    expect(loggedInUsername('<div class="topic-detail"><a href="/u/alice">alice</a></div>')).toBe('');
  });
});

describe('findReplyForm', () => {
  it('collects the hidden fields of the form that contains the reply textarea', () => {
    const form = findReplyForm(topicPage(NAVBAR_LOGGED_IN), 'https://www.guozaoke.com');
    expect(form?.action).toBe('https://www.guozaoke.com/reply/create');
    expect(form?.hidden).toEqual([['_xsrf', 'tok-1'], ['topic_id', '42']]);
  });

  it('ignores other forms such as search, and refuses a cross-origin action', () => {
    const search = '<form action="https://evil.example/collect" method="get"><input type="hidden" name="csrf" value="x"></form>';
    expect(findReplyForm(topicPage(NAVBAR_LOGGED_IN, search), 'https://www.guozaoke.com')).toBeNull();
    const crossOrigin = REPLY_FORM.replace('/reply/create', 'https://evil.example/reply');
    expect(findReplyForm(topicPage(NAVBAR_LOGGED_IN, crossOrigin), 'https://www.guozaoke.com')).toBeNull();
  });

  it('requires an anti-forgery hidden field', () => {
    const noToken = REPLY_FORM.replace('<input type="hidden" name="_xsrf" value="tok-1" />', '');
    expect(findReplyForm(topicPage(NAVBAR_LOGGED_IN, noToken), 'https://www.guozaoke.com')).toBeNull();
  });
});

describe('postAssistantReply', () => {
  it('rejects an invalid topic id before any request', async () => {
    const fetchImpl = vi.fn();
    await expect(postAssistantReply('abc', 'x', 'gzk-judge', { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/目标楼层/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not post when the browser is logged out', async () => {
    const fetchImpl = fetchWith({ topic: topicPage(NAVBAR_LOGGED_OUT) });
    const result = await postAssistantReply('42', '评语', 'gzk-judge', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ posted: false, reason: 'not_logged_in' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not post when the logged-in account is not the assistant account', async () => {
    const fetchImpl = fetchWith({ topic: topicPage(NAVBAR_LOGGED_IN.replace(/gzk-judge/g, 'someone-else')) });
    const result = await postAssistantReply('42', '评语', 'gzk-judge', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ posted: false, reason: 'account_mismatch' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('matches the account name case-insensitively', async () => {
    const fetchImpl = fetchWith({ topic: topicPage(NAVBAR_LOGGED_IN.replace(/gzk-judge/g, 'GZK-Judge')) });
    const result = await postAssistantReply('42', '评语', 'gzk-judge', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.reason).toBe('sent');
  });

  it('reports form_not_found when the topic page has no reply form', async () => {
    const fetchImpl = fetchWith({ topic: topicPage(NAVBAR_LOGGED_IN, '<p>无表单</p>') });
    const result = await postAssistantReply('42', '评语', 'gzk-judge', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ posted: false, reason: 'form_not_found' });
  });

  it('posts the site form fields through the browser session, without a manual Cookie header', async () => {
    const fetchImpl = fetchWith({ topic: topicPage(NAVBAR_LOGGED_IN) });
    const result = await postAssistantReply('42', '[GuoZaoKe 评分 · 7/10] 不错', 'gzk-judge', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ posted: true, reason: 'sent', responseStatus: 200 });
    const [pageUrl, pageInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(pageUrl).toBe('https://www.guozaoke.com/t/42');
    expect(pageInit.credentials).toBe('include');
    const [postUrl, postInit] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(postUrl).toBe('https://www.guozaoke.com/reply/create');
    expect(postInit.credentials).toBe('include');
    expect(postInit.method).toBe('POST');
    expect(new Headers(postInit.headers).has('cookie')).toBe(false);
    const body = new URLSearchParams(String(postInit.body));
    expect(body.get('_xsrf')).toBe('tok-1');
    expect(body.get('topic_id')).toBe('42');
    expect(body.get('content')).toBe('[GuoZaoKe 评分 · 7/10] 不错');
  });

  it('reports server_rejected on an HTTP error from the post', async () => {
    const fetchImpl = fetchWith({ topic: topicPage(NAVBAR_LOGGED_IN), postStatus: 403, post: 'forbidden' });
    const result = await postAssistantReply('42', '评语', 'gzk-judge', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ posted: false, reason: 'server_rejected', responseStatus: 403 });
  });

  it('reports marker_missing when the response does not echo the review', async () => {
    const fetchImpl = fetchWith({ topic: topicPage(NAVBAR_LOGGED_IN), post: '<html>已发布</html>' });
    const result = await postAssistantReply('42', '[GuoZaoKe 评分 · 7/10] 测试', 'gzk-judge', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ posted: false, reason: 'marker_missing' });
  });

  it('gives a readable message for every failure reason', () => {
    for (const reason of ['sent', 'not_logged_in', 'account_mismatch', 'form_not_found', 'server_rejected', 'marker_missing'] as const) {
      expect(replyFailureMessage(reason).length).toBeGreaterThan(0);
    }
  });
});
