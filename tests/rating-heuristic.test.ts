import { describe, expect, it } from 'vitest';
import { scoreHeuristic } from '../src/rating/heuristic';

const NATURAL_ZH = '我觉得这个问题要分两步看。第一是预算，如果预算有限，优先考虑二手车的车况检查；第二是使用场景，城市通勤和长途自驾对动力、油耗和空间的要求完全不同，建议先把场景列清楚，再对比几款候选车型的保养成本和残值。';

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

  it('final score separates low-quality input from solid content instead of saturating at 10', () => {
    const empty = scoreHeuristic({ text: '', characterCount: 0, upvotes: 0 });
    const junk = scoreHeuristic({ text: '哈哈', characterCount: 2, upvotes: 0 });
    const spam = scoreHeuristic({ text: 'https://a.com https://b.com https://c.com', characterCount: 44, upvotes: 0 });
    const solid = scoreHeuristic({ text: NATURAL_ZH, characterCount: NATURAL_ZH.length, upvotes: 20 });
    expect(empty.score).toBeLessThanOrEqual(3);
    expect(junk.score).toBeLessThanOrEqual(3);
    expect(spam.score).toBeLessThanOrEqual(3);
    expect(solid.score).toBeGreaterThanOrEqual(7);
    expect(solid.score).toBeGreaterThan(junk.score);
  });

  it('measures variety in unspaced Chinese text by bigrams, so varied prose is not treated as repetitive', () => {
    const varied = scoreHeuristic({ text: NATURAL_ZH, characterCount: NATURAL_ZH.length, upvotes: 0 });
    const repeated = scoreHeuristic({ text: '哈'.repeat(40), characterCount: 40, upvotes: 0 });
    expect(varied.factors.uniqueness).toBeGreaterThan(8);
    expect(repeated.factors.uniqueness).toBeLessThan(3);
  });
});
