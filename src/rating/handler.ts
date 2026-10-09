import { scoreHeuristic } from './heuristic';
import { postAssistantReply, type PostReplyResult } from './reply';
import { detectTrigger } from './trigger';
import { emptyRepliedSet, hasReplied, markReplied, normalizeRatingConfig, RATING_CONFIG_KEY, RATING_REPLIED_KEY, type RepliedSet } from './storage';
import type { HeuristicScore, RatingConfig, RatingResult, ReplyContext } from './types';

export interface RatingHandlerBrowser {
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(values: Record<string, unknown>): Promise<void>;
    };
  };
}

export interface RatingHandlerDeps {
  parseTopicReplies?: (html: string, topicUrl: string) => ReplyContext[];
  postReply?: typeof postAssistantReply;
}

export interface TriggerRequest {
  topicId: string;
  topicUrl: string;
  pageHtml: string;
}

export interface RatingOutcome {
  handled: boolean;
  result?: RatingResult;
  postedReply?: PostReplyResult;
  error?: { code: string; message: string };
}

export interface RatingPreview {
  replies: number;
  trigger?: { replyId: string; author: string; text: string; score: number; summary: string };
}

/**
 * Failed posts that never reached the site's publish step. The floor stays unmarked, so a
 * later scan (after logging in or fixing the assistant account) can try again.
 * `marker_missing` is deliberately absent: the request was sent, so retrying could duplicate it.
 */
const RETRYABLE_FAILURES: ReadonlySet<PostReplyResult['reason']> = new Set(['not_logged_in', 'account_mismatch', 'form_not_found', 'server_rejected']);

function defaultParseTopicReplies(html: string, topicUrl: string): ReplyContext[] {
  const startRegex = /<div[^>]+class="[^"]*\breply-item\b[^"]*"[^>]*>/gi;
  const starts: number[] = [];
  const all = [...html.matchAll(startRegex)];
  for (const m of all) starts.push(m.index!);
  const out: ReplyContext[] = [];
  const idMatch = topicUrl.match(/\/t\/(\d+)/);
  const topicId = idMatch?.[1] || '0';
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!;
    const end = i + 1 < starts.length ? starts[i + 1]! : html.length;
    const block = html.slice(start, end);
    const replyIdMatch = block.match(/reply_id=(\d+)/);
    const upvoteMatch = block.match(/赞\s*(\d+)/);
    const usernameMatch = block.match(/class="username"[^>]*>([^<]+)</);
    const textMatch = block.match(/<span class="content">([\s\S]*?)<\/span>/);
    const text = (textMatch?.[1] || '').replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    out.push({
      replyId: replyIdMatch?.[1] || String(i),
      topicId,
      topicUrl,
      author: (usernameMatch?.[1] || '').trim(),
      text,
      upvotes: Number(upvoteMatch?.[1] || 0),
      characterCount: text.length,
    });
  }
  return out;
}

function buildComment(score: HeuristicScore, max: number): RatingResult {
  const line = `[GuoZaoKe 评分 · ${score.score}/10] ${score.summary}`;
  return { score: score.score, comment: line.length > max ? line.slice(0, max) : line, provider: 'heuristic' };
}

export function createRatingHandler(api: RatingHandlerBrowser, deps: RatingHandlerDeps = {}) {
  const parseTopicReplies = deps.parseTopicReplies ?? defaultParseTopicReplies;
  const postReplyImpl = deps.postReply ?? postAssistantReply;

  async function loadConfig(): Promise<RatingConfig> {
    const raw = await api.storage.local.get(RATING_CONFIG_KEY);
    return normalizeRatingConfig(raw[RATING_CONFIG_KEY]);
  }

  async function loadReplied(): Promise<RepliedSet> {
    const raw = await api.storage.local.get(RATING_REPLIED_KEY);
    const value = raw[RATING_REPLIED_KEY];
    if (!value || typeof value !== 'object') return emptyRepliedSet();
    const topics = (value as { topics?: Record<string, unknown> }).topics;
    if (!topics || typeof topics !== 'object') return emptyRepliedSet();
    const out: RepliedSet = { topics: {} };
    for (const [topicId, list] of Object.entries(topics)) {
      if (Array.isArray(list) && /^\d+$/.test(topicId)) {
        out.topics[topicId] = list.filter((v): v is string => typeof v === 'string').slice(-32);
      }
    }
    return out;
  }

  async function saveReplied(set: RepliedSet): Promise<void> {
    await api.storage.local.set({ [RATING_REPLIED_KEY]: set });
  }

  async function handleTrigger(request: TriggerRequest): Promise<RatingOutcome> {
    if (!/^\d+$/.test(request.topicId)) {
      return { handled: false, error: { code: 'reply_not_found', message: 'topicId 非法' } };
    }
    const config = await loadConfig();
    if (!config.assistantUsername) {
      return { handled: false, error: { code: 'config_missing', message: '尚未配置助手账号' } };
    }
    const replied = await loadReplied();
    const replies = parseTopicReplies(request.pageHtml, request.topicUrl);
    if (replies.length === 0) {
      return { handled: false, error: { code: 'reply_not_found', message: '帖子页面未解析出回帖' } };
    }
    const assistantKey = config.assistantUsername.trim().toLowerCase();
    for (let i = replies.length - 1; i >= 0; i--) {
      const reply = replies[i]!;
      if (hasReplied(replied, request.topicId, reply.replyId)) continue;
      if (reply.author.trim().toLowerCase() === assistantKey) continue;
      if (!detectTrigger(reply.text, config.assistantUsername)) continue;
      const result = buildComment(scoreHeuristic(reply), config.maxReplyCharacters);
      let postedReply: PostReplyResult | undefined;
      if (config.postReply) {
        postedReply = await postReplyImpl(request.topicId, result.comment, config.assistantUsername);
      }
      const retryLater = postedReply !== undefined && !postedReply.posted && RETRYABLE_FAILURES.has(postedReply.reason);
      if (!retryLater) await saveReplied(markReplied(replied, request.topicId, reply.replyId));
      return { handled: true, result, postedReply };
    }
    return { handled: false };
  }

  async function preview(request: TriggerRequest): Promise<RatingPreview> {
    const config = await loadConfig();
    const replies = parseTopicReplies(request.pageHtml, request.topicUrl);
    if (!config.assistantUsername || replies.length === 0) return { replies: replies.length };
    const assistantKey = config.assistantUsername.trim().toLowerCase();
    for (let i = replies.length - 1; i >= 0; i--) {
      const reply = replies[i]!;
      if (reply.author.trim().toLowerCase() === assistantKey) continue;
      if (!detectTrigger(reply.text, config.assistantUsername)) continue;
      const score = scoreHeuristic(reply);
      return { replies: replies.length, trigger: { replyId: reply.replyId, author: reply.author, text: reply.text, score: score.score, summary: score.summary } };
    }
    return { replies: replies.length };
  }

  return { loadConfig, loadReplied, saveReplied, handleTrigger, preview };
}
