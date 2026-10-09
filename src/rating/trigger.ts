/** A mention match in a reply, found via @username. */
export interface MentionMatch {
  username: string;
  start: number;
  end: number;
}

/** Capture the trigger token (the username only) and the surrounding context. */
export interface TriggerHit {
  username: string;
  index: number;
  context: string;
}

/** Find plain @username tokens in the reply body. Username: a-z, 0-9, _, -, length 1..32. */
export function findMentions(text: string): MentionMatch[] {
  const re = /(?:^|[^一-龥A-Za-z0-9_])(?:@([A-Za-z0-9_-]{1,32}))/g;
  const out: MentionMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push({ username: match[1]!, start: match.index + match[0].indexOf('@'), end: match.index + match[0].length });
  }
  return out;
}

/** Return the first mention that matches the configured assistant username. */
export function detectTrigger(text: string, assistantUsername: string): TriggerHit | null {
  if (!assistantUsername) return null;
  const needle = assistantUsername.trim().toLowerCase();
  if (!needle) return null;
  for (const m of findMentions(text)) {
    if (m.username.toLowerCase() === needle) {
      return { username: m.username, index: m.start, context: text.slice(Math.max(0, m.start - 16), Math.min(text.length, m.end + 32)) };
    }
  }
  return null;
}

/** True when the assistant was already addressed in a previous reply for the same topic. */
export function alreadyAddressed(replies: Array<{ author: string }>, assistantUsername: string): boolean {
  if (!assistantUsername) return false;
  return replies.some(r => r.author.trim().toLowerCase() === assistantUsername.trim().toLowerCase());
}
