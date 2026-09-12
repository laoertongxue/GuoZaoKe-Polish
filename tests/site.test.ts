import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTopics, parseTopic, parseReplies, parseMember, parseAccount } from '../src/site/parse';
import { readableUrl } from '../src/site/urls';
const fixture = (name: string) => new DOMParser().parseFromString(readFileSync(`tests/fixtures/${name}.html`, 'utf8').replace(/<head>[\s\S]*?<\/head>/i, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), 'text/html');
describe('脱敏页面结构适配', () => {
  it('读取首页结构的主题身份、作者和回复数', () => {
    const topics = parseTopics(fixture('home'));
    expect(topics.length).toBeGreaterThan(25);
    expect(topics[0]).toMatchObject({ id: '133088', author: 'guozaoke', replies: 1 });
    expect(topics[0]?.url).toBe('https://www.guozaoke.com/t/133088');
  });
  it('从脱敏主题结构提取示例正文、78条评论和赞数', () => {
    const doc = fixture('topic');
    expect(parseTopic(doc, 'https://www.guozaoke.com/t/133068')).toMatchObject({ id: '133068', author: 'ipvantowuhan', replies: 78 });
    expect(parseTopic(doc, 'https://www.guozaoke.com/t/133068').text).toContain('家用');
    const replies = parseReplies(doc);
    expect(replies).toHaveLength(78);
    expect(replies[0]).toMatchObject({ id: '1560607', floor: 1, likes: 5, author: 'tommmmm' });
    expect(replies[2]?.mentions).toEqual(['s32967326']);
  });
  it('从用户页读取用户卡，游客不冒充登录', () => {
    expect(parseMember(fixture('member'), 'guozaoke').username).toBe('guozaoke');
    expect(parseAccount(fixture('home')).username).toBe('');
  });
  it('拒绝任意主机、写操作URL和伪装路径', () => {
    for (const url of ['https://evil.com/t/1', '/logout', '/vote?topic_id=1', '/favorite?topic_id=1', 'https://www.guozaoke.com@evil.com/', '/t/../logout', '/t/1?delete=1']) expect(() => readableUrl(url)).toThrow();
    expect(readableUrl('/t/123?p=2')).toBe('https://www.guozaoke.com/t/123?p=2');
  });
});
