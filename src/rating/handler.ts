import { chatCompletion, normalizeStoredModelConfig, ProviderError, type ModelConfig } from './providers';
import { scoreHeuristic } from './heuristic';
import { buildRatingMessages, parseRatingComment } from './prompt';
import { postAssistantReply, type CookieSource, type PostReplyResult } from './reply';
import { RatingError } from './errors';
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
  cookies?: CookieSource['cookies'];
}

export interface RatingHandlerDeps {
  parseTopicReplies?: (html: string, topicUrl: string) => ReplyContext[];
  resolveModel?: (configId: string | null) => Promise<ModelConfig | null>;
  readModelKey?: (modelId: string) => Promise<string | null>;
  /** Override the LLM transport. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
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

async function defaultResolveModel(api: RatingHandlerBrowser, configId: string | null): Promise<ModelConfig | null> {
  const raw = await api.storage.local.get('gzk:analysis:configs:v1');
  const value = raw['gzk:analysis:configs:v1'];
  if (!Array.isArray(value) || value.length === 0) return null;
  if (configId) {
    const found = (value as Array<unknown>).find(c => (c as { id?: string })?.id === configId);
    if (found) return normalizeStoredModelConfig(found);
  }
  const first = (value as Array<unknown>)[0];
  return first ? normalizeStoredModelConfig(first) : null;
}

function buildOutputComment(score: HeuristicScore, max: number): string {
  const line = `[GuoZaoKe 评分 · ${score.score}/10] ${score.summary}`;
  return line.length > max ? line.slice(0, max) : line;
}

export function createRatingHandler(api: RatingHandlerBrowser, deps: RatingHandlerDeps = {}) {
  const parseTopicReplies = deps.parseTopicReplies ?? defaultParseTopicReplies;
  const resolveModel = deps.resolveModel ?? ((id) => defaultResolveModel(api, id));
  const readModelKey = deps.readModelKey ?? (async () => null);
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

  async function buildComment(reply: ReplyContext, score: HeuristicScore, config: RatingConfig): Promise<RatingResult> {
    if (!config.modelConfigId) {
      return { score: score.score, comment: buildOutputComment(score, config.maxReplyCharacters), provider: 'heuristic' };
    }
    const model = await resolveModel(config.modelConfigId);
    if (!model) {
      return { score: score.score, comment: buildOutputComment(score, config.maxReplyCharacters), provider: 'heuristic' };
    }
    const key = await readModelKey(model.id);
    if (!key) {
      return { score: score.score, comment: buildOutputComment(score, config.maxReplyCharacters), provider: 'heuristic' };
    }
    try {
      const result = await chatCompletion(model, key, buildRatingMessages(reply, score), {
        fetch: deps.fetchImpl,
        validate: value => {
          if (!value || typeof value !== 'object') return false;
          return typeof (value as { comment?: unknown }).comment === 'string';
        },
      });
      const comment = parseRatingComment(result.value, config.maxReplyCharacters);
      const body = `[GuoZaoKe 评分 · ${score.score}/10] ${comment}`;
      return { score: score.score, comment: body.length > config.maxReplyCharacters ? body.slice(0, config.maxReplyCharacters) : body, provider: 'llm', model: model.id };
    } catch (error) {
      if (error instanceof ProviderError) throw new RatingError('provider_error');
      throw error;
    }
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
      const score = scoreHeuristic(reply);
      const result = await buildComment(reply, score, config);
      let postedReply: PostReplyResult | undefined;
      if (config.postReply && api.cookies) {
        postedReply = await postReplyImpl(request.topicId, result.comment, { cookies: api.cookies });
      }
      await saveReplied(markReplied(replied, request.topicId, reply.replyId));
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

  return { loadConfig, loadReplied, saveReplied, handleTrigger, preview, buildComment, parseTopicReplies, scoreHeuristic, detectTrigger };
}
