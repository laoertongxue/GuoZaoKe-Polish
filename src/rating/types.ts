/** Reply metadata captured for scoring and posting the assistant's review. */
export interface ReplyContext {
  /** Numeric id used by the Guozaoke reply form's hidden field. */
  replyId: string;
  topicId: string;
  topicUrl: string;
  author: string;
  text: string;
  upvotes: number;
  /** Total reply length in characters, including markdown and code blocks. */
  characterCount: number;
}

/** Configurable runtime parameters for the rating assistant. */
export interface RatingConfig {
  /** Username that triggers a review when mentioned in a reply (no leading @). */
  assistantUsername: string;
  /**
   * Whether a scan should also post the review as a reply. The reply is published with
   * whichever Guozaoke account is logged in in this browser, so it is opt-in.
   */
  postReply: boolean;
  /** Max characters the assistant allows itself in a single reply. */
  maxReplyCharacters: number;
}

export const DEFAULT_RATING_CONFIG: RatingConfig = {
  assistantUsername: '',
  postReply: false,
  maxReplyCharacters: 600,
};

/** Output of the deterministic heuristic scorer. */
export interface HeuristicScore {
  /** Integer 0..10, rounded from the weighted sum. */
  score: number;
  /** Per-axis contributions before rounding (each axis 0..10). */
  factors: {
    upvotes: number;
    length: number;
    uniqueness: number;
    density: number;
  };
  /** Short Chinese summary used when the LLM path is disabled. */
  summary: string;
}

export interface RatingResult {
  score: number;
  comment: string;
  provider: 'heuristic';
}
