import { expect, it, vi } from 'vitest';
import { createShareCard, prepareShareImages, ShareImageError } from '../src/features/share-card';
import type { TopicDetail } from '../src/shared/types';
const topic: TopicDetail = { id:'1', url:'https://www.guozaoke.com/t/1', title:'包含格式与图片的分享', author:'alice', avatar:'https://image.example.com/avatar.png', node:'分享', replies:4, time:'2026-09-12 10:00', html:'<h3>标题</h3><p><strong>加粗</strong>和<a href="/t/2">链接</a></p><img src="https://image.example.com/body.png"><pre>const x = 1;</pre><script>bad()</script>', text:'标题 加粗和链接' };
it('分享卡片保留正文格式、头像、日期、图片和可选二维码，并清理脚本', () => {
  const card = createShareCard(topic, 'data:image/png;base64,cXI=');
  expect(card.querySelector('strong')?.textContent).toBe('加粗');
  expect(card.querySelector('.share-content h3')?.textContent).toBe('标题');
  expect(card.querySelector('pre')?.textContent).toBe('const x = 1;');
  expect(card.querySelector('script')).toBeNull();
  expect(card.querySelector('.share-date')?.textContent).toBe('2026-09-12');
  expect(card.querySelector('.share-qr img')?.getAttribute('src')).toBe('data:image/png;base64,cXI=');
  expect(card.querySelector('.share-content img')?.getAttribute('data-share-source')).toBe('https://image.example.com/body.png');
  expect(createShareCard(topic).querySelector('.share-qr')).toBeNull();
});
it('导出前内联图片，保持预览原DOM和链接不变', async () => {
  const original = createShareCard(topic);
  const prepared = await prepareShareImages(original, async () => ({ data:'data:image/png;base64,cG5n' }));
  expect(prepared).not.toBe(original);
  expect([...prepared.querySelectorAll('img')].every(img=>img.src.startsWith('data:image/png'))).toBe(true);
  expect(original.querySelector('.share-avatar')?.getAttribute('data-share-source')).toBe(topic.avatar);
});
it.each(['',';charset=iso-8859-1'])('SVG%s只作为img数据源保存，重复导出复用已内联数据，不插入SVG文档或脚本节点',async charset=>{
  const svg='<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script><rect width="20" height="20" fill="green"/></svg>';
  const data=`data:image/svg+xml${charset};base64,${btoa(svg)}`;
  const read=vi.fn(async()=>({data})),card=createShareCard({...topic,avatar:'',html:'<img src="https://image.example.com/vector.svg" alt="矢量图">'});
  const prepared=await prepareShareImages(card,read);
  expect(prepared.querySelector('img')?.getAttribute('src')).toBe(data);
  expect(prepared.querySelector('img')?.alt).toBe('矢量图');
  expect(prepared.querySelector('svg,script,iframe,object')).toBeNull();
  expect(card.querySelector('img')?.hasAttribute('src')).toBe(false);
  await prepareShareImages(prepared,read);expect(read).toHaveBeenCalledTimes(1);
});
it('预览挂载前不创建可触发远端请求的图像，包括头像、正文和附言', () => {
  const card = createShareCard({ ...topic, supplements:[{html:'<img src="http://127.0.0.1/private.png"><img src="https://other.example.com/extra.png">'}] });
  document.body.append(card);
  expect([...card.querySelectorAll('img')].every(img => !img.hasAttribute('src') && !img.hasAttribute('srcset'))).toBe(true);
  expect(card.querySelectorAll('[data-share-source]')).toHaveLength(4);
  card.remove();
});
it('清理传统HTML背景图属性，阻止其绕过受控图片读取', () => {
  const card = createShareCard({...topic, html:'<table background="http://127.0.0.1/private.png"><tr><td background="https://other.example.com/cookie.png">正文</td></tr></table>'});
  expect(card.querySelectorAll('[background]')).toHaveLength(0);
  expect(card.querySelector('td')?.textContent).toBe('正文');
});
it('失败明细区分每张图片的来源，且不暴露URL查询参数', async () => {
  const card = createShareCard({...topic, avatar:topic.avatar+'?secret=one', html:'<img src="https://other.example.com/body.png?secret=two">'});
  let error: ShareImageError | undefined;
  try { await prepareShareImages(card, async()=>{throw new Error('不支持的图片格式');}); } catch (failure) { error = failure as ShareImageError; }
  expect(error?.failures).toHaveLength(2);
  expect(error?.message).toContain('https://image.example.com/avatar.png');
  expect(error?.message).toContain('https://other.example.com/body.png');
  expect(error?.message).not.toContain('secret');
});
it('任一图片缺少权限时阻止生成残缺PNG，汇总去重后的来源', async () => {
  const card = createShareCard(topic);
  let failure: unknown;
  try { await prepareShareImages(card, async () => ({ permission:'https://image.example.com/*' })); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ShareImageError);
  expect((failure as ShareImageError).origins).toEqual(['https://image.example.com/*']);
  expect((failure as ShareImageError).message).toContain('2');
});
