import {browser} from 'wxt/browser';
import {button,el,modal,toast} from '../shared/ui';
import {safeLink} from '../site/urls';
export async function imageDialog(insert:(text:string)=>void,initial:File[]=[]) {
  const view=modal('上传图片'),intro=el('p','过早客使用外链图片。上传到 Imgur 后，图片链接会插入当前草稿。');
  const note=el('p','配置自己的 Imgur Client ID 后可上传；也可以直接插入已有图片链接。','muted');
  const label=el('label','已有图片链接');label.htmlFor='gzk-image-url';const url=el('input');url.id='gzk-image-url';url.type='url';url.placeholder='https://…/image.png';url.style.width='100%';
  const actions=el('div','','actions');actions.append(button('插入链接',()=>{const value=safeLink(url.value);if(!value)throw new Error('请输入有效的图片网址');insert(`\n${value}\n`);view.close();}));
  const selection=el('input');selection.type='file';selection.accept='image/png,image/jpeg,image/gif,image/webp';selection.multiple=true;selection.setAttribute('aria-label','选择上传图片');
  const status=el('p','','status'),selected=el('p','','muted');let files=initial;
  const describe=()=>{selected.textContent=files.length?files.map(f=>`${f.name} (${Math.round(f.size/1024)} KB)`).join('、'):'支持选择、粘贴或拖放 PNG / JPG / GIF / WebP 图片。';};describe();
  selection.addEventListener('change',()=>{files=Array.from(selection.files||[]);describe();});
  const upload=button('上传到 Imgur 并插入',async()=>{
    if(!files.length)throw new Error('请先选择图片');
    if(files.some(f=>!['image/png','image/jpeg','image/gif','image/webp'].includes(f.type)||f.size>10*1024*1024))throw new Error('每张图片限 PNG/JPG/GIF/WebP 且不超过10MB');
    const config=await browser.storage.local.get('gzk:imgur-client');if(!config['gzk:imgur-client']){status.textContent='请在控制选项的图床配置中填写自己的 Imgur Client ID。';return;}
    // Only the background can inspect optional permissions; content scripts cannot.
    upload.disabled=true;const remaining=[...files];
    try{for(const file of files){status.textContent=`正在上传 ${file.name}…`;const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]!);reader.onerror=()=>reject(new Error('读取图片失败'));reader.readAsDataURL(file);});
      const result=await browser.runtime.sendMessage({type:'image:upload',base64,mime:file.type});if(!result?.ok)throw new Error(result?.error||'上传失败');const link=safeLink(result.data);if(!link)throw new Error('图床未返回有效图片链接');insert(`\n${link}\n`);remaining.shift();}
      view.close();toast('图片链接已插入草稿');
    }catch(error){files=remaining;describe();status.textContent=error instanceof Error?error.message:'上传失败';}finally{upload.disabled=false;}
  });
  const settings=button('图床配置',()=>browser.runtime.sendMessage({type:'options:open'}));
  const uploadActions=el('div','','actions');uploadActions.append(upload,settings);view.body.append(intro,note,label,url,actions,el('hr'),selection,selected,uploadActions,status);
}
