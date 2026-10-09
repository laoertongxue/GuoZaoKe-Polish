/** Stable error codes so the background can map them to a user-visible toast. */
export type RatingErrorCode =
  | 'config_missing'
  | 'config_invalid'
  | 'not_a_reply'
  | 'untrusted_sender'
  | 'topic_fetch_failed'
  | 'reply_not_found'
  | 'provider_error'
  | 'reply_too_long'
  | 'reply_post_failed'
  | 'reply_post_denied';

const MESSAGES: Record<RatingErrorCode, string> = {
  config_missing: '尚未配置评分助手：请在控制选项里填写助手账号名与模型。',
  config_invalid: '评分助手配置不完整或超出允许范围。',
  not_a_reply: '目标楼层不是有效的回帖。',
  untrusted_sender: '评分请求来自不受信任的来源。',
  topic_fetch_failed: '拉取帖子页面失败，请稍后重试。',
  reply_not_found: '目标楼层在当前帖子中已不可见。',
  provider_error: '模型服务未能完成评分。',
  reply_too_long: '评语过长，已被截断。',
  reply_post_failed: '评分回帖发送失败，已保存到草稿。',
  reply_post_denied: '评分回帖被论坛拒绝：可能需要登录或重新授权。',
};

export class RatingError extends Error {
  readonly code: RatingErrorCode;
  constructor(code: RatingErrorCode) {
    super(MESSAGES[code]);
    this.name = 'RatingError';
    this.code = code;
  }
}

export function ratingErrorCode(error: unknown): RatingErrorCode | null {
  if (error instanceof RatingError) return error.code;
  return null;
}
