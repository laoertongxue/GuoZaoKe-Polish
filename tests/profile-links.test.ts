import { beforeEach, expect, it } from 'vitest';
import { enhanceProfile } from '../src/features/profile';

beforeEach(() => {
  document.body.innerHTML = `<div class="sidebar-left"><div class="user-page">
    <div class="profile"><div class="ui-header"><a href="javascript:alert(1)"><img class="avatar" alt="demo"></a><div class="username">demo</div></div>
    <div class="ui-content"><dl><dt>ID</dt><dd>demo</dd></dl></div></div>
    <div class="topic-lists"><div class="ui-header"><span class="title">主题列表</span></div></div></div></div>
    <div class="sidebar-right"><div class="user-page"><div class="usercard">
      <div class="status-topic"><a href="javascript:alert(2)">2</a></div>
      <div class="status-reply"><a href="data:text/html,evil">3</a></div>
      <div class="status-favorite"><a href="/u/demo/favorites">4</a></div>
    </div></div></div>`;
});

it('never writes a non-http(s) href from the host page into the profile navigation', () => {
  enhanceProfile(true, '/u/demo');
  const hrefs = [...document.querySelectorAll<HTMLAnchorElement>('.gzk-profile-nav a')].map(a => a.getAttribute('href') ?? '');
  expect(hrefs.length).toBeGreaterThan(0);
  // Either an absolute http(s) URL or a same-site path.
  for (const href of hrefs) expect(href).toMatch(/^(https?:\/\/|\/(?!\/))/);
  expect(hrefs.some(href => href.startsWith('javascript:') || href.startsWith('data:'))).toBe(false);
});

it('falls back to a same-site profile URL when the host home link is unsafe', () => {
  enhanceProfile(true, '/u/demo');
  const first = document.querySelector<HTMLAnchorElement>('.gzk-profile-nav a')!;
  expect(first.getAttribute('href')).toBe('/u/demo');
});
