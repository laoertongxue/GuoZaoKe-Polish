import { RatingError } from './errors';

const ORIGIN = 'https://www.guozaoke.com';
const FETCH_TIMEOUT_MS = 15000;
export const RATING_COMMENT_MARKER = '[GuoZaoKe 评分 · ';

export type ReplyFailureReason =
  | 'not_logged_in'
  | 'account_mismatch'
  | 'form_not_found'
  | 'server_rejected'
  | 'marker_missing';

export interface PostReplyResult {
  posted: boolean;
  reason: 'sent' | ReplyFailureReason;
  responseStatus: number;
}

export interface ReplyPosterOptions {
  /** Override the Guozaoke origin. Used by tests only. */
  origin?: string;
  /** Override the fetch implementation. Used by tests only. */
  fetchImpl?: typeof fetch;
}

/** Human-readable explanation for a failed post, shown in the page toast. */
export function replyFailureMessage(reason: PostReplyResult['reason']): string {
  switch (reason) {
    case 'sent': return '已发回帖';
    case 'not_logged_in': return '未登录过早客，未发回帖';
    case 'account_mismatch': return '当前登录账号与助手账号不一致，未发回帖';
    case 'form_not_found': return '未找到站点回帖表单，未发回帖';
    case 'server_rejected': return '站点拒绝了回帖请求';
    case 'marker_missing': return '回帖请求已提交，但未能确认发布结果，请到帖子中核对';
  }
}

/** Username of the logged-in account, read from the site navbar. Empty when logged out. */
export function loggedInUsername(html: string): string {
  const start = html.search(/class="[^"]*\bnavbar-right\b/);
  if (start < 0) return '';
  const end = html.indexOf('</ul>', start);
  const segment = html.slice(start, end < 0 ? start + 2000 : end);
  return segment.match(/<a[^>]+href="\/u\/([\w-]+)"/)?.[1] ?? '';
}

/** Attributes of a single HTML start tag, as a name -> value map. Values are not entity-decoded. */
function tagAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w-]+)=["']([^"']*)["']/g)) out[m[1]!.toLowerCase()] = m[2]!;
  return out;
}

/**
 * The site's own reply form: the <form> that contains the reply textarea.
 * Returns its action (resolved and same-origin checked) and its hidden fields.
 */
export function findReplyForm(html: string, origin: string): { action: string; hidden: Array<[string, string]> } | null {
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const formTag = m[1] ?? '';
    const body = m[2] ?? '';
    const isReplyForm = /<textarea\b[^>]*(?:J_replyContent|name=["']content["'])/i.test(body);
    if (!isReplyForm) continue;
    const rawAction = tagAttributes(`<form ${formTag}`).action;
    if (!rawAction) return null;
    let action: string;
    try { action = new URL(rawAction, origin).toString(); } catch { return null; }
    if (new URL(action).origin !== origin) return null;
    const hidden: Array<[string, string]> = [];
    for (const input of body.matchAll(/<input\b[^>]*>/gi)) {
      const attrs = tagAttributes(input[0]);
      if ((attrs.type ?? '').toLowerCase() !== 'hidden' || !attrs.name) continue;
      hidden.push([attrs.name, attrs.value ?? '']);
    }
    // A reply form without its anti-forgery token would be rejected by the site anyway.
    if (!hidden.some(([name]) => /csrf|xsrf|token/i.test(name))) return null;
    return { action, hidden };
  }
  return null;
}

/**
 * Post the assistant's review as a reply, using the browser's own session (credentials: 'include').
 * The reply is only sent when the logged-in account matches `expectedUsername`.
 */
export async function postAssistantReply(
  topicId: string,
  content: string,
  expectedUsername: string,
  options: ReplyPosterOptions = {},
): Promise<PostReplyResult> {
  const origin = options.origin ?? ORIGIN;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!/^\d+$/.test(topicId)) throw new RatingError('reply_not_found');
  if (!content.trim()) throw new RatingError('reply_post_failed');
  const topicUrl = `${origin}/t/${topicId}`;
  const pageRes = await fetchImpl(topicUrl, {
    headers: { Accept: 'text/html' },
    redirect: 'follow',
    credentials: 'include',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!pageRes.ok) return { posted: false, reason: 'server_rejected', responseStatus: pageRes.status };
  if (new URL(pageRes.url || topicUrl).origin !== origin) return { posted: false, reason: 'server_rejected', responseStatus: pageRes.status };
  const html = await pageRes.text();

  const loggedIn = loggedInUsername(html);
  if (!loggedIn) return { posted: false, reason: 'not_logged_in', responseStatus: pageRes.status };
  if (loggedIn.toLowerCase() !== expectedUsername.trim().toLowerCase()) {
    return { posted: false, reason: 'account_mismatch', responseStatus: pageRes.status };
  }
  const form = findReplyForm(html, origin);
  if (!form) return { posted: false, reason: 'form_not_found', responseStatus: pageRes.status };

  const formBody = new URLSearchParams();
  for (const [name, value] of form.hidden) {
    if (name === 'content' || name === 'topic_id') continue;
    formBody.append(name, value);
  }
  formBody.set('topic_id', topicId);
  formBody.set('content', content);
  const postRes = await fetchImpl(form.action, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html',
    },
    body: formBody.toString(),
    redirect: 'follow',
    credentials: 'include',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!postRes.ok) return { posted: false, reason: 'server_rejected', responseStatus: postRes.status };
  const responseHtml = await postRes.text();
  if (responseHtml.includes(RATING_COMMENT_MARKER)) return { posted: true, reason: 'sent', responseStatus: postRes.status };
  return { posted: false, reason: 'marker_missing', responseStatus: postRes.status };
}
