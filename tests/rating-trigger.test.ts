import { describe, expect, it } from 'vitest';
import { alreadyAddressed, detectTrigger, findMentions } from '../src/rating/trigger';

describe('rating trigger', () => {
  it('detects a single @mention ignoring surrounding text', () => {
    const mentions = findMentions('请 @gzk-judge 看看这条');
    expect(mentions).toEqual([{ username: 'gzk-judge', start: 2, end: 12 }]);
  });

  it('detects multiple mentions separated by ASCII whitespace', () => {
    const text = '感谢 @alice 两位对 @gzk-JUDGE 的回评 @bob 也来';
    const mentions = findMentions(text);
    expect(mentions.map(m => m.username)).toEqual(['alice', 'gzk-JUDGE', 'bob']);
  });

  it('ignores @ glued to Chinese characters', () => {
    expect(findMentions('我@他 说不行')).toEqual([]);
    expect(findMentions('和@bob')).toEqual([]);
  });

  it('ignores @ that is glued to Chinese characters', () => {
    const mentions = findMentions('我@他 说不行');
    expect(mentions).toEqual([]);
  });

  it('returns the first matching trigger case-insensitively', () => {
    const hit = detectTrigger('请 @GZK-JUDGE 看看', 'gzk-judge');
    expect(hit).not.toBeNull();
    expect(hit?.username).toBe('GZK-JUDGE');
    expect(hit?.context).toContain('@GZK-JUDGE');
  });

  it('returns null when the configured assistant name is empty', () => {
    expect(detectTrigger('@anyone 看看', '')).toBeNull();
  });

  it('returns null when no mention matches', () => {
    expect(detectTrigger('@someone-else 来评', 'gzk-judge')).toBeNull();
  });

  it('detects whether the assistant already replied in this topic', () => {
    const replies = [
      { author: 'alice' },
      { author: 'GZK-JUDGE' },
      { author: 'bob' },
    ];
    expect(alreadyAddressed(replies, 'gzk-judge')).toBe(true);
    expect(alreadyAddressed([{ author: 'alice' }], 'gzk-judge')).toBe(false);
  });
});
