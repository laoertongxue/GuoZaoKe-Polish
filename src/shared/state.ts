import { defaults, validateSettings, type Settings } from './settings';
import { topicUrl, safeLink } from '../site/urls';
import type { ReadingItem } from './types';
export interface AppState { settings:Settings; tags:Record<string,string[]>; reading:ReadingItem[]; }
export const initialState=():AppState=>({settings:{...defaults},tags:{},reading:[]});
const object=(v:unknown):Record<string,unknown>=>{
  if (!v || typeof v!=='object'||Array.isArray(v)) throw new Error('数据格式不正确');
  return v as Record<string,unknown>;
};
function tagsOf(value:unknown):Record<string,string[]> {
  const out:Record<string,string[]>={};
  for (const [name,tags] of Object.entries(object(value))) {
    if (!/^[\w-]{1,80}$/.test(name) || ['__proto__','constructor','prototype'].includes(name)) throw new Error('用户名格式不正确');
    if (!Array.isArray(tags)||tags.length>20||tags.some(t=>typeof t!=='string'||t.length>60)) throw new Error('每位用户最多20个标签，每个标签最多60字');
    const clean=[...new Set((tags as string[]).map(t=>t.trim()).filter(Boolean))];
    if (clean.length) out[name]=clean;
  }
  return out;
}
function readingOf(value:unknown):ReadingItem {
  const x=object(value), url=topicUrl(String(x.url)), id=url.split('/').pop()!;
  if (x.id!==id || typeof x.title!=='string'||!x.title.trim()||x.title.length>1000) throw new Error('阅读条目格式不正确');
  return {id,url,title:x.title,author:String(x.author||'').slice(0,80),avatar:safeLink(String(x.avatar||'')),node:String(x.node||'').slice(0,100),replies:Number.isSafeInteger(x.replies)&&Number(x.replies)>=0?Number(x.replies):0,time:String(x.time||'').slice(0,100),addedAt:typeof x.addedAt==='number'&&Number.isFinite(x.addedAt)?x.addedAt:Date.now(),read:x.read===true};
}
export function validateBackup(value:unknown):AppState {
  const x=object(value);
  if (x.version!==1) throw new Error('不支持此备份版本');
  if (!Array.isArray(x.reading)||x.reading.length>1000) throw new Error('阅读列表格式错误或超过1000条');
  const reading=x.reading.map(readingOf);
  if (new Set(reading.map(t=>t.id)).size!==reading.length) throw new Error('备份包含重复主题');
  return {settings:validateSettings(x.settings),tags:tagsOf(x.tags),reading};
}
export function applyAction(state:AppState,action:string,payload?:unknown):AppState {
  const next=structuredClone(state);
  switch (action) {
    case 'settings': next.settings=validateSettings({...next.settings,...object(payload)}); break;
    case 'tags': {const x=object(payload); const name=String(x.username); const incoming=tagsOf({[name]:x.tags}); delete next.tags[name]; Object.assign(next.tags,incoming); break;}
    case 'reading:add': { const item=readingOf(payload); if (!next.reading.some(t=>t.id===item.id)) { if (next.reading.length>=1000) throw new Error('阅读列表已满，请先整理'); next.reading.unshift(item); } break; }
    case 'reading:remove': next.reading=next.reading.filter(t=>t.id!==payload); break;
    case 'reading:read': { const x=object(payload); if (typeof x.read!=='boolean') throw new Error('已读状态无效'); next.reading=next.reading.map(t=>t.id===x.id?{...t,read:x.read as boolean}:t); break; }
    case 'reset': next.settings={...defaults}; break;
    case 'import': return validateBackup(payload);
    default: throw new Error('未知数据操作');
  }
  return next;
}
