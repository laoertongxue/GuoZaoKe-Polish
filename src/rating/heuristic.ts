import type { HeuristicScore, ReplyContext } from './types';

const LENGTH_SWEET_MIN = 80;
const LENGTH_SWEET_MAX = 800;
const LENGTH_TOO_LONG = 1500;
const WEIGHTS = { upvotes: 0.4, length: 0.2, uniqueness: 0.2, density: 0.2 } as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreUpvotes(value: number): number {
  if (value <= 0) return 0;
  // 1 -> 3, 3 -> 5, 10 -> 7, 30 -> 8.5, 100 -> 9.5
  return clamp(2 + 2 * Math.log10(value), 0, 10);
}

function scoreLength(value: number): number {
  if (value < 8) return 0;
  if (value < LENGTH_SWEET_MIN) return clamp(value / LENGTH_SWEET_MIN * 6, 0, 6);
  if (value <= LENGTH_SWEET_MAX) return 10;
  if (value <= LENGTH_TOO_LONG) return clamp(10 - ((value - LENGTH_SWEET_MAX) / (LENGTH_TOO_LONG - LENGTH_SWEET_MAX)) * 4, 6, 10);
  return 2;
}

function scoreUniqueness(text: string): number {
  const tokens = text.split(/\s+/u).filter(token => /[一-龥A-Za-z0-9]/u.test(token));
  if (tokens.length < 4) return 0;
  const unique = new Set(tokens.map(token => token.toLowerCase()));
  const ratio = unique.size / tokens.length;
  return clamp(ratio * 10, 0, 10);
}

function scoreDensity(text: string): number {
  const urlCount = (text.match(/https?:\/\//gu) || []).length;
  const emojiCount = (text.match(/(?::[a-z0-9_+-]+:|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])/gu) || []).length;
  const codeFence = (text.match(/```/g) || []).length;
  const tokens = Math.max(1, text.length / 4);
  const urlRatio = urlCount / tokens;
  const emojiRatio = emojiCount / tokens;
  const codeRatio = codeFence / tokens;
  let penalty = 0;
  if (urlRatio > 0.05) penalty += Math.min(3, (urlRatio - 0.05) * 30);
  if (emojiRatio > 0.05) penalty += Math.min(2, (emojiRatio - 0.05) * 25);
  if (codeRatio > 0.1) penalty += Math.min(2, (codeRatio - 0.1) * 20);
  return clamp(10 - penalty, 0, 10);
}

function buildSummary(factors: HeuristicScore['factors'], score: number): string {
  if (score >= 8) return '赞同数与表达都很有分量。';
  if (score >= 6) {
    if (factors.uniqueness < 5) return '表达顺畅，但重复词偏多，可再凝练。';
    if (factors.length < 6) return '意思清楚，但篇幅偏短，补充论据会更扎实。';
    return '整体质量稳定。';
  }
  if (score >= 4) {
    if (factors.upvotes < 3) return '观点与篇幅中等，社区反响还不显著。';
    if (factors.density < 5) return '表达可以更紧凑：链接/表情/代码块比例较高。';
    return '可以再展开一些细节。';
  }
  return '内容较短或链接过多，建议补全论据。';
}

/** Local, deterministic scoring for a reply. No network or LLM involvement. */
export function scoreHeuristic(reply: Pick<ReplyContext, 'text' | 'characterCount' | 'upvotes'>): HeuristicScore {
  const factors = {
    upvotes: scoreUpvotes(reply.upvotes),
    length: scoreLength(reply.characterCount),
    uniqueness: scoreUniqueness(reply.text),
    density: scoreDensity(reply.text),
  };
  const weighted = factors.upvotes * WEIGHTS.upvotes + factors.length * WEIGHTS.length + factors.uniqueness * WEIGHTS.uniqueness + factors.density * WEIGHTS.density;
  const total = WEIGHTS.upvotes + WEIGHTS.length + WEIGHTS.uniqueness + WEIGHTS.density;
  const score = Math.round(clamp((weighted / total) * 10, 0, 10));
  return { score, factors, summary: buildSummary(factors, score) };
}
