import { hashValue } from './contracts';
import { ProviderError, validatePublicUrl } from './providers';
import type { EvidenceSource } from './types';
import {SourceBudgetError} from './source-budget';

export interface SearchLead { url: string; title: string; snippet: string }
export interface EvidenceFetchOptions { signal?: AbortSignal; fetch?: typeof fetch; timeoutMs?: number; maxBytes?:number }
export interface EvidenceBytes { url: string; bytes: Uint8Array; contentType: string }
export interface PdfText { text: string; title: string; pageCount: number; pagesRead: number; limitations: string[] }
export interface EvidenceReadOptions extends EvidenceFetchOptions {
  id?: string;
  parsePdf?: (bytes: Uint8Array, options: { signal?: AbortSignal; timeoutMs?: number }) => Promise<PdfText>;
}
const HTML_BYTES = 2 * 1024 * 1024;
const PDF_BYTES = 8 * 1024 * 1024;
const TEXT_LIMIT = 1_500_000;
const MIME_KINDS: Record<string, EvidenceSource['kind']> = { 'text/html': 'html', 'application/xhtml+xml': 'html', 'application/pdf': 'pdf', 'text/plain': 'text' };
const ORIGINAL_PREFIX = '页面声明原文出处：';
const ORIGINAL_SUFFIX = '（未独立核实）';
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function interrupted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new ProviderError(signal.reason === 'timeout' ? 'timeout' : 'cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

/** Own and bound the actual stream, including custom transports that ignore abort. */
async function requestBytes(url: URL, init: RequestInit, options: EvidenceFetchOptions, limitFor: (mime: string) => number): Promise<EvidenceBytes> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new ProviderError('invalid_request');
  if(options.maxBytes!==undefined&&(!Number.isSafeInteger(options.maxBytes)||options.maxBytes<1||options.maxBytes>PDF_BYTES))throw new ProviderError('invalid_request');
  if (options.signal?.aborted) throw new ProviderError('cancelled');
  const controller = new AbortController();
  const abort = () => controller.abort('cancelled');
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  try {
    const request = (options.fetch ?? globalThis.fetch)(url.href, {
      ...init, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
    }).then(result => {
      if (controller.signal.aborted) void result.body?.cancel().catch(() => {});
      else response = result;
      return result;
    });
    response = await interrupted(request, controller.signal);
    if (response.redirected || (response.url && validatePublicUrl(response.url).origin !== url.origin)) throw new ProviderError('network');
    if (!response.ok) throw new ProviderError(response.status === 401 ? 'unauthorized' : response.status === 429 ? 'rate_limited' : 'http_error', response.status);
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const limit = Math.min(limitFor(contentType),options.maxBytes??PDF_BYTES);
    const declared = response.headers.get('content-length');
    if (declared && /^\d+$/.test(declared) && Number(declared) > limit) throw new ProviderError('too_large');
    if (!response.body) throw new ProviderError('schema');
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await interrupted(reader.read(), controller.signal);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new ProviderError('too_large');
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    complete = true;
    return { url: url.href, bytes, contentType };
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderError(controller.signal.reason === 'timeout' ? 'timeout' : 'cancelled');
    if (error instanceof ProviderError || error instanceof SourceBudgetError) throw error;
    throw new ProviderError('network');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    if (!complete) {
      controller.abort('cancelled');
      if (reader) void reader.cancel().catch(() => {});
      else void response?.body?.cancel().catch(() => {});
    }
    reader?.releaseLock();
  }
}

/** Search snippets are discovery leads only; no EvidenceSource is produced here. */
export async function searchTavily(query: string, key: string, options: EvidenceFetchOptions & { maxResults?: number } = {}): Promise<SearchLead[]> {
  if (typeof key !== 'string' || !key.trim() || key.length > 8192 || /[^\x20-\x7e]/.test(key) || /\s/.test(key.trim())) throw new ProviderError('invalid_key');
  if (typeof query !== 'string' || !query.trim() || query.length > 2000 || (options.maxResults !== undefined && (!Number.isSafeInteger(options.maxResults) || options.maxResults < 1))) throw new ProviderError('invalid_request');
  const maxResults = Math.min(options.maxResults ?? 5, 5);
  const response = await requestBytes(new URL('https://api.tavily.com/search'), {
    method: 'POST', headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: query.trim(), search_depth: 'basic', max_results: maxResults, include_answer: false, include_raw_content: false }),
  }, options, () => HTML_BYTES);
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)); } catch { throw new ProviderError('invalid_json'); }
  if (!object(raw) || !Array.isArray(raw.results)) throw new ProviderError('schema');
  const found = new Map<string, SearchLead>();
  for (const result of raw.results) {
    if (!object(result) || typeof result.url !== 'string') continue;
    let url: string;
    try { url = validatePublicUrl(result.url).href; } catch { continue; }
    if (!found.has(url)) found.set(url, { url, title: typeof result.title === 'string' ? result.title.slice(0, 1000) : '', snippet: typeof result.content === 'string' ? result.content.slice(0, 10_000) : '' });
    if (found.size === maxResults) break;
  }
  return [...found.values()];
}

/** Safe to import/call in an extension service worker: no DOM or PDF runtime here. */
export async function fetchEvidenceBytes(url: string, options: EvidenceFetchOptions = {}): Promise<EvidenceBytes> {
  return requestBytes(validatePublicUrl(url), { method: 'GET' }, options, mime => {
    if (!Object.hasOwn(MIME_KINDS, mime)) throw new ProviderError('schema');
    return mime === 'application/pdf' ? PDF_BYTES : HTML_BYTES;
  });
}

function textWithLocations(paragraphs: string[]): string {
  return paragraphs.map((text, index) => `[段落 ${index + 1}]\n${text}`).join('\n\n');
}
function explicitDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value.trim())) return null;
  const date = value.trim();
  const parsed = new Date(date);
  if (!Number.isFinite(parsed.valueOf())) return null;
  // Reject calendar rollover, e.g. February 31, rather than inventing a date.
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  const check = new Date(Date.UTC(year!, month! - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() + 1 === month && check.getUTCDate() === day ? date : null;
}

function parseHtml(input: string): Pick<EvidenceSource, 'text' | 'title' | 'publisher' | 'publishedAt' | 'limitations'> {
  // Template contents are inert (including resource loading), and never mounted.
  // DOMParser sees only the resource-free serialization from that template.
  const template = document.createElement('template');
  template.innerHTML = input;
  const inert = template.content;
  const limitations: string[] = [];
  // Ignore explicitly hidden UI before deciding whether the selected content is gated.
  inert.querySelectorAll('[hidden],[aria-hidden="true" i],[inert],dialog:not([open])').forEach(node => node.remove());
  inert.querySelectorAll<HTMLElement>('[style]').forEach(node => {
    if (node.style.display.toLowerCase() === 'none' || ['hidden', 'collapse'].includes(node.style.visibility.toLowerCase())) node.remove();
  });
  const imageCount = inert.querySelectorAll('img,svg,canvas,picture').length;
  const embeddedCount = inert.querySelectorAll('iframe,object,embed').length;
  if (imageCount) limitations.push(`存在 ${imageCount} 个图片或图形节点；未读取图片、图表中的内容。`);
  if (embeddedCount) limitations.push('未读取 iframe 或其他外部嵌入内容。');
  const contentArea = inert.querySelector('article') ?? inert.querySelector('main') ?? inert;
  // A site-wide/header sign-in form does not gate a separate public article.
  const login = [...contentArea.querySelectorAll('input[type="password"]')].some(node => !node.closest('header,nav,aside'));
  inert.querySelectorAll('script,style,nav,form,noscript,template,svg,canvas,iframe,object,embed,img,picture,source,video,audio,link,base,aside,footer,[hidden],[aria-hidden="true"],meta[http-equiv]').forEach(node => node.remove());
  inert.querySelectorAll('*').forEach(element => {
    for (const attr of [...element.attributes]) {
      if (/^on/i.test(attr.name) || ['src', 'srcset', 'style', 'xlink:href', 'background', 'data'].includes(attr.name) || (attr.name === 'href' && element.tagName !== 'A')) element.removeAttribute(attr.name);
    }
  });
  const doc = new DOMParser().parseFromString(template.innerHTML, 'text/html');
  const meta = (selector: string) => doc.querySelector(selector)?.getAttribute('content')?.trim() ?? '';
  const title = (doc.title || meta('meta[property="og:title"]') || doc.querySelector('h1')?.textContent || '').trim().slice(0, 1000);
  const publisher = (meta('meta[name="publisher"]') || meta('meta[name="DC.publisher"]') || meta('meta[property="og:site_name"]')).slice(0, 500);
  const date = meta('meta[property="article:published_time"]') || meta('meta[itemprop="datePublished"]') || meta('meta[name="datePublished"]') || doc.querySelector('time[itemprop="datePublished"],time[pubdate]')?.getAttribute('datetime') || null;
  let publishedAt = explicitDate(date);
  if (!date) {
    // Some government pages expose a year-first local date, without a timezone.
    const pubDate = meta('meta[name="PubDate" i]');
    const match = pubDate.match(/^(\d{4})\/(\d{2})\/(\d{2})(?: (?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)?$/);
    if (match) publishedAt = explicitDate(`${match[1]}-${match[2]}-${match[3]}`);
    if (publishedAt) limitations.push('发布日期取自页面 PubDate 元数据，仅保留日期；原值没有时区，未推断发布时刻。');
  }
  const body = doc.querySelector('article') ?? doc.querySelector('main') ?? doc.body;
  if (body.querySelector('sup,sub')) limitations.push('上标和下标已显式标记；上标可能是指数或脚注，未自动推断，需对照原文。');
  if (body.querySelector('del,ins,s,strike')) limitations.push('删除、插入和删除线内容已保留修订标记，不能将删除文字视为现行表述。');
  for (const link of body.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const label = (link.textContent ?? '').trim();
    const context = (link.parentElement?.textContent ?? '').trim();
    if (!/^(?:原文|原文链接|查看原文|original(?: article| source)?|read original)$/i.test(label) && !/^(?:转载自|原文出处|原文来自|originally published (?:in|at|by)|reprinted from)\s*[:：]/i.test(context)) continue;
    try { limitations.push(`${ORIGINAL_PREFIX}${validatePublicUrl(link.getAttribute('href') ?? '').href}${ORIGINAL_SUFFIX}`); } catch { /* Unsafe or relative attribution is not a verified root link. */ }
  }
  // Preserve block boundaries and inline text without duplicating nested blocks.
  const blocks = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'TR', 'BLOCKQUOTE', 'PRE', 'FIGCAPTION', 'DL', 'DT', 'DD']);
  const inlineMarkers = new Map([['SUP', '上标'], ['SUB', '下标'], ['DEL', '删除'], ['INS', '新增'], ['S', '删除线'], ['STRIKE', '删除线']]);
  const tables = [...body.querySelectorAll('table')];
  if (tables.length) limitations.push('表格保留原始行、单元格顺序及 rowspan/colspan 合并标记；单元格序号不是展开合并后的列号，不自动推断表头与数值的对应关系。');
  const extract = (node: Node, markTables = true): string => {
    if (node.nodeType === 3) return node.textContent ?? '';
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    if (element.tagName === 'BR') return '\n';
    if (markTables && element.tagName === 'TABLE') {
      const number = tables.indexOf(element as HTMLTableElement) + 1;
      const caption = element.querySelector(':scope > caption');
      const sections = caption ? [`[表格 ${number} 标题] ${extract(caption).trim()}`] : [];
      const rows = [...element.querySelectorAll('tr')].filter(row => row.closest('table') === element);
      for (const [index, row] of rows.entries()) {
        const cells = [...row.children].filter(cell => ['TD', 'TH'].includes(cell.tagName)).map((cell, cellIndex) => {
          // Keep paragraph boundaries inside one cell rather than splitting its row.
          const text = [...cell.childNodes].map(child => extract(child)).join('').trim().replace(/\n+/g, ' [换行] ');
          const spans = ['rowspan', 'colspan'].flatMap(name => {
            const value = cell.getAttribute(name)?.trim();
            return value && /^\d{1,6}$/.test(value) ? [`；${name}=${value}`] : [];
          }).join('');
          return `[单元格 ${cellIndex + 1}${spans}] ${text || '（空）'}`;
        });
        sections.push(`[表格 ${number} 行 ${index + 1}] ${cells.join(' | ')}`);
      }
      return `\n\n${sections.join('\n\n')}\n\n[表格 ${number} 结束]\n\n`;
    }
    const text = [...element.childNodes].map(child => extract(child, markTables)).join(element.tagName === 'TR' ? '\t' : '');
    const marker = inlineMarkers.get(element.tagName);
    if (marker) return `[${marker}：${text}]`;
    return blocks.has(element.tagName) ? `\n\n${text}\n\n` : text;
  };
  const paragraphs = extract(body).split(/\n\s*\n/).map(p => p.replace(/[\t \r]+/g, ' ').trim()).filter(Boolean);
  // Generated table labels describe structure; they are not source text and must
  // never turn an empty/image-only page into evidence or obscure a login wall.
  const plainParagraphs = extract(body, false).split(/\n\s*\n/).map(p => p.replace(/[\t \r]+/g, ' ').trim()).filter(Boolean);
  const errorTitle = /^(?:(?:404|403|500)\b|login\b|sign in\b|access denied\b|just a moment\b|page not found\b|登录|登陆|访问被拒绝|页面不存在|安全验证)/i.test(title);
  const errorBody = plainParagraphs.length < 5 && plainParagraphs.some(paragraph => /^(?:please (?:sign in|log in)|(?:sign|log) in to (?:read|view|continue)|access denied|request blocked|verify you are human|请先登录|请登录后|登录后可查看)/i.test(paragraph));
  if (login || errorTitle || errorBody || !body.textContent?.trim()) {
    limitations.push('页面为登录、错误、验证页面或没有可读取正文。');
    return { title, publisher, publishedAt, text: '', limitations };
  }
  return { title, publisher, publishedAt, text: textWithLocations(paragraphs), limitations };
}

async function baseSource(url: string | null, title: string, options: EvidenceReadOptions): Promise<EvidenceSource> {
  const id = options.id || `source-${await hashValue({ url, title })}`;
  return { id, rootId: id, url, title, publisher: url ? new URL(url).hostname : '', publishedAt: null, retrievedAt: new Date().toISOString(), status: 'unreadable', kind: 'text', text: '', locator: '', introducedBy: 'system', introducedAtMessageId: null, limitations: [], data: [] };
}
async function parseBytes(source: EvidenceSource, payload: EvidenceBytes, options: EvidenceReadOptions): Promise<EvidenceSource> {
  if (!Object.hasOwn(MIME_KINDS, payload.contentType)) throw new ProviderError('schema');
  const kind = MIME_KINDS[payload.contentType]!;
  source.kind = kind;
  if (options.signal?.aborted) throw new ProviderError('cancelled');
  if (kind === 'pdf') {
    const parser = options.parsePdf ?? (await import('./pdf')).parsePdfText;
    const parsed = await parser(payload.bytes, { signal: options.signal, timeoutMs: options.timeoutMs });
    source.text = parsed.text;
    if (parsed.title) source.title = parsed.title.slice(0, 1000);
    source.locator = `按 [页 N] 定位；已读取 ${parsed.pagesRead}/${parsed.pageCount} 页`;
    source.limitations.push(...parsed.limitations);
    if (parsed.pagesRead < parsed.pageCount) source.limitations.push(`仅读取前 ${parsed.pagesRead} 页，共 ${parsed.pageCount} 页；未全文读取。`);
    if (!parsed.text.trim()) source.limitations.push('PDF 没有可提取文字，可能为扫描件；尚未执行 OCR。');
  } else {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(payload.bytes); } catch { throw new ProviderError('schema'); }
    if (kind === 'html') {
      const parsed = parseHtml(text);
      if (parsed.title) source.title = parsed.title;
      if (parsed.publisher) source.publisher = parsed.publisher;
      source.text = parsed.text; source.publishedAt = parsed.publishedAt; source.limitations.push(...parsed.limitations);
    } else source.text = textWithLocations(text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean));
    source.locator = '按 [段落 N] 定位；摘录须匹配保存的正文';
  }
  if (source.text.length > TEXT_LIMIT) {
    source.text = source.text.slice(0, TEXT_LIMIT);
    source.limitations.push('正文超过文字上限，已截断；未全文读取。');
  }
  source.status = source.text.trim() ? 'read' : 'unreadable';
  if (!source.text.trim() && !source.limitations.length) source.limitations.push('文件没有可读取正文。');
  if (!options.id) source.id = `source-${await hashValue({ url: source.url, title: source.url ? '' : source.title, text: source.text })}`;
  source.rootId = source.id;
  return source;
}
function failure(source: EvidenceSource, error: unknown): EvidenceSource {
  if (error instanceof ProviderError && (error.code === 'cancelled' || error.code === 'timeout')) throw error;
  if(error instanceof SourceBudgetError){
    source.status='unreadable';source.text='';source.data=[];
    source.limitations.push('本轮原件累计读取预算已耗尽或无法核对，本次未读取；不能据此认定没有证据。');return source;
  }
  const code = error instanceof ProviderError ? error.code : 'schema';
  source.status = 'unreadable'; source.text = ''; source.data = [];
  source.limitations.push(code === 'too_large' ? '材料大小超过读取上限，未读取正文。' : `材料无法读取（${code}），未取得可核对正文。`);
  return source;
}
export async function readEvidence(url: string, options: EvidenceReadOptions = {}): Promise<EvidenceSource> {
  const safeUrl = validatePublicUrl(url).href;
  const source = await baseSource(safeUrl, safeUrl, options);
  try { return await parseBytes(source, await fetchEvidenceBytes(safeUrl, options), options); }
  catch (error) { return failure(source, error); }
}
/** File.arrayBuffer itself has no abort API; stop waiting and never parse late data. */
async function readLocalFile(file: File, options: EvidenceReadOptions): Promise<Uint8Array> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new ProviderError('invalid_request');
  if (options.signal?.aborted) throw new ProviderError('cancelled');
  const controller = new AbortController();
  const abort = () => controller.abort('cancelled');
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try { return new Uint8Array(await interrupted(file.arrayBuffer(), controller.signal)); }
  finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
export async function importEvidenceFile(file: File, options: EvidenceReadOptions = {}): Promise<EvidenceSource> {
  const source = await baseSource(null, file.name.slice(0, 1000), options);
  // File.name is the browser-supplied basename; never inspect path/relativePath.
  const fileLocator = `本地文件：${source.title}；类型：${file.type.slice(0, 200) || '未提供'}；大小：${file.size} 字节`;
  source.locator = fileLocator;
  try {
    if (options.signal?.aborted) throw new ProviderError('cancelled');
    const contentType = file.type.toLowerCase().split(';')[0]!;
    if (!Object.hasOwn(MIME_KINDS, contentType)) throw new ProviderError('schema');
    const max = contentType === 'application/pdf' ? PDF_BYTES : HTML_BYTES;
    if (file.size > max) throw new ProviderError('too_large');
    const bytes = await readLocalFile(file, options);
    if (bytes.byteLength > max) throw new ProviderError('too_large');
    const parsed = await parseBytes(source, { url: '', bytes, contentType }, options);
    parsed.locator = `${fileLocator}\n${parsed.locator}`;
    return parsed;
  } catch (error) { source.locator = fileLocator; return failure(source, error); }
}

/** A shared root is a conservative non-independence group, not proof of copying. */
export function groupEvidenceRoots(sources: EvidenceSource[]): EvidenceSource[] {
  const parent = sources.map((_, i) => i);
  const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]!));
  const join = (a: number, b: number) => { const x = root(a), y = root(b); parent[Math.max(x, y)] = Math.min(x, y); };
  const ids = new Map(sources.map((s, i) => [s.id, i]));
  const urls = new Map(sources.filter(s => s.url).map(s => [s.url!, ids.get(s.id)!]));
  const bodies = new Map<string, number>();
  const publishers = new Map<string, number>();
  const originals = new Map<string, number>();
  const publisherGrouped = new Set<number>();
  sources.forEach((source, index) => {
    const previous = ids.get(source.rootId);
    if (previous !== undefined) join(index, previous);
    if (source.status !== 'read') return;
    if (source.text.trim()) {
      // Equality is exact: same test as equal hashes, without asynchronous hashing.
      const prior = bodies.get(source.text);
      if (prior !== undefined) join(index, prior); else bodies.set(source.text, index);
    }
    const publisher = source.publisher.trim().toLowerCase();
    if (publisher) {
      const prior = publishers.get(publisher);
      if (prior !== undefined) { join(index, prior); publisherGrouped.add(index); publisherGrouped.add(prior); }
      else publishers.set(publisher, index);
    }
    for (const note of source.limitations) {
      if (!note.startsWith(ORIGINAL_PREFIX) || !note.endsWith(ORIGINAL_SUFFIX)) continue;
      let original: string;
      try { original = validatePublicUrl(note.slice(ORIGINAL_PREFIX.length, -ORIGINAL_SUFFIX.length)).href; } catch { continue; }
      const owner = urls.get(original) ?? originals.get(original);
      if (owner !== undefined) join(index, owner);
      originals.set(original, index);
    }
  });
  return sources.map((source, index) => ({ ...source, rootId: sources[root(index)]!.id, limitations: [...new Set([...source.limitations, ...(publisherGrouped.has(index) ? ['按发布者保守归组，未确认独立性'] : [])])] }));
}
