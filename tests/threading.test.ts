import { expect, it } from 'vitest';
import { buildThreads } from '../src/features/threading';
import type { Reply } from '../src/shared/types';
const r = (floor: number, author: string, mentions: string[] = [], references: number[] = []): Reply => ({id:String(floor),floor,author,mentions,references,avatar:'',html:'',text:'',likes:0,element:document.createElement('div')});
it('明确楼层优先，缺失时选择最近的先前被提及者', () => {
  const rows = [r(1,'a'),r(2,'b'),r(3,'a'),r(4,'c',['a']),r(5,'d',['a'],[1])];
  expect([...buildThreads(rows,true)]).toEqual([['4','3'],['5','1']]);
});
it('不向未来嵌套，不把自己前一条评论当父评论，多提及遵守开关', () => {
  const rows = [r(1,'a',['b']),r(2,'b'),r(3,'c',['a','b']),r(4,'a',['a'])];
  expect([...buildThreads(rows,false)]).toEqual([]);
  expect(buildThreads(rows,true).get('3')).toBe('2');
});
