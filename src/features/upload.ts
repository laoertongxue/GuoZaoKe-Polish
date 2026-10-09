import {browser} from 'wxt/browser';
import {button,el,modal,toast} from '../shared/ui';
import {safeLink} from '../site/urls';

const ALLOWED_TYPES = ['image/png','image/jpeg','image/gif','image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;
type Provider = 'bilibili' | 'imgur';

async function readBase64(file:File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]!);
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

async function readProvider(): Promise<Provider> {
  try {
    const config = await browser.storage.local.get(['gzk:image-provider','gzk:imgur-client']);
    const saved = config['gzk:image-provider'];
    if (saved === 'imgur' || saved === 'bilibili') return saved;
    return config['gzk:imgur-client'] ? 'imgur' : 'bilibili';
  } catch {
    return 'bilibili';
  }
}

function replacePlaceholder(input:HTMLTextAreaElement, placeholder:string, replacement:string): boolean {
  const index = input.value.indexOf(placeholder);
  if (index === -1) return false;
  input.setRangeText(replacement, index, index + placeholder.length, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function removePlaceholder(input:HTMLTextAreaElement, placeholder:string): boolean {
  const value = input.value;
  const index = value.indexOf(placeholder);
  if (index === -1) return false;
  // Strip the placeholder together with its two adjacent line breaks.
  let start = index;
  let end = index + placeholder.length;
  if (value[start - 1] === '\n') start--;
  if (value[end] === '\n') end++;
  input.setRangeText('', start, end, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/** Auto-upload an image without opening any dialog. Inserts a placeholder, swaps it for the public link on success, or removes it and shows a toast on failure. */
export async function autoUploadImage(input:HTMLTextAreaElement, file:File): Promise<void> {
  if (!ALLOWED_TYPES.includes(file.type) || !file.size || file.size > MAX_BYTES) {
    toast('每张图片限 PNG/JPG/GIF/WebP 且不超过 10 MB');
    return;
  }
  const placeholder = `[图片上传中：${file.name}…]`;
  const start = input.selectionStart;
  input.setRangeText(`\n${placeholder}\n`, start, input.selectionEnd, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const provider = await readProvider();
  let base64: string;
  try {
    base64 = await readBase64(file);
  } catch (error) {
    removePlaceholder(input, placeholder);
    toast(error instanceof Error ? error.message : '读取图片失败');
    return;
  }
  try {
    const result = await browser.runtime.sendMessage({ type: 'image:upload', provider, base64, mime: file.type });
    if (!result?.ok) throw new Error(result?.error || '上传失败');
    const link = safeLink(result.data);
    if (!link) throw new Error('图床未返回有效图片链接');
    if (!replacePlaceholder(input, placeholder, link)) {
      // Placeholder was removed by the user; still surface the link so it is not lost.
      input.setRangeText(`\n${link}\n`, input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } catch (error) {
    removePlaceholder(input, placeholder);
    toast(error instanceof Error ? error.message : '上传失败');
  }
}

export async function imageDialog(insert:(text:string)=>void,initial:File[]=[]) {
  let uploading=false;
  const view=modal('上传图片',{canClose:()=>{
    if(!uploading)return true;
    toast('图片正在上传，请等待结果后关闭。');return false;
  }});
  const intro=el('p','选择图床并上传，公共图片链接会插入当前草稿。');
  const label=el('label','已有图片链接');label.htmlFor='gzk-image-url';
  const url=el('input');url.id='gzk-image-url';url.type='url';url.placeholder='https://…/image.png';url.style.width='100%';
  const insertLink=button('插入链接',()=>{const value=safeLink(url.value);if(!value)throw new Error('请输入有效的图片网址');insert(`\n${value}\n`);view.close();});
  const actions=el('div','','actions');actions.append(insertLink);
  const providerLabel=el('label','上传图床');providerLabel.htmlFor='gzk-image-provider';
  const provider=el('select');provider.id='gzk-image-provider';provider.disabled=true;
  for(const [value,name] of [['bilibili','B 站（试用）'],['imgur','Imgur']]){const option=el('option',name);option.value=value!;provider.append(option);}
  const note=el('p','','muted');note.id='gzk-image-provider-note';provider.setAttribute('aria-describedby',note.id);
  const login=el('a','打开 B 站登录');login.href='https://www.bilibili.com/';login.target='_blank';login.rel='noopener noreferrer';
  const selection=el('input');selection.type='file';selection.accept='image/png,image/jpeg,image/gif,image/webp';selection.multiple=true;selection.setAttribute('aria-label','选择上传图片');
  const status=el('p','','status');status.setAttribute('role','status');
  const selected=el('p','','muted');let files=[...initial];let closed=false;
  view.dialog.addEventListener('close',()=>{closed=true;});
  const describe=()=>{selected.textContent=files.length?files.map(f=>`${f.name} (${Math.round(f.size/1024)} KB)`).join('、'):'支持选择、粘贴或拖放 PNG / JPG / GIF / WebP 图片，单张不超过 10 MB。';};describe();
  selection.addEventListener('change',()=>{files=Array.from(selection.files||[]);describe();});
  const upload=button('上传',async()=>{
    if(upload.disabled)return;
    if(!files.length)throw new Error('请先选择图片');
    if(files.some(f=>!['image/png','image/jpeg','image/gif','image/webp'].includes(f.type)||!f.size||f.size>10*1024*1024))throw new Error('每张图片限 PNG/JPG/GIF/WebP 且不超过 10 MB');
    const host=provider.value, remaining=[...files];
    uploading=true;
    upload.disabled=selection.disabled=provider.disabled=insertLink.disabled=url.disabled=true;
    try{
      for(const file of [...files]){
        if(closed)break;
        status.textContent=`正在上传 ${file.name}…`;
        const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]!);reader.onerror=()=>reject(new Error('读取图片失败'));reader.readAsDataURL(file);});
        if(closed)break;
        // Permission checks and all authentication remain in the background.
        const result=await browser.runtime.sendMessage({type:'image:upload',provider:host,base64,mime:file.type});
        if(!result?.ok)throw new Error(result?.error||'上传失败');
        const link=safeLink(result.data);if(!link)throw new Error('图床未返回有效图片链接');
        insert(`\n${link}\n`);remaining.shift();
      }
      if(!closed){uploading=false;view.close();toast('图片链接已插入草稿');}
    }catch(error){files=remaining;describe();status.textContent=error instanceof Error?error.message:'上传失败';}
    finally{uploading=false;upload.disabled=selection.disabled=provider.disabled=insertLink.disabled=url.disabled=false;}
  });
  upload.disabled=true;
  const syncProvider=()=>{
    const bilibili=provider.value==='bilibili';
    upload.textContent=bilibili?'上传到 B 站并插入':'上传到 Imgur 并插入';
    note.textContent=bilibili?'首次请在图床配置中启用 B 站上传。使用本浏览器的 B 站登录状态，无需填写凭证；图片上传后可通过链接公开访问，外链显示可能受 B 站限制。':'使用你已配置的 Imgur Client ID。图片上传后可通过链接公开访问。';
    login.hidden=!bilibili;
  };
  provider.addEventListener('change',()=>{syncProvider();status.textContent='';});syncProvider();
  const settings=button('图床配置',()=>browser.runtime.sendMessage({type:'options:open',page:'images'}));
  const uploadActions=el('div','','actions');uploadActions.append(upload,settings,login);
  view.body.append(intro,label,url,actions,el('hr'),providerLabel,provider,note,selection,selected,uploadActions,status);
  try{
    const config=await browser.storage.local.get(['gzk:image-provider','gzk:imgur-client']);
    const saved=config['gzk:image-provider'];
    provider.value=saved==='imgur'||saved==='bilibili'?saved:config['gzk:imgur-client']?'imgur':'bilibili';
  }catch{status.textContent='未能读取图床偏好，请手动选择。';}
  finally{syncProvider();provider.disabled=upload.disabled=false;}
}
