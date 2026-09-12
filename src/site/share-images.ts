export type ShareImageResult = { data: string } | { permission: string };
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
/** Encode already-validated image bytes without inserting any image markup into a document. */
export function imageBytesToDataUrl(bytes:Uint8Array,contentType:string):string {
  const mime=contentType.split(';')[0]!.trim().toLowerCase();
  const parameter=mime==='image/svg+xml'?[...contentType.matchAll(/;\s*([^=;\s]+)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;\s]*))/g)].find(match=>match[1]!.toLowerCase()==='charset'):undefined;
  let charset=(parameter?.[2]!==undefined?parameter[2].replace(/\\(.)/g,'$1'):parameter?.[3])?.trim().toLowerCase();
  // XML MIME gives a BOM priority over the HTTP charset (RFC 7303 §3.2).
  if(mime==='image/svg+xml'){
    if(bytes[0]===0&&bytes[1]===0&&bytes[2]===0xfe&&bytes[3]===0xff)charset='utf-32be';
    else if(bytes[0]===0xff&&bytes[1]===0xfe&&bytes[2]===0&&bytes[3]===0)charset='utf-32le';
    else if(bytes[0]===0xfe&&bytes[1]===0xff)charset='utf-16be';
    else if(bytes[0]===0xff&&bytes[1]===0xfe)charset='utf-16le';
    else if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)charset='utf-8';
  }
  if(charset){
    // Chrome's SVG image decoder can ignore a data URL's charset parameter.
    // Normalize HTTP-declared encodings and keep the XML declaration consistent.
    try{
      const source=new TextDecoder(charset,{fatal:true}).decode(bytes);
      const normalized=source.replace(/^<\?xml\s[^?]*\?>/i,declaration=>declaration.replace(/(\bencoding\s*=\s*)(["'])[^"']*\2/i,'$1"UTF-8"'));
      bytes=new TextEncoder().encode(normalized);
    }catch{throw new Error(`SVG 字符集解码失败（${charset}）`);}
  }
  let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}
export function imageSourceLabel(value: string): string {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
  catch { return '无效图片地址'; }
}
export function publicImageUrl(value: string): URL {
  const url = new URL(value), host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || !host.includes('.') || host.includes(':') || /(?:^|\.)(?:localhost|local|internal|lan|home)$/.test(host)) throw new Error('仅支持公共网站的图片地址');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a = 0, b = 0] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19))) throw new Error('不读取本机或内网图片');
  }
  url.hostname = host; url.hash = ''; return url;
}
/** Public, credential-free read. Permission requests are never automatic. */
export async function readShareImage(value: string, hasPermission: (origin: string) => Promise<boolean>): Promise<ShareImageResult> {
  const url = publicImageUrl(value), origin = `${url.origin}/*`;
  let response: Response;
  try { response = await fetch(url.href, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch { if (!await hasPermission(origin)) return { permission: origin }; throw new Error(`读取图片失败：${url.hostname}，请检查网络或图片防盗链限制`); }
  async function rejectResponse(message: string): Promise<never> {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(message);
  }
  if (!response.ok) return rejectResponse(`读取图片失败（${response.status}）：${url.hostname}`);
  const contentType=response.headers.get('content-type')||'',mime=contentType.split(';')[0]!.trim().toLowerCase();
  if (!/^image\/(?:png|jpeg|gif|webp|avif|svg\+xml)$/.test(mime)) return rejectResponse(`不支持的图片格式：${mime || '未知'}`);
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) return rejectResponse('每张分享图片最多 12 MB');
  const reader = response.body?.getReader(); if (!reader) throw new Error('图片内容为空');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value: chunk } = await reader.read(); if (done) break; size += chunk.byteLength; if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error('每张分享图片最多 12 MB'); } chunks.push(chunk); } } finally { reader.releaseLock(); }
  if (!size) throw new Error('图片内容为空');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { data: imageBytesToDataUrl(bytes,contentType) };
}
