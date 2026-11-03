import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { voteReply } from '../src/site/vote';
beforeEach(()=>{document.body.innerHTML='<input name="_xsrf" value="test-token">';});
afterEach(()=>{vi.unstubAllGlobals();document.cookie='_xsrf=; Max-Age=0; Path=/';});
it.each([true,false])('显式点击才 POST 目标点赞状态 %s，采用服务端真实赞数', async voted => {
  const request=vi.fn(async()=>({ok:true,status:200,json:async()=>({success:true,voted,count:7})}));
  vi.stubGlobal('fetch',request);expect(request).not.toHaveBeenCalled();
  expect(await voteReply('1560607',voted)).toEqual({voted,count:7});
  expect(request).toHaveBeenCalledWith('https://www.guozaoke.com/replyVote?reply_id=1560607',expect.objectContaining({
    method:'POST',credentials:'include',redirect:'error',cache:'no-store',body:`voted=${voted?'1':'0'}&_xsrf=test-token`,
  }));
});
it('无防伪标记、非法编号均不请求；隐藏字段原样透传，cookie 仅解码一次',async()=>{
  const request=vi.fn(async()=>({ok:true,status:200,json:async()=>({success:true,voted:true,count:1})}));vi.stubGlobal('fetch',request);
  await expect(voteReply('../logout')).rejects.toThrow('编号');document.body.replaceChildren();
  await expect(voteReply('1')).rejects.toThrow('登录');expect(request).not.toHaveBeenCalled();
  document.cookie='_xsrf=a%2Bb; Path=/';await voteReply('1');expect(request).toHaveBeenLastCalledWith(expect.any(String),expect.objectContaining({body:'voted=1&_xsrf=a%2Bb'}));
});
it.each([{success:true},{success:true,voted:true,count:-1},{success:true,voted:1,count:2},{success:true,voted:false,count:1.5}])('不把无效服务端结果当成功：%j',async result=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:async()=>result})));
  await expect(voteReply('1')).rejects.toThrow('有效赞数');
});
it('网络异常、非 JSON 和站点错误保留友好提示',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('Failed to fetch');}));
  await expect(voteReply('1')).rejects.toThrow('点赞请求未完成');
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:async()=>{throw new SyntaxError('Unexpected token');}})));
  await expect(voteReply('1')).rejects.toThrow('可识别的结果');
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:async()=>({success:false,message:'user_not_login'})})));
  await expect(voteReply('1')).rejects.toThrow('登录');
});
