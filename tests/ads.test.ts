import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { applyPageAppearance } from '../src/features/page-bootstrap';
import { validateSettings } from '../src/shared/settings';
import { installAdFilter } from '../src/features/ads';

let filter: ReturnType<typeof installAdFilter>;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// Use the shipped stylesheet against ad containers and normal forum content.
beforeEach(() => {
  const sheet = document.createElement('style');
  sheet.dataset.testAds = '';
  sheet.textContent = readFileSync('src/styles/ads.css', 'utf8');
  document.head.append(sheet);
  document.body.innerHTML = `
    <main><article class="topic-detail">讨论广告的正文 <a href="https://example.com/ads">普通链接</a></article></main>
    <aside class="sidebar-right"><div class="usercard">账户</div><div class="hot-topics">相关主题</div>
      <div class="sidebox container-box mt10" data-ad-test><div class="ui-content ad"><a href="/ad/3"><img class="openparty" alt="站点推广"></a></div></div>
      <div class="sidebox container-box mt10" data-ad-test><div class="ui-content ad"><a href="/ad/4"><img class="openparty" alt="站点推广"></a></div></div>
      <div class="google-auto-placed" data-ad-test><ins class="adsbygoogle"></ins></div>
    </aside>
    <ins class="adsbygoogle adsbygoogle-noablate" style="position:fixed;bottom:0;height:100px;display:block!important" data-anchor-status="displayed" data-ad-test><div class="grippy-host"></div></ins>
    <div class="google-side-rail" data-ad-test></div>
    <div id="aswift_2_host" data-ad-test></div>
    <iframe id="google_ads_iframe_123" data-ad-test></iframe>
    <iframe title="正常嵌入内容"></iframe><footer>Made by 拾贰画生</footer>`;
  filter = installAdFilter();
});
afterEach(() => {
  filter.destroy();
  document.querySelector('[data-test-ads]')?.remove();
  document.body.replaceChildren();
  document.documentElement.className = '';
  delete document.documentElement.dataset.gzkTheme;
  document.body.removeAttribute('style');
});

it('旧版设置隐藏原生推广整卡及带内联 important 的浮动广告，保留正常内容', async () => {
  applyPageAppearance(document.documentElement, validateSettings({ theme: 'light' }), false);
  await flush();
  for (const ad of document.querySelectorAll('[data-ad-test]')) expect(getComputedStyle(ad).display).toBe('none');
  for (const content of document.querySelectorAll('main,article,article a,.sidebar-right,.usercard,.hot-topics,iframe[title],footer')) {
    expect(getComputedStyle(content).display).not.toBe('none');
  }
});

it('延迟广告也隐藏，关闭过滤或总开关均恢复原节点和内联优先级', async () => {
  const original = document.body.innerHTML;
  applyPageAppearance(document.documentElement, validateSettings({}), false);
  await flush();
  const late = document.createElement('ins');
  late.className = 'adsbygoogle';
  document.body.append(late);
  expect(getComputedStyle(late).display).toBe('none');
  late.remove();
  for (const settings of [{ hideAds: false }, { enabled: false }]) {
    applyPageAppearance(document.documentElement, validateSettings({}), false);
    await flush();
    applyPageAppearance(document.documentElement, validateSettings(settings), false);
    await flush();
    for (const ad of document.querySelectorAll('[data-ad-test]')) expect(getComputedStyle(ad).display).not.toBe('none');
    // CSSOM serializes the restored style; the nodes and important priority survive.
    expect(document.querySelector('ins[data-anchor-status]')?.getAttribute('style')).toContain('display: block !important');
    expect(document.body.innerHTML.replace(/style="[^"]*"/g, '')).toBe(original.replace(/style="[^"]*"/g, ''));
  }
});

it('封闭 Shadow DOM 的收起按钮与动态刷新均隐藏，关闭后恢复广告最新样式', async () => {
  applyPageAppearance(document.documentElement, validateSettings({}), false);
  await flush();
  const host = document.createElement('div');
  host.className = 'grippy-host';
  host.style.setProperty('display', 'block', 'important');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = '<button>收起广告</button>';
  document.body.append(host);
  await flush();
  expect(host.shadowRoot).toBeNull();
  expect(getComputedStyle(host).display).toBe('none');
  host.style.setProperty('display', 'flex', 'important');
  host.style.top = '100px';
  await flush();
  expect(getComputedStyle(host).display).toBe('none');
  applyPageAppearance(document.documentElement, validateSettings({ hideAds: false }), false);
  await flush();
  expect(getComputedStyle(host).display).toBe('flex');
  expect(host.style.top).toBe('100px');
  expect(shadow.querySelector('button')?.textContent).toBe('收起广告');
});

it('保留广告前的页面边距，延迟出现的广告占位不污染基线，销毁后还原', async () => {
  filter.destroy();
  document.querySelector('ins[data-anchor-status]')?.remove();
  document.body.style.padding = '12px 18px 24px';
  filter = installAdFilter();
  applyPageAppearance(document.documentElement, validateSettings({}), false);
  await flush();
  expect(document.documentElement.hasAttribute('data-gzk-ad-anchor')).toBe(false);
  const anchor = document.createElement('ins');
  anchor.className = 'adsbygoogle';
  anchor.dataset.anchorStatus = 'displayed';
  document.body.append(anchor);
  document.body.style.paddingBottom = '154px';
  await flush();
  expect(document.documentElement.style.getPropertyValue('--gzk-ad-padding-top')).toBe('12px');
  expect(document.documentElement.style.getPropertyValue('--gzk-ad-padding-bottom')).toBe('24px');
  expect(document.documentElement.hasAttribute('data-gzk-ad-anchor')).toBe(true);
  expect(document.body.style.paddingBottom).toBe('154px');
  anchor.remove(); // Google may remove the slot before removing its padding.
  await flush();
  expect(document.documentElement.hasAttribute('data-gzk-ad-anchor')).toBe(true);
  filter.destroy();
  expect(document.documentElement.hasAttribute('data-gzk-ad-anchor')).toBe(false);
  expect(document.body.style.paddingBottom).toBe('154px');
  expect(document.body.style.paddingLeft).toBe('18px');
});

it('已有浮动广告时采用原站零纵向边距，并在元素失去广告标记后恢复显示', async () => {
  document.body.style.paddingBottom = '130px';
  applyPageAppearance(document.documentElement, validateSettings({}), false);
  await flush();
  expect(document.documentElement.style.getPropertyValue('--gzk-ad-padding-bottom')).toBe('0px');
  const ad = document.querySelector<HTMLElement>('ins[data-anchor-status]')!;
  ad.className = 'normal-embed';
  await flush();
  expect(getComputedStyle(ad).display).toBe('block');
});
