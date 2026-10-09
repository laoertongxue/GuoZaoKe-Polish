import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRatingHandler, type RatingHandlerBrowser } from '../src/rating/handler';
import { normalizeRatingConfig, RATING_CONFIG_KEY } from '../src/rating/storage';
import type { RatingConfig } from '../src/rating/types';
import type { PostReplyResult } from '../src/rating/reply';

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

const REQUEST = { topicId: '42', topicUrl: 'https://www.guozaoke.com/t/42', pageHtml: TOPIC_HTML };

function makeBrowser(initial: { config?: Partial<RatingConfig> & Record<string, unknown>; replied?: Record<string, string[]> } = {}): RatingHandlerBrowser & { local: Record<string, unknown> } {
  const local: Record<string, unknown> = {};
  local[RATING_CONFIG_KEY] = { assistantUsername: 'gzk-judge', postReply: false, maxReplyCharacters: 600, ...(initial.config || {}) };
  if (initial.replied) local['gzk:rating:replied:v1'] = { topics: initial.replied };
  return {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: structuredClone(local[key]) })),
        set: vi.fn(async (next: Record<string, unknown>): Promise<void> => { Object.assign(local, structuredClone(next)); }),
      },
    },
    local,
  };
}

function sent(): PostReplyResult {
  return { posted: true, reason: 'sent', responseStatus: 200 };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createRatingHandler', () => {
  it('rates the most recent reply that mentions the assistant and marks it as scored', async () => {
    const browser = makeBrowser();
    const outcome = await createRatingHandler(browser).handleTrigger(REQUEST);
    expect(outcome.handled).toBe(true);
    expect(outcome.result?.provider).toBe('heuristic');
    expect(outcome.result?.comment.startsWith('[GuoZaoKe 评分 · ')).toBe(true);
    expect(outcome.postedReply).toBeUndefined();
    const stored = browser.local['gzk:rating:replied:v1'] as { topics: Record<string, string[]> };
    expect(stored.topics['42']).toContain('1001');
  });

  it('does not post by default, even when the stored config has no postReply field', async () => {
    const browser = makeBrowser({ config: { postReply: undefined } });
    const postReply = vi.fn(async () => sent());
    const outcome = await createRatingHandler(browser, { postReply }).handleTrigger(REQUEST);
    expect(outcome.handled).toBe(true);
    expect(postReply).not.toHaveBeenCalled();
  });

  it('skips replies that were already scored', async () => {
    const browser = makeBrowser({ replied: { '42': ['1001'] } });
    const outcome = await createRatingHandler(browser).handleTrigger(REQUEST);
    expect(outcome.handled).toBe(false);
  });

  it('rejects a missing assistant username', async () => {
    const browser = makeBrowser({ config: { assistantUsername: '' } });
    const outcome = await createRatingHandler(browser).handleTrigger(REQUEST);
    expect(outcome.handled).toBe(false);
    expect(outcome.error?.code).toBe('config_missing');
  });

  it('rejects an invalid topicId', async () => {
    const browser = makeBrowser();
    const outcome = await createRatingHandler(browser).handleTrigger({ ...REQUEST, topicId: 'abc' });
    expect(outcome.handled).toBe(false);
    expect(outcome.error?.code).toBe('reply_not_found');
  });

  it('posts the review as the assistant username when postReply is enabled, and marks it on success', async () => {
    const browser = makeBrowser({ config: { postReply: true } });
    const postReply = vi.fn(async () => sent());
    const outcome = await createRatingHandler(browser, { postReply }).handleTrigger(REQUEST);
    expect(outcome.postedReply?.posted).toBe(true);
    expect(postReply).toHaveBeenCalledWith('42', expect.stringContaining('[GuoZaoKe 评分'), 'gzk-judge');
    const stored = browser.local['gzk:rating:replied:v1'] as { topics: Record<string, string[]> };
    expect(stored.topics['42']).toContain('1001');
  });

  it('leaves a floor unmarked when the post failed before publishing, so a later scan can retry', async () => {
    const browser = makeBrowser({ config: { postReply: true } });
    const postReply = vi.fn(async () => ({ posted: false, reason: 'not_logged_in', responseStatus: 200 } as PostReplyResult));
    const handler = createRatingHandler(browser, { postReply });
    const first = await handler.handleTrigger(REQUEST);
    expect(first.postedReply?.reason).toBe('not_logged_in');
    expect(browser.local['gzk:rating:replied:v1']).toBeUndefined();
    const second = await handler.handleTrigger(REQUEST);
    expect(second.handled).toBe(true);
    expect(postReply).toHaveBeenCalledTimes(2);
  });

  it('marks a floor when the request was sent but could not be confirmed, to avoid a duplicate reply', async () => {
    const browser = makeBrowser({ config: { postReply: true } });
    const postReply = vi.fn(async () => ({ posted: false, reason: 'marker_missing', responseStatus: 200 } as PostReplyResult));
    await createRatingHandler(browser, { postReply }).handleTrigger(REQUEST);
    const stored = browser.local['gzk:rating:replied:v1'] as { topics: Record<string, string[]> };
    expect(stored.topics['42']).toContain('1001');
  });

  it('drops the legacy modelConfigId field when normalizing the stored config', () => {
    const config = normalizeRatingConfig({ assistantUsername: 'gzk-judge', postReply: true, modelConfigId: 'cfg-1', maxReplyCharacters: 600 });
    expect(config).not.toHaveProperty('modelConfigId');
    expect(config.postReply).toBe(true);
  });

  it('preview reports the first matching reply without persisting anything', async () => {
    const browser = makeBrowser();
    const handler = createRatingHandler(browser);
    const preview = await handler.preview(REQUEST);
    expect(preview.replies).toBe(3);
    expect(preview.trigger?.replyId).toBe('1001');
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });
});
