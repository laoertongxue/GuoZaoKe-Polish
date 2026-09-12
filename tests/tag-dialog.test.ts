import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { showTagDialog } from '../src/features/tag-dialog';
beforeEach(()=>{
  document.body.innerHTML='<button id="opener">标签</button>';document.querySelector<HTMLButtonElement>('#opener')!.focus();
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new Event('close'));};
});
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();});
it('全宽多行编辑并在底部保存，逗号分隔标签，关闭后焦点回原入口',async()=>{
  const save=vi.fn(async()=>{}),all=vi.fn();const view=showTagDialog('demo',['同城'],save,all);
  const input=view.body.querySelector('textarea')!;expect(input.value).toBe('同城');expect(view.body.querySelector('label')!.htmlFor).toBe(input.id);
  expect([...view.footer.querySelectorAll('button')].map(b=>b.textContent)).toEqual(['查看全部标签','关闭Esc','确认设置']);
  view.footer.querySelector('button')!.click();await Promise.resolve();expect(all).toHaveBeenCalledOnce();
  input.value='同城, 技术，朋友';view.footer.querySelector<HTMLButtonElement>('.primary')!.click();await vi.waitFor(()=>expect(view.host.isConnected).toBe(false));
  expect(save).toHaveBeenCalledWith(['同城','技术','朋友']);expect(document.activeElement?.id).toBe('opener');
});
it('保存中避免重复提交，失败留在当前弹窗并保留输入',async()=>{
  let reject!:(reason:Error)=>void;const save=vi.fn(()=>new Promise((_,r)=>{reject=r;}));const view=showTagDialog('demo',[],save,()=>{});
  const input=view.body.querySelector('textarea')!;input.value='标签';const confirm=view.footer.querySelector<HTMLButtonElement>('.primary')!;
  confirm.click();confirm.click();await Promise.resolve();expect(save).toHaveBeenCalledOnce();expect(confirm.disabled).toBe(true);
  reject(Error('保存失败测试'));await vi.waitFor(()=>expect(confirm.disabled).toBe(false));expect(view.host.isConnected).toBe(true);expect(input.value).toBe('标签');expect(view.body.querySelector('[role=alert]')!.textContent).toBe('保存失败测试');view.close();
});
