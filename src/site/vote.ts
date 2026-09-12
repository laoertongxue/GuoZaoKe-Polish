import { ORIGIN } from './urls';

/** Called only by a click on a preloaded reply's vote control. */
export async function voteReply(id: string): Promise<void> {
  if (!/^\d{1,20}$/.test(id)) throw new Error('回复编号无效');
  // Matches the target site's original reply control, including its JSON request header.
  const response = await fetch(`${ORIGIN}/replyVote?reply_id=${id}`, {
    credentials: 'include', redirect: 'error',
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`点赞失败（${response.status}）`);
  const result: unknown = await response.json();
  if (result && typeof result === 'object' && 'success' in result && result.success === true) return;
  const errors: Record<string, string> = {
    reply_not_exist: '回复不存在', user_not_login: '请先登录过早客后点赞',
    can_not_vote_your_reply: '不能赞自己的回复', already_voted: '已经赞过这条回复',
  };
  const code = result && typeof result === 'object' && 'message' in result ? String(result.message) : '';
  throw new Error(errors[code] || '站点未确认点赞，请刷新原页检查后重试');
}
