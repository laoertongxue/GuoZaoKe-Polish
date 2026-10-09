import { describe, expect, it } from 'vitest';
import { scoreHeuristic } from '../src/rating/heuristic';

describe('scoreHeuristic', () => {
  it('rewards more upvotes on a logarithmic scale', () => {
    const low = scoreHeuristic({ text: '短文本', characterCount: 4, upvotes: 0 });
    const mid = scoreHeuristic({ text: '短文本', characterCount: 4, upvotes: 3 });
    const high = scoreHeuristic({ text: '短文本', characterCount: 4, upvotes: 30 });
    expect(low.factors.upvotes).toBeLessThan(mid.factors.upvotes);
    expect(mid.factors.upvotes).toBeLessThan(high.factors.upvotes);
    expect(high.factors.upvotes).toBeLessThanOrEqual(10);
  });

  it('rewards sweet-spot length and penalises very long or very short content', () => {
    const tiny = scoreHeuristic({ text: '啊', characterCount: 1, upvotes: 0 });
    const sweet = scoreHeuristic({ text: '一个普通长度的回复，内容适中。'.repeat(8), characterCount: 96, upvotes: 0 });
    const huge = scoreHeuristic({ text: 'x'.repeat(2000), characterCount: 2000, upvotes: 0 });
    expect(sweet.factors.length).toBe(10);
    expect(tiny.factors.length).toBeLessThan(sweet.factors.length);
    expect(huge.factors.length).toBeLessThan(sweet.factors.length);
  });

  it('penalises high link / emoji / code density', () => {
    const plain = scoreHeuristic({ text: '这是一些没有链接的普通文字。'.repeat(5), characterCount: 100, upvotes: 0 });
    const spammy = scoreHeuristic({ text: 'https://a.com https://b.com https://c.com https://d.com https://e.com', characterCount: 60, upvotes: 0 });
    expect(plain.factors.density).toBeGreaterThan(spammy.factors.density);
  });

  it('returns integer score in 0..10 and never throws on edge inputs', () => {
    for (const sample of [
      { text: '', characterCount: 0, upvotes: 0 },
      { text: '👍👍👍👍', characterCount: 4, upvotes: 999 },
      { text: '中文字符 a b c d e f', characterCount: 18, upvotes: 1 },
    ]) {
      const s = scoreHeuristic(sample);
      expect(Number.isInteger(s.score)).toBe(true);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(10);
      expect(typeof s.summary).toBe('string');
    }
  });
});
