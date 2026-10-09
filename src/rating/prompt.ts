import type { ChatMessage } from './providers';
import type { HeuristicScore, ReplyContext } from './types';

const SYSTEM = '你是过早客的评分助手。基于给定的本地启发式分数和楼层内容，输出一段 200 到 600 字的中文评语。' +
  '评语要客观、不重复楼层原文，不要夸赞也不要贬低，要给出可验证的观察。' +
  '回复必须是 JSON：{"comment": "..."}，不要输出其它字段或代码块。';

const USER = (reply: ReplyContext, score: HeuristicScore) =>
  `帖子：${reply.topicUrl}\n` +
  `楼层 #${reply.replyId}（${reply.author}，${reply.upvotes} 赞）\n` +
  `启发式分数：${score.score}/10\n` +
  `分项：赞同 ${score.factors.upvotes.toFixed(1)} / 长度 ${score.factors.length.toFixed(1)} / 独特词 ${score.factors.uniqueness.toFixed(1)} / 密度 ${score.factors.density.toFixed(1)}\n` +
  `本地参考评语：${score.summary}\n` +
  `---\n` +
  `楼层正文：\n${reply.text}`;

/** Build the chat-completion request for the rating assistant's narrative comment. */
export function buildRatingMessages(reply: ReplyContext, score: HeuristicScore): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: USER(reply, score) },
  ];
}

const COMMENT_KEY = '"comment"';
/** Validate the LLM JSON response and return the trimmed comment string. */
export function parseRatingComment(value: unknown, maxCharacters: number): string {
  if (!value || typeof value !== 'object') throw new Error('评语响应不是 JSON 对象');
  const raw = (value as { comment?: unknown }).comment;
  if (typeof raw !== 'string') throw new Error('评语响应缺少 comment 字段');
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('评语为空');
  if (trimmed.length > maxCharacters) {
    // Hard truncate at a sentence boundary when possible to avoid mid-word cuts.
    const slice = trimmed.slice(0, maxCharacters);
    const boundary = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('！'), slice.lastIndexOf('？'));
    return boundary > maxCharacters * 0.6 ? slice.slice(0, boundary + 1) : slice;
  }
  return trimmed;
}
