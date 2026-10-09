import { DEFAULT_RATING_CONFIG, type RatingConfig } from './types';

export const RATING_CONFIG_KEY = 'gzk:rating:config:v1';
export const RATING_REPLIED_KEY = 'gzk:rating:replied:v1';

export function normalizeRatingConfig(input: unknown): RatingConfig {
  if (!input || typeof input !== 'object') return { ...DEFAULT_RATING_CONFIG };
  const v = input as Record<string, unknown>;
  const assistantUsername = typeof v.assistantUsername === 'string' ? v.assistantUsername.trim().slice(0, 32) : '';
  const postReply = v.postReply === true;
  let maxReplyCharacters = Number(v.maxReplyCharacters);
  if (!Number.isSafeInteger(maxReplyCharacters) || maxReplyCharacters < 80) maxReplyCharacters = 600;
  if (maxReplyCharacters > 2000) maxReplyCharacters = 2000;
  return { assistantUsername, postReply, maxReplyCharacters };
}

export interface RepliedSet {
  /** Topic id -> set of reply ids already scored, kept small. */
  topics: Record<string, string[]>;
}

export function emptyRepliedSet(): RepliedSet {
  return { topics: {} };
}

const MAX_REPLIES_PER_TOPIC = 32;
const MAX_TOPICS = 64;

export function markReplied(set: RepliedSet, topicId: string, replyId: string): RepliedSet {
  const list = set.topics[topicId] || [];
  if (list.includes(replyId)) return set;
  const trimmed = [...list, replyId].slice(-MAX_REPLIES_PER_TOPIC);
  let topics = { ...set.topics, [topicId]: trimmed };
  const topicIds = Object.keys(topics);
  if (topicIds.length > MAX_TOPICS) {
    const surplus = topicIds.slice(0, topicIds.length - MAX_TOPICS);
    const next = { ...topics };
    for (const id of surplus) delete next[id];
    topics = next;
  }
  return { topics };
}

export function hasReplied(set: RepliedSet, topicId: string, replyId: string): boolean {
  return set.topics[topicId]?.includes(replyId) ?? false;
}
