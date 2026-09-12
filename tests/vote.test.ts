import { afterEach, expect, it, vi } from 'vitest';
import { voteReply } from '../src/site/vote';
afterEach(() => vi.unstubAllGlobals());
it('只在显式调用时请求已核验的单条回复点赞接口', async () => {
  const request = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }));
  vi.stubGlobal('fetch', request);
  expect(request).not.toHaveBeenCalled();
  await voteReply('1560607');
  expect(request).toHaveBeenCalledWith('https://www.guozaoke.com/replyVote?reply_id=1560607', expect.objectContaining({ credentials: 'include', redirect: 'error' }));
});
it('拒绝无效ID与服务端失败，不能把已赞或登录失效当新增赞', async () => {
  const request = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: false, message: 'already_voted' }) }));
  vi.stubGlobal('fetch', request);
  await expect(voteReply('../logout')).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  await expect(voteReply('1560607')).rejects.toThrow('已经赞过');
});
