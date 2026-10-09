import { describe, expect, it, vi } from 'vitest';
import { postAssistantReply } from '../src/rating/reply';

const TOPIC_HTML_WITH_FORM = `
<form action="/reply/create" method="post">
  <input type="hidden" name="csrf_token" value="csrf-abc" />
  <input type="hidden" name="topic_id" value="42" />
  <textarea name="content"></textarea>
</form>
`;

const cookies = {
  getAll: vi.fn(async () => [{ name: 'gzk_session', value: 'abc' }]),
};

describe('postAssistantReply', () => {
  it('rejects an invalid topic id', async () => {
    await expect(postAssistantReply('abc', 'x', { cookies }, { fetchImpl: vi.fn() })).rejects.toThrow(/目标楼层/);
  });

  it('returns no_cookies when no cookies are available', async () => {
    const result = await postAssistantReply('42', '评语', { cookies: { getAll: async () => [] } }, { fetchImpl: vi.fn() });
    expect(result.posted).toBe(false);
    expect(result.reason).toBe('no_cookies');
  });

  it('extracts the csrf from the topic page and posts the form', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.endsWith('/t/42')) return new Response(TOPIC_HTML_WITH_FORM, { status: 200 });
      return new Response('<html>评论已发布：[GuoZaoKe 评分 · 7/10] 不错</html>', { status: 200 });
    });
    const result = await postAssistantReply('42', '[GuoZaoKe 评分 · 7/10] 不错', { cookies }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const postCall = fetchImpl.mock.calls[1] as unknown as [unknown, RequestInit?];
    const postUrl = typeof postCall[0] === 'string' ? postCall[0] : (postCall[0] as URL).toString();
    expect(postUrl).toBe('https://www.guozaoke.com/reply/create');
    const postInit = postCall[1] as unknown as RequestInit;
    expect(String(postInit.body)).toContain('csrf_token=csrf-abc');
    expect(String(postInit.body)).toContain('topic_id=42');
    // "不错" is encoded as %E4%B8%8D%E9%94%99 in URL form encoding
    expect(String(postInit.body)).toContain('%E4%B8%8D%E9%94%99');
    expect(result.posted).toBe(true);
    expect(result.reason).toBe('sent');
  });

  it('returns no_csrf when the topic page has no hidden csrf field', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>无表单</html>', { status: 200 })) as unknown as typeof fetch;
    const result = await postAssistantReply('42', '评语', { cookies }, { fetchImpl });
    expect(result.posted).toBe(false);
    expect(result.reason).toBe('no_csrf');
  });

  it('returns server_rejected on 4xx response', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.endsWith('/t/42')) return new Response('<form action="/api/reply" method="post"><input name="csrf_token" value="x"/></form>', { status: 200 });
      return new Response('forbidden', { status: 403 });
    });
    const result = await postAssistantReply('42', '评语', { cookies }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.posted).toBe(false);
    expect(result.reason).toBe('server_rejected');
    expect(result.responseStatus).toBe(403);
  });

  it('returns marker_missing when the server replied 200 but the marker is not echoed back', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.endsWith('/t/42')) return new Response('<form><input name="csrf_token" value="x"/></form>', { status: 200 });
      return new Response('<html>已发布</html>', { status: 200 });
    });
    const result = await postAssistantReply('42', '[GuoZaoKe 评分 · 7/10] 测试', { cookies }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.posted).toBe(false);
    expect(result.reason).toBe('marker_missing');
  });
});
