export const ORIGIN = 'https://www.guozaoke.com';
export function siteUrl(value: string): URL {
  const url = new URL(value, ORIGIN);
  if (url.protocol !== 'https:' || !['guozaoke.com', 'www.guozaoke.com'].includes(url.hostname) || url.port || url.username || url.password) throw new Error('不是受支持的过早客地址');
  url.hostname = 'www.guozaoke.com';
  return url;
}
export function readableUrl(value: string): string {
  const url = siteUrl(value);
  if (!/^\/(?:t\/\d+|u\/[\w-]+(?:\/(?:topics|replies|favorites))?|node\/[\w-]+|notifications|image_upload)?\/?$/.test(url.pathname)) throw new Error('不支持读取此页面');
  for (const [key,v] of url.searchParams) {
    if ((key === 'p' || key === 'page') && /^\d{1,6}$/.test(v) && Number(v)>0) continue;
    if (url.pathname === '/' && key === 'tab' && ['latest','elite','interest','follows'].includes(v)) continue;
    throw new Error('页面查询参数不受支持');
  }
  url.hash = '';
  return url.href;
}
export function topicUrl(value: string): string {
  const url = siteUrl(value);
  const match = url.pathname.match(/^\/t\/(\d+)\/?$/);
  if (!match) throw new Error('不是主题地址');
  return `${ORIGIN}/t/${match[1]}`;
}
export function safeLink(value: string, base = ORIGIN): string {
  if(!value.trim())return '';
  try { const url = new URL(value, base); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
