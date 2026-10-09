import { RatingError } from './errors';

const ORIGIN = 'https://www.guozaoke.com';
const FETCH_TIMEOUT_MS = 15000;
const COMMENT_MARKER = '[GuoZaoKe 评分 · ';

export interface CookieSource {
  cookies: {
    getAll(query: { domain?: string; url?: string }): Promise<Array<{ name: string; value: string; domain?: string }>>;
  };
}

export interface ReplyPosterOptions {
  /** Override the Guozaoke origin. Used by tests only. */
  origin?: string;
  /** Override the fetch implementation. Used by tests only. */
  fetchImpl?: typeof fetch;
}

function buildCookieHeader(cookies: Array<{ name: string; value: string }>): string {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

/** Pick the first value of a hidden input by name. Returns '' when the field is missing. */
function extractHiddenField(html: string, names: string[]): string {
  for (const name of names) {
    const re = new RegExp(`<input[^>]+name=["']${name}["'][^>]*value=["']([^"']*)["']`, 'i');
    const m = html.match(re);
    if (m?.[1]) return m[1];
    const re2 = new RegExp(`<input[^>]+value=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i');
    const m2 = html.match(re2);
    if (m2?.[1]) return m2[1];
  }
  return '';
}

/** Pull a `<form action>` value (absolute or origin-relative). */
function extractFormAction(html: string, origin: string): string {
  const actionMatch = html.match(/<form[^>]+action=["']([^"']+)["']/i);
  if (!actionMatch?.[1]) return '';
  const raw = actionMatch[1];
  try {
    return new URL(raw, origin).toString();
  } catch {
    return '';
  }
}

function commentLooksPosted(html: string, marker: string): boolean {
  return html.includes(marker);
}

function uniqueTrimmedFormEntries(value: string): string {
  return value.replace(/\r/g, '').trim();
}

export interface PostReplyResult {
  posted: boolean;
  reason: 'sent' | 'no_cookies' | 'no_csrf' | 'server_rejected' | 'marker_missing';
  body: string;
  responseStatus: number;
}

/** Send the assistant's review as a reply on Guozaoke, using the assistant account's existing browser cookies. */
export async function postAssistantReply(
  topicId: string,
  content: string,
  cookies: CookieSource,
  options: ReplyPosterOptions = {},
): Promise<PostReplyResult> {
  const origin = options.origin ?? ORIGIN;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!/^\d+$/.test(topicId)) throw new RatingError('reply_not_found');
  if (content.length === 0) throw new RatingError('reply_too_long');
  const cookieEntries = await cookies.cookies.getAll({ domain: '.guozaoke.com' }).catch(() => []);
  if (cookieEntries.length === 0) {
    return { posted: false, reason: 'no_cookies', body: uniqueTrimmedFormEntries(content), responseStatus: 0 };
  }
  const cookieHeader = buildCookieHeader(cookieEntries);
  const topicUrl = `${origin}/t/${topicId}`;
  const pageRes = await fetchImpl(topicUrl, {
    headers: { Cookie: cookieHeader, Accept: 'text/html' },
    redirect: 'follow',
    credentials: 'omit',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!pageRes.ok) {
    return { posted: false, reason: 'server_rejected', body: uniqueTrimmedFormEntries(content), responseStatus: pageRes.status };
  }
  const html = await pageRes.text();
  const csrf = extractHiddenField(html, ['csrf_token', 'csrf', 'gzk_csrf', '_token', 'authenticity_token']);
  if (!csrf) {
    return { posted: false, reason: 'no_csrf', body: uniqueTrimmedFormEntries(content), responseStatus: pageRes.status };
  }
  const action = extractFormAction(html, origin) || `${origin}/t/${topicId}`;
  const formBody = new URLSearchParams();
  formBody.set('content', content);
  formBody.set('topic_id', topicId);
  formBody.set('csrf_token', csrf);
  const postRes = await fetchImpl(action, {
    method: 'POST',
    headers: {
      Cookie: cookieHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: topicUrl,
      Accept: 'text/html',
    },
    body: formBody.toString(),
    redirect: 'follow',
    credentials: 'omit',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!postRes.ok) {
    return { posted: false, reason: 'server_rejected', body: uniqueTrimmedFormEntries(content), responseStatus: postRes.status };
  }
  const responseHtml = await postRes.text();
  if (commentLooksPosted(responseHtml, COMMENT_MARKER)) {
    return { posted: true, reason: 'sent', body: uniqueTrimmedFormEntries(content), responseStatus: postRes.status };
  }
  return { posted: false, reason: 'marker_missing', body: uniqueTrimmedFormEntries(content), responseStatus: postRes.status };
}
