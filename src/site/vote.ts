import { ORIGIN } from './urls';

/** Called only by a click on a preloaded reply's vote control. */
export async function voteReply(id: string, voted = true): Promise<{ voted: boolean; count: number }> {
  if (!/^\d{1,20}$/.test(id)) throw new Error('回复编号无效');
  const cookie = document.cookie.match(/(?:^|;\s*)_xsrf=([^;]+)/)?.[1];
  let token = document.querySelector<HTMLInputElement>('input[name="_xsrf"]')?.value;
  if (!token && cookie) { try { token = decodeURIComponent(cookie); } catch { throw new Error('请刷新页面后重试点赞'); } }
  if (!token) throw new Error('请先登录过早客后点赞');
  let response: Response;
  try {
    response = await fetch(`${ORIGIN}/replyVote?reply_id=${id}`, {
      method: 'POST', credentials: 'include', redirect: 'error', cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ voted: voted ? '1' : '0', _xsrf: token }).toString(),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    // redirect:'error' surfaces every 3xx as a bare TypeError; do not leak it to the toast.
    throw new Error('点赞请求未完成，请刷新页面后重试');
  }
  if (!response.ok) throw new Error(`点赞失败（${response.status}）`);
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new Error('站点未返回可识别的结果，请刷新原页检查后重试'); }
  if (result && typeof result === 'object' && 'success' in result && result.success === true) {
    if ('voted' in result && typeof result.voted === 'boolean' && 'count' in result && typeof result.count === 'number' && Number.isSafeInteger(result.count) && result.count >= 0) return { voted: result.voted, count: result.count };
    throw new Error('站点未返回有效赞数，请刷新原页检查后重试');
  }
  const errors: Record<string, string> = {
    reply_not_exist: '回复不存在', user_not_login: '请先登录过早客后点赞',
    can_not_vote_your_reply: '不能赞自己的回复', already_voted: '已经赞过这条回复',
  };
  const code = result && typeof result === 'object' && 'message' in result ? String(result.message) : '';
  throw new Error(errors[code] || '站点未确认点赞，请刷新原页检查后重试');
}
