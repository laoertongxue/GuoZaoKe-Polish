import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaults } from '../src/shared/settings';
import { enhanceReplies } from '../src/features/replies';
import { fetchDocument } from '../src/site/client';
import { voteReply } from '../src/site/vote';
vi.mock('../src/site/client', () => ({ fetchDocument: vi.fn() }));
vi.mock('../src/site/vote', () => ({ voteReply: vi.fn(async () => {}) }));
vi.mock('../src/shared/store', () => ({ saveSettings: vi.fn(async (settings) => ({ settings: { ...defaults, ...settings } })) }));

beforeEach(() => {
  vi.mocked(fetchDocument).mockReset();
  const source = readFileSync('tests/fixtures/topic.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  document.body.innerHTML = new DOMParser().parseFromString(source, 'text/html').body.innerHTML;
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
function addPages(...pages:number[]) {
  const pagination=document.createElement('div');pagination.className='pagination';
  pagination.innerHTML=pages.map(page=>`<a href="/t/133068?p=${page}">${page}</a>`).join('');document.body.append(pagination);
}
function pageReply(id:string,floor:number) {
  const source=document.querySelector('.reply-item')!.outerHTML.replace('reply_id=1560607',`reply_id=${id}`).replace(/>#1</,`>#${floor}<`);
  return new DOMParser().parseFromString(`<div class="topic-reply">${source}</div>`,'text/html');
}
it.each(['?p=2','?page=2'])('与参考一致：当前不是第一页%s时不自动读取其他页', async query => {
  vi.stubGlobal('location',new URL(`https://www.guozaoke.com/t/133068${query}`));addPages(1,3);
  const controller=enhanceReplies({...defaults,preload:true});await Promise.resolve();
  expect(fetchDocument).not.toHaveBeenCalled();controller.destroy();
});
it('已停用增强时即使保存了预加载选项也不发请求', async()=>{
  vi.stubGlobal('location',new URL('https://www.guozaoke.com/t/133068'));addPages(2);
  const controller=enhanceReplies({...defaults,preload:true,enabled:false});await Promise.resolve();
  expect(fetchDocument).not.toHaveBeenCalled();controller.destroy();
});
it.each(['disable','preload-off','destroy'])('分页等待期间%s后丢弃迟到响应，不继续读取或改动回复', async action=>{
  vi.stubGlobal('location',new URL('https://www.guozaoke.com/t/133068'));addPages(2,3);
  const doc=pageReply('900079',79);let resolve!: (doc:Document)=>void;
  vi.mocked(fetchDocument).mockReturnValueOnce(new Promise(yes=>{resolve=yes;})).mockResolvedValue(doc);
  const controller=enhanceReplies({...defaults,preload:true});
  if(action==='disable')controller.update({...defaults,preload:true,enabled:false});else if(action==='preload-off')controller.update({...defaults,preload:false});else controller.destroy();
  resolve(doc);await new Promise(yes=>setTimeout(yes,0));
  expect(document.querySelectorAll('.reply-item')).toHaveLength(78);
  expect(fetchDocument).toHaveBeenCalledTimes(1);controller.destroy();
});
it('等待期间关闭再开启预加载，丢弃旧批次后重新获取',async()=>{
  vi.stubGlobal('location',new URL('https://www.guozaoke.com/t/133068'));addPages(1,2);
  const old=pageReply('900079',79),fresh=pageReply('900080',80);let resolve!:(doc:Document)=>void;
  vi.mocked(fetchDocument).mockReturnValueOnce(new Promise(yes=>{resolve=yes;})).mockResolvedValueOnce(fresh);
  const controller=enhanceReplies({...defaults,preload:true});
  controller.update({...defaults,preload:false});controller.update({...defaults,preload:true});resolve(old);
  await vi.waitFor(()=>expect(document.querySelector('[data-gzk-reply="900080"]')).not.toBeNull());
  expect(document.querySelector('[data-gzk-reply="900079"]')).toBeNull();
  expect(vi.mocked(fetchDocument).mock.calls.map(([url])=>url)).toEqual(Array(2).fill('https://www.guozaoke.com/t/133068?p=2'));
  controller.destroy();
});
it('两页作为一批合并：第二页失败不留半批结果，重试去重且最多读取后续两页', async()=>{
  vi.stubGlobal('location',new URL('https://www.guozaoke.com/t/133068'));addPages(2,3,4);
  const second=pageReply('900079',79),third=pageReply('900080',80);
  vi.mocked(fetchDocument).mockResolvedValueOnce(second).mockRejectedValueOnce(new Error('第三页失败')).mockResolvedValueOnce(second).mockResolvedValueOnce(third);
  const controller=enhanceReplies({...defaults,preload:true});
  await vi.waitFor(()=>expect(document.querySelector('.gzk-reply-status')?.textContent).toContain('第三页失败'));
  controller.update({...defaults,preload:false});
  expect(document.querySelectorAll('.reply-item')).toHaveLength(78);
  expect(document.querySelectorAll('.gzk-preloaded-page')).toHaveLength(0);
  controller.update({...defaults,preload:true});
  await vi.waitFor(()=>expect(document.querySelectorAll('.reply-item')).toHaveLength(80));
  expect(vi.mocked(fetchDocument).mock.calls.map(([url])=>url)).toEqual([2,3,2,3].map(page=>`https://www.guozaoke.com/t/133068?p=${page}`));
  expect(document.querySelectorAll('[data-gzk-reply="900079"]')).toHaveLength(1);controller.destroy();
});
it('成功后标识上下分页栏已合并的页码，错误提示按钮可重试且保留原始链接',async()=>{
  vi.stubGlobal('location',new URL('https://www.guozaoke.com/t/133068'));addPages(2,3,4);addPages(2,3,4);
  vi.mocked(fetchDocument).mockRejectedValueOnce(new Error('网络失败')).mockResolvedValueOnce(pageReply('900079',79)).mockResolvedValueOnce(pageReply('900080',80));
  const controller=enhanceReplies({...defaults,preload:true});
  await vi.waitFor(()=>expect(document.querySelector('.gzk-reply-status button')).not.toBeNull());
  expect(document.querySelectorAll('.gzk-preloaded-page')).toHaveLength(0);
  document.querySelector<HTMLButtonElement>('.gzk-reply-status button')!.click();
  await vi.waitFor(()=>expect(document.querySelectorAll('.gzk-preloaded-page')).toHaveLength(4));
  expect(Array.from(document.querySelectorAll<HTMLAnchorElement>('.gzk-preloaded-page')).map(a=>[a.getAttribute('href'),a.title])).toEqual([2,3,2,3].map(page=>[`/t/133068?p=${page}`,'回复已合并到本页']));
  expect(document.querySelectorAll('[href$="p=4"].gzk-preloaded-page')).toHaveLength(0);controller.destroy();
});
it.each(['disable','destroy'])('已暂存第一页但第二页等待时%s，整批丢弃',async action=>{
  vi.stubGlobal('location',new URL('https://www.guozaoke.com/t/133068'));addPages(2,3);
  const second=pageReply('900079',79),third=pageReply('900080',80);let resolve!:(doc:Document)=>void;
  vi.mocked(fetchDocument).mockResolvedValueOnce(second).mockReturnValueOnce(new Promise(yes=>{resolve=yes;}));
  const controller=enhanceReplies({...defaults,preload:true});
  await vi.waitFor(()=>expect(fetchDocument).toHaveBeenCalledTimes(2));
  if(action==='disable')controller.update({...defaults,enabled:false,preload:true});else controller.destroy();
  resolve(third);await new Promise(yes=>setTimeout(yes,0));
  expect(document.querySelectorAll('.reply-item')).toHaveLength(78);expect(document.querySelectorAll('.gzk-preloaded-page')).toHaveLength(0);controller.destroy();
});
afterEach(() => vi.unstubAllGlobals());

it('嵌套、热评和设置切换保留全部原回复节点及原站绑定', () => {
  const nodes = [...document.querySelectorAll('.reply-item')];
  const handler = vi.fn(event => event.preventDefault());
  const vote = nodes[0]!.querySelector<HTMLElement>('.J_replyVote')!;
  vote.addEventListener('click', handler);
  const controller = enhanceReplies({ ...defaults, preload: false });
  expect(document.querySelectorAll('.gzk-nested').length).toBeGreaterThan(0);
  controller.hot();
  controller.update({ ...defaults, nested: 'off', preload: false });
  expect(document.querySelectorAll('.reply-item')).toHaveLength(78);
  nodes.forEach(node => expect(document.contains(node)).toBe(true));
  vote.click();
  expect(handler).toHaveBeenCalledOnce();
});

it('从热门模式停用增强恢复全部原始楼层', () => {
  const controller = enhanceReplies({ ...defaults, preload: false });
  controller.hot();
  expect(document.querySelectorAll('.reply-item[hidden]').length).toBeGreaterThan(0);
  controller.update({ ...defaults, enabled: false, nested: 'off', autoFold: false, preload: false });
  expect(document.querySelectorAll('.reply-item[hidden]')).toHaveLength(0);
  expect(document.querySelectorAll('.gzk-nested')).toHaveLength(0);
});

it('停用增强恢复原回复锚点、原站回复可见性和楼层行为，重新启用仍可嵌套', () => {
  const row = document.querySelector<HTMLElement>('.reply-item')!;
  row.id = 'native-reply-anchor';
  const reply = row.querySelector<HTMLElement>('.J_replyTo')!;
  const floor = [...row.querySelectorAll<HTMLElement>('.floor')].find(node => node.textContent?.trim() === '#1')!;
  floor.title = '原楼层';
  const nativeClick = vi.fn();
  floor.onclick = nativeClick;
  const controller = enhanceReplies({ ...defaults, preload: false });
  expect(reply.hidden).toBe(true);
  expect(row.id).toBe('gzk-reply-1');
  controller.update({ ...defaults, enabled: false, preload: false });
  expect(row.id).toBe('native-reply-anchor');
  expect(reply.hidden).toBe(false);
  expect(floor.title).toBe('原楼层');
  expect(floor.hasAttribute('role')).toBe(false);
  expect(floor.hasAttribute('tabindex')).toBe(false);
  expect(floor.onclick).toBe(nativeClick);
  expect(row.querySelector('.gzk-folded')).toBeNull();
  expect(document.querySelectorAll('.gzk-nested')).toHaveLength(0);
  controller.update({ ...defaults, preload: false });
  expect(row.id).toBe('gzk-reply-1');
  expect(reply.hidden).toBe(true);
  expect(document.querySelectorAll('.gzk-nested').length).toBeGreaterThan(0);
  controller.destroy();
  expect(row.id).toBe('native-reply-anchor');
  expect(reply.hidden).toBe(false);
  expect(floor.onclick).toBe(nativeClick);
});

it('全局停用撤回已合并分页，保留本页节点和分页原文，重新启用可重新预加载', async () => {
  vi.stubGlobal('location', new URL('https://www.guozaoke.com/t/133068'));
  const nativeRows = [...document.querySelectorAll('.reply-item')];
  addPages(2);
  const pageLink = document.querySelector<HTMLAnchorElement>('.pagination a[href$="p=2"]')!;
  pageLink.title = '原分页说明';
  vi.mocked(fetchDocument).mockImplementation(async () => pageReply('900079', 79));
  const controller = enhanceReplies({ ...defaults, preload: true });
  await vi.waitFor(() => expect(document.querySelectorAll('.reply-item')).toHaveLength(79));
  controller.update({ ...defaults, enabled: false, preload: true });
  expect([...document.querySelectorAll('.reply-item')]).toEqual(nativeRows);
  expect(pageLink.title).toBe('原分页说明');
  expect(pageLink.classList.contains('gzk-preloaded-page')).toBe(false);
  controller.update({ ...defaults, preload: true });
  await vi.waitFor(() => expect(document.querySelectorAll('.reply-item')).toHaveLength(79));
  expect(fetchDocument).toHaveBeenCalledTimes(2);
  controller.destroy();
});

it('原站点赞成功更新 data-count 后，热评立即使用真实新赞数', async () => {
  const controller = enhanceReplies({ ...defaults, preload: false });
  controller.hot();
  const row = document.getElementById('gzk-reply-2')!;
  expect(row.hidden).toBe(true);
  row.querySelector<HTMLElement>('.J_replyVote')!.dataset.count = '100';
  await vi.waitFor(() => expect(row.hidden).toBe(false));
  expect(document.querySelector('.topic-reply > .ui-content > .reply-item')).toBe(row);
  controller.destroy();
});

it('预加载去重并为新回复保留头像和用户主动点赞能力', async () => {
  vi.stubGlobal('location', new URL('https://www.guozaoke.com/t/133068'));
  const pagination = document.createElement('div');
  pagination.className = 'pagination';
  pagination.innerHTML = '<a href="/t/133068?p=2">2</a>';
  document.body.append(pagination);
  const original = document.querySelector('.reply-item')!.outerHTML;
  const incoming = original.replace('reply_id=1560607', 'reply_id=900079').replace(/>#1</, '>#79<');
  vi.mocked(fetchDocument).mockResolvedValue(new DOMParser().parseFromString(`<div class="topic-reply">${original}${incoming}${incoming}</div>`, 'text/html'));
  const controller = enhanceReplies({ ...defaults, preload: true });
  await vi.waitFor(() => expect(document.querySelectorAll('.reply-item')).toHaveLength(79));
  const row = document.querySelector<HTMLElement>('[data-gzk-reply="900079"]')!;
  expect(row.querySelector('.avatar')).not.toBeNull();
  const vote = row.querySelector<HTMLButtonElement>('.J_replyVote')!;
  vote.click();
  await vi.waitFor(() => expect(voteReply).toHaveBeenCalledWith('900079'));
  expect(vote.dataset.count).toBe('6');
  expect(vote.disabled).toBe(true);
  controller.destroy();
});

it('只将引用插入原草稿，保留表单字段且不提交', async () => {
  const form = document.createElement('form');
  form.innerHTML = '<input type="hidden" name="csrf" value="keep"><textarea class="J_replyContent">原草稿</textarea>';
  document.body.append(form);
  const submitted = vi.fn(event => event.preventDefault());
  form.addEventListener('submit', submitted);
  const input = form.querySelector('textarea')!;
  input.setSelectionRange(3, 3);
  enhanceReplies({ ...defaults, preload: false });
  document.querySelector<HTMLButtonElement>('.gzk-reply-action')!.click();
  await vi.waitFor(() => expect(input.value).toBe('原草稿@tommmmm #1 '));
  expect(form.querySelector<HTMLInputElement>('[name="csrf"]')!.value).toBe('keep');
  expect(submitted).not.toHaveBeenCalled();
});
