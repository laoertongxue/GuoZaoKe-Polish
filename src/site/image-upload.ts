import { browser } from 'wxt/browser';

export const BILIBILI_UPLOAD_URL = 'https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs';
export const BILIBILI_UPLOAD_PERMISSIONS = { permissions: ['cookies'] as ['cookies'], origins: ['https://api.bilibili.com/*'] };
const maxBytes = 10 * 1024 * 1024;
const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

function imageBytes(base64: unknown, mime: unknown): Uint8Array<ArrayBuffer> {
  if (typeof mime !== 'string' || !Object.hasOwn(extensions, mime) || typeof base64 !== 'string' || !base64 || base64.length > 4 * Math.ceil(maxBytes / 3) || base64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('图片格式或大小不支持（最多 10 MB）');
  let raw: string;
  try { raw = atob(base64); } catch { throw new Error('图片编码无效'); }
  if (raw.length > maxBytes) throw new Error('图片不能超过 10 MB');
  const valid = mime === 'image/png' ? raw.startsWith('\x89PNG\r\n\x1a\n')
    : mime === 'image/jpeg' ? raw.startsWith('\xff\xd8\xff')
    : mime === 'image/gif' ? /^GIF8[79]a/.test(raw)
    : raw.startsWith('RIFF') && raw.slice(8, 12) === 'WEBP';
  if (!valid) throw new Error('图片内容与格式不匹配');
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

function imageUrl(value: unknown, bilibili: boolean): string {
  try {
    if (typeof value !== 'string') throw new Error();
    const url = new URL(value);
    if (url.username || url.password || url.port) throw new Error();
    if (bilibili) {
      if (!['http:', 'https:'].includes(url.protocol) || !/^i\d+\.hdslb\.com$/.test(url.hostname) || !url.pathname.startsWith('/bfs/') || !/\.(png|jpe?g|gif|webp)$/i.test(url.pathname) || url.search || url.hash) throw new Error();
      url.protocol = 'https:';
    } else if (url.protocol !== 'https:' || url.hostname !== 'i.imgur.com') throw new Error();
    return url.href;
  } catch { throw new Error('图床返回了意外图片地址'); }
}

/** Fixed upload destinations only. Cookies and upstream error bodies never reach the page. */
export async function uploadImage(message: {provider?: unknown; base64?: unknown; mime?: unknown}, sender: {url?: string; frameId?: number; tab?: {incognito?: boolean}}): Promise<string> {
  let trusted = false;
  try {
    const url = new URL(sender.url || '');
    trusted = !url.username && !url.password && !url.port && sender.frameId === 0 && !sender.tab?.incognito && ['https://www.guozaoke.com', 'https://guozaoke.com'].includes(url.origin);
  } catch { /* Reject absent or malformed sender URLs. */ }
  if (!trusted) throw new Error('请在普通窗口的过早客编辑器中上传图片');
  // Missing provider keeps compatibility with an already-open older Imgur dialog.
  const provider = message.provider ?? 'imgur';
  if (provider !== 'bilibili' && provider !== 'imgur') throw new Error('不支持的图床');
  const bytes = imageBytes(message.base64, message.mime);
  const body = new FormData();
  let url: string, headers: Record<string, string> | undefined;
  if (provider === 'bilibili') {
    if (!await browser.permissions.contains(BILIBILI_UPLOAD_PERMISSIONS)) throw new Error('请先在图床配置中点击「启用 B 站上传」并授权');
    let csrf: string | undefined;
    try { csrf = (await browser.cookies.get({url: BILIBILI_UPLOAD_URL, name: 'bili_jct'}))?.value; }
    catch { throw new Error('无法读取 B 站登录状态，请重新授权并登录 B 站'); }
    if (!csrf || !/^[a-f0-9]{32}$/i.test(csrf)) throw new Error('请先在当前浏览器登录 B 站，再重试上传');
    body.append('file_up', new Blob([bytes], {type: message.mime as string}), `upload.${extensions[message.mime as string]}`);
    body.append('category', 'daily'); body.append('csrf', csrf);
    url = BILIBILI_UPLOAD_URL;
  } else {
    if (!await browser.permissions.contains({origins: ['https://api.imgur.com/*']})) throw new Error('请先在控制选项中授权 Imgur');
    const stored = await browser.storage.local.get('gzk:imgur-client');
    const client = stored['gzk:imgur-client'];
    if (typeof client !== 'string' || !client.trim()) throw new Error('请先配置 Imgur Client ID');
    headers = {Authorization: `Client-ID ${client.trim()}`};
    body.append('image', message.base64 as string); body.append('type', 'base64');
    url = 'https://api.imgur.com/3/image';
  }
  const name = provider === 'bilibili' ? 'B 站' : 'Imgur';
  let response: Response;
  try {
    response = await fetch(url, {method: 'POST', headers, body, credentials: provider === 'bilibili' ? 'include' : 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(60000)});
  } catch { throw new Error(`${name} 上传连接失败或超时。服务端可能已收到图片；请检查网络后再决定是否重试。`); }
  if (!response.ok) throw new Error(`${name} 上传失败（HTTP ${response.status}），请检查登录状态或稍后重试`);
  let json;
  try { json = await response.json(); } catch { throw new Error(`${name} 返回了无法识别的响应，请稍后重试`); }
  if (provider === 'bilibili') {
    if (json?.code === -101 || json?.code === -111) throw new Error('B 站登录状态已失效，请重新登录 B 站后重试');
    if (json?.code !== 0) throw new Error('B 站暂未接受图片，请检查登录状态、图片格式或稍后重试');
    return imageUrl(json?.data?.image_url, true);
  }
  if (!json?.success) throw new Error('Imgur 上传失败，请检查 Client ID、网络或额度');
  return imageUrl(json?.data?.link, false);
}
