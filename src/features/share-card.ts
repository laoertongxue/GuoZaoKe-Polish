import { rasterizeShareCard } from './share-render';
import QRCode from 'qrcode';
import { el, richHtml } from '../shared/ui';
import { safeLink } from '../site/urls';
import type { ShareImageResult } from '../site/share-images';
import { imageSourceLabel } from '../site/share-images';
import type { TopicDetail } from '../shared/types';
import '../styles/share.css';
export type ShareTopic = TopicDetail & { supplements?: { html: string }[] };
export type ReadShareImage = (url: string) => Promise<ShareImageResult>;
const inlineShareImage=/^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml(?:;charset=[A-Za-z0-9._-]+)?);base64,[A-Za-z0-9+/]+=*$/;
export class ShareImageError extends Error {
  constructor(public readonly origins: string[], public readonly failures: string[], count: number) {
    super(`${count} 张图片未能读取，尚未生成图片。${failures.length ? ` ${failures.join('；')}` : '可授权下列图片来源后重试。'}`); this.name = 'ShareImageError';
  }
}
export function createShareCard(topic: ShareTopic, qr?: string, supplements = true): HTMLElement {
  const card = el('article', '', 'share-card'), inside = el('div', '', 'share-card-inner');
  inside.append(el('div', '过早客', 'share-brand'), el('h1', topic.title, 'share-title'));
  const meta = el('div', '', 'share-meta'), src = safeLink(topic.avatar, topic.url);
  if (src) { const avatar = el('img', '', 'share-avatar'); avatar.referrerPolicy = 'no-referrer'; avatar.dataset.shareSource = src; avatar.alt = topic.author; meta.append(avatar); }
  else meta.append(el('span', topic.author.slice(0, 1).toUpperCase(), 'share-avatar-fallback'));
  meta.append(el('span', topic.author, 'share-author'), el('time', topic.time.match(/\d{4}-\d{2}-\d{2}/)?.[0] || topic.time, 'share-date')); inside.append(meta);
  const content = el('div', '', 'share-content'); richHtml(content, topic.html, topic.url, {deferImages:true});
  content.querySelectorAll('img').forEach(img => { img.referrerPolicy = 'no-referrer'; img.loading = 'eager'; });
  if (supplements) for (const item of topic.supplements || []) { const quote = el('blockquote'); richHtml(quote, item.html, topic.url, {deferImages:true}); content.append(quote); }
  inside.append(content);
  if (qr) { const row = el('div', '', 'share-qr'), hint = el('p', '长按扫码\n查看详情'), image = el('img'); image.src = qr; image.alt = '主题二维码'; row.append(hint, image); inside.append(row); }
  const source = el('a', topic.url, 'share-source'); source.href = topic.url; source.target = '_blank'; source.rel = 'noopener noreferrer'; inside.append(source);
  card.append(inside); return card;
}
export async function prepareShareImages(card: HTMLElement, read: ReadShareImage): Promise<HTMLElement> {
  const clone = card.cloneNode(true) as HTMLElement, images = [...clone.querySelectorAll('img')], cache = new Map<string, Promise<ShareImageResult>>();
  const origins = new Set<string>(), failures: string[] = []; let failed = 0;
  for (let first = 0; first < images.length; first += 4) {
    await Promise.all(images.slice(first, first + 4).map(async img => {
      if (inlineShareImage.test(img.getAttribute('src') || '')) return;
      const src = img.dataset.shareSource || img.getAttribute('src') || '';
      try {
        let request = cache.get(src); if (!request) { request = read(src); cache.set(src, request); }
        const result = await request;
        if ('permission' in result) { origins.add(result.permission); failed++; return; }
        if (!inlineShareImage.test(result.data)) throw new Error('图片读取返回了无效数据');
        // SVG stays an <img> source (secure image mode), never inline DOM or an embedded document.
        img.loading = 'eager'; img.src = result.data; img.removeAttribute('srcset');
      } catch (error) { failed++; failures.push(`${imageSourceLabel(src)}：${error instanceof Error ? error.message : '读取图片失败'}`); }
    }));
  }
  if (failed) throw new ShareImageError([...origins], [...failures], failed); return clone;
}
export async function exportShareCard(card: HTMLElement, read: ReadShareImage): Promise<Blob[]> {
  return rasterizeShareCard(await prepareShareImages(card, read));
}
export interface ShareResources { readImage: ReadShareImage; authorize: (origins: string[]) => Promise<boolean>; }
export async function mountShareWorkspace(root: HTMLElement, topic: ShareTopic, resources: ShareResources): Promise<() => void> {
  const workspace = el('div', '', 'share-workspace'), preview = el('div', '', 'share-preview'), controls = el('aside', '', 'share-controls');
  const title = el('h1', '生成主题分享图片'), source = el('a', topic.url); source.href = topic.url; source.target = '_blank'; source.rel = 'noopener noreferrer';
  const help = el('p', '正文、头像和图片保留在卡片中。图片在本机生成。', 'share-muted');
  const qrLabel = el('label'), qrCheck = el('input'); qrCheck.type = 'checkbox'; qrCheck.checked = true; qrLabel.append(qrCheck, document.createTextNode('显示分享二维码'));
  const subtleLabel = el('label'), subtleCheck = el('input'); subtleCheck.type = 'checkbox'; subtleCheck.checked = true; subtleLabel.append(subtleCheck, document.createTextNode('显示附言')); subtleLabel.hidden = !topic.supplements?.length;
  const actions = el('div', '', 'share-actions'), save = el('button', '保存为图片'), copy = el('button', '复制为图片'); save.type = copy.type = 'button'; actions.append(save, copy);
  const status = el('p', '', 'share-status'); status.setAttribute('role', 'status');
  const permissionArea = el('div', '', 'share-permissions'), output = el('div', '', 'share-output');
  controls.append(title, source, help, qrLabel, subtleLabel, actions, permissionArea, status, output); workspace.append(preview, controls); root.replaceChildren(workspace);
  const qr = await QRCode.toDataURL(topic.url, { width: 108, margin: 1, color: { dark: '#adbac7', light: '#22272e' } });
  let card: HTMLElement, pending = false, disposed = false, revision = 0, blobs: Blob[] = [], objectUrls: string[] = [], selectedPage = 0;
  function resetOutput() { objectUrls.forEach(url => URL.revokeObjectURL(url)); objectUrls = []; blobs = []; output.replaceChildren(); permissionArea.replaceChildren(); selectedPage = 0; }
  function busy(value: boolean) {
    pending = value; save.disabled = copy.disabled = qrCheck.disabled = subtleCheck.disabled = value;
    output.querySelectorAll('button').forEach(button => { button.disabled = value; });
  }
  async function render() {
    const current = ++revision; resetOutput(); busy(true);
    card = createShareCard(topic, qrCheck.checked ? qr : undefined, subtleCheck.checked);
    preview.replaceChildren(card); status.textContent = '正在读取卡片图片…';
    try {
      const prepared = await prepareShareImages(card, resources.readImage);
      if (disposed || current !== revision) return;
      card = prepared; preview.replaceChildren(card); status.textContent = '';
    } catch (error) { if (!disposed && current === revision) report(error); }
    finally { if (!disposed && current === revision) busy(false); }
  }
  qrCheck.addEventListener('change', () => { void render(); });
  subtleCheck.addEventListener('change', () => { void render(); });
  function report(error: unknown) {
    status.textContent = error instanceof Error ? error.message : '生成图片失败'; permissionArea.replaceChildren();
    if (error instanceof ShareImageError && error.origins.length) {
      permissionArea.append(el('p', '读取以下图片来源后重试：'));
      const list = el('ul'); error.origins.forEach(origin => list.append(el('li', new URL(origin).host))); permissionArea.append(list);
      const grant = el('button', '允许读取这些图片来源'); grant.type = 'button'; permissionArea.append(grant);
      grant.addEventListener('click', () => {
        if (pending) return;
        let permission: Promise<boolean>;
        try { permission = resources.authorize(error.origins); } catch (failure) { report(failure); return; }
        busy(true); grant.disabled = true;
        void permission.then(async allowed => {
          if (disposed) return;
          if (allowed) await render(); else status.textContent = '未授权，尚未生成图片。';
        }).catch(report).finally(() => { if (!disposed) { busy(false); grant.disabled = false; } });
      });
    }
  }
  async function generate(): Promise<Blob[]> {
    if (blobs.length) return blobs;
    const current = revision;
    const generated = await exportShareCard(card, resources.readImage);
    if (disposed || current !== revision) throw new Error('分享内容已变化，请重新生成');
    blobs = generated; output.replaceChildren();
    generated.forEach((blob, index) => {
      const url = URL.createObjectURL(blob); objectUrls.push(url);
      const row = el('div', '', 'share-download-row'), link = el('a', generated.length > 1 ? `下载第 ${index + 1} 张 PNG` : '下载 PNG'); link.href = url; link.download = `guozaoke-${topic.id}${generated.length > 1 ? `-${index + 1}` : ''}.png`; row.append(link);
      if (generated.length > 1) { const select = el('button', `选择复制第 ${index + 1} 张`); select.type = 'button'; select.disabled = pending; select.addEventListener('click', () => { if (pending) return; selectedPage = index; status.textContent = `已选第 ${index + 1} 张，点击「复制为图片」。`; }); row.append(select); }
      output.append(row);
    }); return blobs;
  }
  save.addEventListener('click', () => { if (pending) return; busy(true); status.textContent = '正在生成图片…'; void generate().then(parts => { status.textContent = parts.length > 1 ? `正文较长，已完整分为 ${parts.length} 张图片。` : '图片已生成。'; if (parts.length === 1) output.querySelector<HTMLAnchorElement>('a')!.click(); }).catch(report).finally(() => busy(false)); });
  copy.addEventListener('click', () => {
    if (pending) return;
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) { status.textContent = '此浏览器不支持复制图片，请使用保存为图片。'; return; }
    busy(true); status.textContent = '正在复制图片…';
    const page = selectedPage, generation = generate(), image = generation.then(parts => parts[page]!);
    // ClipboardItem can reject synchronously or before it consumes the image promise.
    void image.catch(() => undefined);
    let writing: Promise<void>;
    try { writing = navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]); }
    catch (error) { writing = Promise.reject(error); }
    void Promise.allSettled([generation, writing]).then(([generated, copied]) => {
      if (disposed) return;
      if (generated.status === 'rejected') report(generated.reason);
      else if (copied.status === 'rejected') report(copied.reason);
      else status.textContent = generated.value.length > 1 ? `已复制第 ${page + 1} / ${generated.value.length} 张。` : '图片已复制。';
    }).finally(() => { if (!disposed) busy(false); });
  });
  void render();
  return () => { disposed = true; revision++; resetOutput(); };
}
