import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountShareWorkspace } from '../src/features/share-card';
import { rasterizeShareCard } from '../src/features/share-render';
vi.mock('../src/features/share-render', () => ({rasterizeShareCard:vi.fn()}));
vi.mock('qrcode', () => ({default:{toDataURL:async()=> 'data:image/png;base64,cXI='}}));
const topic = {id:'1',url:'https://www.guozaoke.com/t/1',title:'测试',author:'alice',avatar:'',node:'分享',replies:0,time:'2026-09-12',html:'<p>完整正文</p>',text:'完整正文'};
let root: HTMLElement;
const action = (text: string) => [...root.querySelectorAll('button')].find(button=>button.textContent===text)!;
function deferred<T>() { let resolve!: (value:T)=>void; const promise = new Promise<T>(yes=>{resolve=yes;}); return {promise,resolve}; }
beforeEach(() => {
  root = document.createElement('main'); document.body.append(root);
  vi.stubGlobal('URL', class extends URL {static override createObjectURL=vi.fn(()=> 'blob:test'); static override revokeObjectURL=vi.fn();});
  vi.stubGlobal('ClipboardItem', class {constructor(public data:Record<string,Promise<Blob>>) {}});
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); document.body.replaceChildren(); });
it('剪贴板提前拒绝时等待图片生成结束，避免解锁后复用旧二维码图片', async () => {
  const drawing = deferred<Blob[]>(); vi.mocked(rasterizeShareCard).mockReturnValueOnce(drawing.promise).mockResolvedValue([new Blob(['next'],{type:'image/png'})]);
  const write = vi.fn().mockRejectedValue(new Error('剪贴板拒绝')); vi.stubGlobal('navigator',{clipboard:{write}});
  const destroy = await mountShareWorkspace(root, topic, {readImage:vi.fn(),authorize:vi.fn()});
  await vi.waitFor(()=>expect(action('复制为图片').disabled).toBe(false));
  action('复制为图片').click();
  await vi.waitFor(()=>expect(rasterizeShareCard).toHaveBeenCalledOnce());
  expect(action('复制为图片').disabled).toBe(true);
  expect(root.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
  drawing.resolve([new Blob(['original'],{type:'image/png'})]);
  await vi.waitFor(()=>expect(action('复制为图片').disabled).toBe(false));
  expect(root.querySelector('[role=status]')!.textContent).toContain('剪贴板拒绝');
  const qr = root.querySelector<HTMLInputElement>('input')!; qr.checked=false;qr.dispatchEvent(new Event('change'));
  await vi.waitFor(()=>expect(action('复制为图片').disabled).toBe(false));
  write.mockResolvedValue(undefined); action('复制为图片').click();
  await vi.waitFor(()=>expect(rasterizeShareCard).toHaveBeenCalledTimes(2));
  expect(vi.mocked(rasterizeShareCard).mock.calls[1]![0].querySelector('.share-qr')).toBeNull();
  await vi.waitFor(()=>expect(action('复制为图片').disabled).toBe(false)); destroy();
});
it('复制API包装图片失败时保留原图片权限原因和授权入口', async () => {
  vi.stubGlobal('navigator',{clipboard:{write:async(items:{data:Record<string,Promise<Blob>>}[])=>{try{await items[0]!.data['image/png'];}catch{throw new Error('剪贴板数据无效');}}}});
  const destroy = await mountShareWorkspace(root,{...topic,avatar:'https://image.example.com/a.png'},{readImage:async()=>({permission:'https://image.example.com/*'}),authorize:vi.fn()});
  await vi.waitFor(()=>expect(action('复制为图片').disabled).toBe(false)); action('复制为图片').click();
  await vi.waitFor(()=>expect(action('复制为图片').disabled).toBe(false));
  expect(root.querySelector('[role=status]')!.textContent).toContain('图片未能读取');
  expect(action('允许读取这些图片来源')).toBeDefined();
  expect(rasterizeShareCard).not.toHaveBeenCalled(); destroy();
});
it('预览只挂载读取成功的data图片，不提前生成PNG', async () => {
  const reading = deferred<{data:string}>();
  const destroy = await mountShareWorkspace(root,{...topic,avatar:'https://image.example.com/a.png'},{readImage:()=>reading.promise,authorize:vi.fn()});
  expect([...root.querySelectorAll('img')].every(img=>!img.src.startsWith('https:'))).toBe(true);
  reading.resolve({data:'data:image/png;base64,cG5n'});
  await vi.waitFor(()=>expect(root.querySelector<HTMLImageElement>('.share-avatar')!.src).toBe('data:image/png;base64,cG5n'));
  expect(rasterizeShareCard).not.toHaveBeenCalled(); destroy();
});
it('ClipboardItem同步抛错仍等待生成并恢复可操作状态', async () => {
  const drawing = deferred<Blob[]>();vi.mocked(rasterizeShareCard).mockReturnValue(drawing.promise);
  vi.stubGlobal('ClipboardItem',class {constructor(){throw new Error('不支持Promise图片');}});
  vi.stubGlobal('navigator',{clipboard:{write:vi.fn()}});
  const destroy=await mountShareWorkspace(root,topic,{readImage:vi.fn(),authorize:vi.fn()});
  await vi.waitFor(()=>expect(action('复制为图片').disabled).toBe(false)); action('复制为图片').click();
  await vi.waitFor(()=>expect(rasterizeShareCard).toHaveBeenCalledOnce());expect(action('复制为图片').disabled).toBe(true);
  drawing.resolve([new Blob(['png'],{type:'image/png'})]);
  await vi.waitFor(()=>expect(action('复制为图片').disabled).toBe(false));
  expect(root.querySelector('[role=status]')!.textContent).toContain('不支持Promise图片'); destroy();
});
