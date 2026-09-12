import { beforeEach, expect, it, vi } from 'vitest';
import { enhanceProfile } from '../src/features/profile';

beforeEach(() => {
  document.body.innerHTML = `<div class="sidebar-left"><div class="user-page">
    <div class="profile"><div class="ui-header"><a href="/u/demo"><img class="avatar" alt="demo"></a><div class="username">demo</div><span class="label"><a id="follow" href="/f/user/demo">关注</a></span><div class="user-number">第 1 号成员</div></div>
    <div class="ui-content"><dl><dt>ID</dt><dd>demo</dd></dl><dl id="signature"><dt>签名</dt><dd><a href="https://example.com">原签名链接</a></dd></dl><dl><dt>Email</dt><dd>原公开资料</dd></dl></div></div>
    <div class="topic-lists"><div class="ui-header"><span class="title">主题列表</span><a href="/u/demo/replies">更多回复</a></div></div></div></div>
    <div class="sidebar-right"><div class="user-page"><div class="usercard"><div class="status-topic"><a href="/u/demo/topics">2</a></div><div class="status-reply"><a href="/u/demo/replies">3</a></div><div class="status-favorite"><a href="/u/demo/favorites">0</a></div></div></div></div>`;
});

it('个人资料重排保留原节点、顺序和链接监听，停用及销毁恢复原结构', () => {
  const content = document.querySelector('.profile > .ui-content')!;
  const originalFields = Array.from(content.children);
  const signature = document.querySelector('#signature')!;
  const click = vi.fn((event: Event) => event.preventDefault());
  signature.querySelector('a')!.addEventListener('click', click);
  const follow = document.querySelector('#follow');
  const controller = enhanceProfile(true, '/u/demo');
  expect(signature.parentElement).toBe(document.querySelector('.profile > .ui-header'));
  signature.querySelector('a')!.click();
  expect(click).toHaveBeenCalledOnce();
  expect(document.querySelector('#follow')).toBe(follow);
  const nav = document.querySelector<HTMLElement>('.gzk-profile-nav')!;
  expect([...nav.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual(['/u/demo', '/u/demo/topics', '/u/demo/replies', '/u/demo/favorites']);
  expect(nav.querySelector('[aria-current="page"]')!.textContent).toBe('demo');
  controller.update(false);
  expect(Array.from(content.children)).toEqual(originalFields);
  expect(nav.hidden).toBe(true);
  controller.update(true);
  expect(signature.parentElement).toBe(document.querySelector('.profile > .ui-header'));
  controller.destroy();
  expect(Array.from(content.children)).toEqual(originalFields);
  expect(signature.className).toBe('');
  expect(document.querySelector('.gzk-profile-nav')).toBeNull();
});

it('缺少签名或收藏入口时不补造信息，初始停用保持原结构', () => {
  document.querySelector('#signature')!.remove();
  document.querySelector('.status-favorite')!.remove();
  const content = document.querySelector('.profile > .ui-content')!;
  const before = content.innerHTML;
  const controller = enhanceProfile(false, '/u/demo/topics');
  expect(document.querySelector('.gzk-profile-signature')).toBeNull();
  expect(document.querySelector<HTMLElement>('.gzk-profile-nav')!.hidden).toBe(true);
  controller.update(true);
  expect(document.querySelector('[aria-current="page"]')!.textContent).toBe('主题');
  expect(document.querySelectorAll('.gzk-profile-nav a')).toHaveLength(3);
  controller.destroy();
  // Class attributes may be empty after cleanup; the original field content stays intact.
  expect(content.textContent).toBe('IDdemoEmail原公开资料');
  expect(before).toContain('原公开资料');
});

it.each(['topics','replies','favorites'])('个人 %s 子页仍保留四个标签，不串到登录用户', page => {
  document.body.innerHTML='<div class="sidebar-left"><div class="container-box replies-lists"><div class="ui-header">过早客 › demo › 列表</div><div class="ui-content">原列表</div></div></div><div class="sidebar-right"><div class="usercard"><div class="ui-header"><img class="avatar" alt="另一个用户"><span class="username">other_user</span></div><div class="status-topic"><a href="/u/other_user/topics">3</a></div></div></div>';
  const c=enhanceProfile(true,`/u/demo/${page}`);
  expect([...document.querySelectorAll('.gzk-profile-nav a')].map(a=>a.getAttribute('href'))).toEqual(['/u/demo','/u/demo/topics','/u/demo/replies','/u/demo/favorites']);
  expect(document.querySelector('[aria-current="page"]')!.getAttribute('href')).toBe(`/u/demo/${page}`);
  expect(document.querySelector('.gzk-profile-nav img')).toBeNull();c.update(false);expect(document.querySelector<HTMLElement>('.gzk-profile-nav')!.hidden).toBe(true);c.destroy();expect(document.querySelector('.ui-header')!.textContent).toBe('过早客 › demo › 列表');
});
