import { expect, it } from 'vitest';
import { defaults } from '../src/shared/settings';
import { applyAction, initialState, validateBackup } from '../src/shared/state';
it('首次安装与恢复默认遵循参考版默认体验，保留已保存的显式选择', () => {
  const reference = {openInNewTab:false,autoTheme:false,preload:false,hideReplyTime:true,hideRefName:true,layout:'vertical'};
  expect(initialState().settings).toMatchObject(reference);
  const chosen = applyAction(initialState(),'settings',{openInNewTab:true,autoTheme:true,preload:true,hideReplyTime:false,hideRefName:false,layout:'auto'});
  expect(validateBackup({version:1,...chosen}).settings).toEqual(chosen.settings);
  expect(applyAction(chosen,'reset').settings).toMatchObject(reference);
});
it('导入拒绝错误版本、危险链接、不正确开关，不改变原状态', () => {
  const state=initialState();
  expect(()=>validateBackup({version:99,...state})).toThrow();
  expect(()=>validateBackup({version:1,...state,settings:{enabled:'false'}})).toThrow();
  expect(()=>validateBackup({version:1,...state,reading:[{id:'1',url:'javascript:alert(1)'}]})).toThrow();
  expect(state.settings).toEqual(defaults);
});
it('同一主题去重并保留已读，标签和配置导入完整恢复', () => {
  const t={id:'1',url:'https://www.guozaoke.com/t/1',title:'帖子',author:'a',avatar:'',node:'IT',replies:0,time:''};
  let s=applyAction(initialState(),'reading:add',t);
  s=applyAction(s,'reading:read',{id:'1',read:true});
  s=applyAction(s,'reading:add',t);
  expect(s.reading).toHaveLength(1);
  expect(s.reading[0]?.read).toBe(true);
  s=applyAction(s,'tags',{username:'a',tags:['友善','开发者']});
  expect(validateBackup({version:1,...s})).toEqual(s);
  expect(applyAction(s,'reset').reading).toEqual(s.reading);
});
