import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { applyPageAppearance } from '../src/features/page-bootstrap';
import { validateSettings } from '../src/shared/settings';

// Use the shipped stylesheet against ad containers and normal forum content.
beforeEach(() => {
  const sheet = document.createElement('style');
  sheet.dataset.testAds = '';
  sheet.textContent = readFileSync('src/styles/ads.css', 'utf8');
  document.head.append(sheet);
  document.body.innerHTML = `
    <main><article class="topic-detail">讨论广告的正文 <a href="https://example.com/ads">普通链接</a></article></main>
    <aside class="sidebar-right"><div class="usercard">账户</div><div class="hot-topics">相关主题</div>
      <div class="google-auto-placed" data-ad-test><ins class="adsbygoogle"></ins></div>
    </aside>
    <ins class="adsbygoogle adsbygoogle-noablate" style="position:fixed;bottom:0;height:100px;display:block" data-ad-test></ins>
    <div class="google-side-rail" data-ad-test></div>
    <div id="aswift_2_host" data-ad-test></div>
    <iframe id="google_ads_iframe_123" data-ad-test></iframe>
    <iframe title="正常嵌入内容"></iframe><footer>Made by 拾贰画生</footer>`;
});
afterEach(() => {
  document.querySelector('[data-test-ads]')?.remove();
  document.body.replaceChildren();
  document.documentElement.className = '';
  delete document.documentElement.dataset.gzkTheme;
});

it('旧版设置默认隐藏广告，保留正文、侧栏和非广告 iframe', () => {
  applyPageAppearance(document.documentElement, validateSettings({ theme: 'light' }), false);
  for (const ad of document.querySelectorAll('[data-ad-test]')) expect(getComputedStyle(ad).display).toBe('none');
  for (const content of document.querySelectorAll('main,article,article a,.sidebar-right,.usercard,.hot-topics,iframe[title],footer')) {
    expect(getComputedStyle(content).display).not.toBe('none');
  }
});

it('无需再次扫描即可隐藏稍后插入的广告，关闭过滤或总开关均恢复原节点', () => {
  const original = document.body.innerHTML;
  applyPageAppearance(document.documentElement, validateSettings({}), false);
  const late = document.createElement('ins');
  late.className = 'adsbygoogle';
  document.body.append(late);
  expect(getComputedStyle(late).display).toBe('none');
  late.remove();
  for (const settings of [{ hideAds: false }, { enabled: false }]) {
    applyPageAppearance(document.documentElement, validateSettings(settings), false);
    for (const ad of document.querySelectorAll('[data-ad-test]')) expect(getComputedStyle(ad).display).not.toBe('none');
    expect(document.body.innerHTML).toBe(original);
  }
});
