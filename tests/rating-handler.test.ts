import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRatingHandler, type RatingHandlerBrowser } from '../src/rating/handler';
import { RATING_CONFIG_KEY } from '../src/rating/storage';
import type { RatingConfig, ReplyContext } from '../src/rating/types';

const TOPIC_HTML = [
  '<div class="topic-detail">',
  '  <div class="reply-item">',
  '    <a class="reply-username" href="/u/alice"><span class="username">alice</span></a>',
  '    <span class="time">1 年前</span>',
  '    <span class="content"><p>请 @gzk-judge 看看这条评论。</p></span>',
  '    <a class="J_replyVote" data-count="3" href="/replyVote?reply_id=1001">赞 3</a>',
  '  </div>',
  '  <div class="reply-item">',
  '    <a class="reply-username" href="/u/bob"><span class="username">bob</span></a>',
  '    <span class="content"><p>路过。</p></span>',
  '    <a class="J_replyVote" data-count="0" href="/replyVote?reply_id=1002">赞 0</a>',
  '  </div>',
  '  <div class="reply-item">',
  '    <a class="reply-username" href="/u/gzk-judge"><span class="username">gzk-judge</span></a>',
  '    <span class="content"><p>感谢 @alice 的反馈。</p></span>',
  '  </div>',
  '</div>',
].join('\n');

function makeBrowser(initial: { config?: Partial<RatingConfig>; replied?: Record<string, string[]> } = {}): RatingHandlerBrowser & { storage: { local: { get: any; set: any } }, local: Record<string, unknown> } {
  const local: Record<string, unknown> = {};
  const configDefaults: Partial<RatingConfig> = { assistantUsername: 'gzk-judge', postReply: false, modelConfigId: null, maxReplyCharacters: 600 };
  local[RATING_CONFIG_KEY] = { ...configDefaults, ...(initial.config || {}) };
  if (initial.replied) local['gzk:rating:replied:v1'] = { topics: initial.replied };
  return {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: structuredClone(local[key]) })),
        set: vi.fn(async (next: Record<string, unknown>) => Object.assign(local, structuredClone(next))),
      },
    },
    local,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createRatingHandler', () => {
  it('rates the most recent reply that mentions the assistant and is not yet replied', async () => {
    const browser = makeBrowser();
    const handler = createRatingHandler(browser);
    const outcome = await handler.handleTrigger({ topicId: '42', topicUrl: 'https://www.guozaoke.com/t/42', pageHtml: TOPIC_HTML });
    expect(outcome.handled).toBe(true);
    expect(outcome.result).toBeDefined();
    expect(outcome.result!.score).toBeGreaterThanOrEqual(0);
    expect(outcome.result!.comment.startsWith('[GuoZaoKe 评分 · ')).toBe(true);
    expect(outcome.postedReply).toBeUndefined();
    // Should mark the reply id as replied.
    const stored = browser.local['gzk:rating:replied:v1'] as { topics: Record<string, string[]> };
    expect(stored.topics['42']).toContain('1001');
  });

  it('skips replies that already have an assistant reply recorded', async () => {
    const browser = makeBrowser({ replied: { '42': ['1001'] } });
    const handler = createRatingHandler(browser);
    const outcome = await handler.handleTrigger({ topicId: '42', topicUrl: 'https://www.guozaoke.com/t/42', pageHtml: TOPIC_HTML });
    expect(outcome.handled).toBe(false);
  });

  it('rejects an empty assistant username', async () => {
    const browser = makeBrowser({ config: { assistantUsername: '' } });
    const handler = createRatingHandler(browser);
    const outcome = await handler.handleTrigger({ topicId: '42', topicUrl: 'https://www.guozaoke.com/t/42', pageHtml: TOPIC_HTML });
    expect(outcome.handled).toBe(false);
    expect(outcome.error?.code).toBe('config_missing');
  });

  it('rejects an invalid topicId', async () => {
    const browser = makeBrowser();
    const handler = createRatingHandler(browser);
    const outcome = await handler.handleTrigger({ topicId: 'abc', topicUrl: 'https://www.guozaoke.com/t/abc', pageHtml: TOPIC_HTML });
    expect(outcome.handled).toBe(false);
    expect(outcome.error?.code).toBe('reply_not_found');
  });

  it('uses a deterministic LLM response when the model is configured and key is provided', async () => {
    const browser = makeBrowser({ config: { modelConfigId: 'cfg-1' } });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"comment":"言之有物，赞同数和表达都较稳。"}' } }] }), { status: 200 }));
    const handler = createRatingHandler(browser, {
      resolveModel: async (id) => id === 'cfg-1' ? { id, name: 'Test', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', temperature: 0, maxOutputTokens: 4096, declaredVersion: '' } : null,
      readModelKey: async () => 'fixture-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const outcome = await handler.handleTrigger({ topicId: '42', topicUrl: 'https://www.guozaoke.com/t/42', pageHtml: TOPIC_HTML });
    expect(outcome.handled).toBe(true);
    expect(outcome.result?.provider).toBe('llm');
    expect(outcome.result?.comment).toContain('言之有物');
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('posts a reply when postReply is enabled and cookies are available', async () => {
    const browser = makeBrowser({ config: { postReply: true } });
    browser.cookies = { getAll: vi.fn(async () => [{ name: 'gzk_session', value: 'fixture' }]) };
    const fetchImpl = vi.fn(async () => new Response('<html><body>评论已发布：[GuoZaoKe 评分 · 7/10] ...</body></html>', { status: 200 }));
    const postReply = vi.fn(async () => ({ posted: true as const, reason: 'sent' as const, body: 'x', responseStatus: 200 }));
    const handler = createRatingHandler(browser, { postReply: postReply as any });
    const outcome = await handler.handleTrigger({ topicId: '42', topicUrl: 'https://www.guozaoke.com/t/42', pageHtml: TOPIC_HTML });
    expect(outcome.handled).toBe(true);
    expect(outcome.postedReply?.posted).toBe(true);
    expect(postReply).toHaveBeenCalledWith('42', expect.stringContaining('[GuoZaoKe 评分'), { cookies: browser.cookies });
  });

  it('preview reports the first matching reply without scoring or persisting', async () => {
    const browser = makeBrowser();
    const setSpy = browser.storage.local.set as unknown as ReturnType<typeof vi.fn>;
    const handler = createRatingHandler(browser);
    const preview = await handler.preview({ topicId: '42', topicUrl: 'https://www.guozaoke.com/t/42', pageHtml: TOPIC_HTML });
    expect(preview.replies).toBe(3);
    expect(preview.trigger?.replyId).toBe('1001');
    expect(setSpy).not.toHaveBeenCalled();
  });
});
