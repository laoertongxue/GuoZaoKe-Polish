import { afterEach, beforeEach, expect, it } from 'vitest';
import { installImagePreview } from '../src/features/image-preview';
import { defaults } from '../src/shared/settings';
import { modal } from '../src/shared/ui';

const settle=async()=>{await Promise.resolve();await Promise.resolve();};
const root=()=>document.querySelector('.gzk-overlay-host')?.shadowRoot;
let stop:()=>void;
beforeEach(()=>{
  document.body.innerHTML='<div class="topic-detail"><div class="ui-content"><a href="#original-image"><img src="https://example.com/photo.png" alt="测试图"></a></div></div>';
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new Event('close'));};
});
afterEach(()=>{stop?.();document.body.style.removeProperty('overflow');});

it('全屏预览从1倍以0.5步长缩放，限制在0.5到3倍，图片点击不关闭',async()=>{
  stop=installImagePreview(()=>defaults);
  document.querySelector('img')!.click();
  const dialog=root()!.querySelector('dialog')!,image=root()!.querySelector('img')!;
  expect(dialog.getAttribute('aria-label')).toBe('查看图片');
  expect(image.alt).toBe('测试图');expect(image.style.transform).toBe('scale(1)');
  const buttons=root()!.querySelectorAll<HTMLButtonElement>('button');
  expect(Array.from(buttons).map(b=>b.textContent)).toEqual(['放大','缩小']);
  buttons[0]!.click();await settle();expect(image.style.transform).toBe('scale(1.5)');
  for(let i=0;i<8;i++){buttons[0]!.click();await settle();}
  expect(image.style.transform).toBe('scale(3)');
  for(let i=0;i<8;i++){buttons[1]!.click();await settle();}
  expect(image.style.transform).toBe('scale(0.5)');
  image.click();expect(dialog.open).toBe(true);
});
it('锁定背景滚动；只在完整按下抬起遮罩时关闭，恢复原有行内样式',()=>{
  document.body.style.setProperty('overflow','scroll','important');stop=installImagePreview(()=>defaults);
  document.querySelector('img')!.click();expect(document.body.style.overflow).toBe('hidden');
  const dialog=root()!.querySelector('dialog')!,image=root()!.querySelector('img')!;
  image.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));dialog.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  expect(dialog.open).toBe(true);
  dialog.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));dialog.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  expect(root()).toBeUndefined();expect(document.body.style.overflow).toBe('scroll');expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
});
it('Esc取消和功能清理均移除预览及滚动锁定，关闭后再开重置缩放',async()=>{
  stop=installImagePreview(()=>defaults);document.querySelector('img')!.click();
  root()!.querySelector('button')!.click();await settle();
  root()!.querySelector('dialog')!.dispatchEvent(new Event('cancel',{cancelable:true}));
  expect(root()).toBeUndefined();expect(document.body.style.overflow).toBe('');
  document.querySelector('img')!.click();expect(root()!.querySelector('img')!.style.transform).toBe('scale(1)');
  stop();expect(root()).toBeUndefined();expect(document.body.style.overflow).toBe('');
  const click=new MouseEvent('click',{bubbles:true,cancelable:true});document.querySelector('img')!.dispatchEvent(click);
  expect(root()).toBeUndefined();expect(click.defaultPrevented).toBe(false);
});
it.each([{...defaults,enabled:false},{...defaults,imagePreview:false}])('停用时保留原站图片链接行为',settings=>{
  stop=installImagePreview(()=>settings);
  const click=new MouseEvent('click',{bubbles:true,cancelable:true});document.querySelector('img')!.dispatchEvent(click);
  expect(root()).toBeUndefined();expect(click.defaultPrevented).toBe(false);
});
it('拒绝危险图片源，且不接管头像等正文以外的图片',()=>{
  stop=installImagePreview(()=>defaults);
  document.querySelector('img')!.src='javascript:alert(1)';document.querySelector('img')!.click();
  const avatar=document.createElement('img');avatar.src='https://example.com/avatar.png';document.body.append(avatar);avatar.click();
  expect(root()).toBeUndefined();
});
it('图片预览与普通弹窗交错关闭时，最后一个关闭后才还原滚动',()=>{
  document.body.style.setProperty('overflow','scroll','important');
  stop=installImagePreview(()=>defaults);document.querySelector('img')!.click();
  const second=modal('测试弹窗');
  stop();expect(document.body.style.overflow).toBe('hidden');
  second.close();expect(document.body.style.overflow).toBe('scroll');
  expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
});
