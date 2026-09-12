import { toSvg } from 'html-to-image';
import { el } from '../shared/ui';
import { imageSourceLabel } from '../site/share-images';
function loadImage(src: string, source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image(), timeout = setTimeout(() => reject(new Error(`${source}：图片解码超时`)), 20000);
    image.onload = () => { clearTimeout(timeout); resolve(image); }; image.onerror = () => { clearTimeout(timeout); reject(new Error(`${source}：无法解码图像`)); }; image.src = src;
  });
}
export async function rasterizeShareCard(clone: HTMLElement): Promise<Blob[]> {
  const holder = el('div', '', 'share-export-holder'); holder.setAttribute('aria-hidden', 'true'); holder.append(clone); document.body.append(holder);
  try {
    await Promise.all([...clone.querySelectorAll('img')].map(img => loadImage(img.src, img.dataset.shareSource ? imageSourceLabel(img.dataset.shareSource) : '主题二维码'))); await document.fonts?.ready;
    const width = 375, height = Math.ceil(clone.getBoundingClientRect().height); if (!height) throw new Error('分享卡片尚未完成排版');
    const svg = await toSvg(clone, { width, height, skipFonts: true }), image = await loadImage(svg, '分享卡片'), blobs: Blob[] = [], pageHeight = 5000;
    for (let top = 0; top < height; top += pageHeight) {
      const partHeight = Math.min(pageHeight, height - top), canvas = el('canvas'); canvas.width = width * 2; canvas.height = partHeight * 2;
      const context = canvas.getContext('2d'); if (!context) throw new Error('浏览器不支持生成分享图片');
      context.drawImage(image, 0, top, width, partHeight, 0, 0, canvas.width, canvas.height);
      blobs.push(await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG 生成失败')), 'image/png')));
    }
    return blobs;
  } finally { holder.remove(); }
}
