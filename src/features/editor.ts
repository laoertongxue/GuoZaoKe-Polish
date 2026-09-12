import { button,el,modal,toast } from '../shared/ui';
import { encodeBase64,decodeBase64 } from './encoding';
import { imageDialog } from './upload';
import { bindEmojiFormData, openEditorEmojiPicker, renderEditorPreview } from './emoji';
import '../styles/emoji.css';
export function showDecode(value:string) {
  const view=modal('Base64 解码');const output=el('textarea');output.readOnly=true;output.setAttribute('aria-label','解码结果');
  try{output.value=decodeBase64(value);view.body.append(output,button('复制结果',async()=>{await navigator.clipboard.writeText(output.value);toast('已复制');}));}
  catch(error){view.body.textContent=error instanceof Error?error.message:'解码失败';}
}
export function decodePage() {
  const walker=document.createTreeWalker(document.querySelector('.sidebar-left')||document.body,NodeFilter.SHOW_TEXT);
  const nodes:Text[]=[];while(walker.nextNode()) {const n=walker.currentNode as Text;if(n.parentElement&&!n.parentElement.closest('script,style,textarea,input,button,.gzk-decoded'))nodes.push(n);}
  let count=0;
  for(const node of nodes){const matches=[...node.data.matchAll(/\b[A-Za-z0-9+/]{16,}={0,2}/g)];if(!matches.length)continue;const fragment=document.createDocumentFragment();let last=0;
    for(const m of matches){let decoded:string;try{decoded=decodeBase64(m[0]);if(!decoded.trim()||/[\u0000-\u0008\u000e-\u001f]/.test(decoded))continue;}catch{continue;}
      fragment.append(document.createTextNode(node.data.slice(last,m.index)));const mark=el('span',decoded,'gzk-decoded');mark.title=`Base64：${m[0]}`;fragment.append(mark);last=m.index!+m[0].length;count++;
    }
    if(last){fragment.append(document.createTextNode(node.data.slice(last)));node.replaceWith(fragment);}
  }
  toast(count?`已解码 ${count} 处文本`:'页面中没有可解码的 Base64 文本');
}
export function enhanceEditors() {
  let active=true;
  const cleanups:Array<()=>void>=[];
  const enabled=()=>active&&!document.documentElement.classList.contains('gzk-disabled');
  document.querySelectorAll<HTMLTextAreaElement>('textarea.J_replyContent, textarea[name="content"], textarea[name="text"]').forEach(input=>{
    if(input.dataset.gzkEditor)return;input.dataset.gzkEditor='true';
    const toolbar=el('div','','gzk-editor-toolbar');const preview=el('div','','gzk-editor-preview');preview.hidden=true;preview.setAttribute('aria-label','回复内容预览');
    const insert=(value:string,focus=true)=>{if(!enabled())return;input.setRangeText(value,input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input',{bubbles:true}));if(focus)input.focus();};
    const update=()=>{if(enabled()&&!preview.hidden)renderEditorPreview(preview,input.value);};
    const previewButton=button('预览',()=>{preview.hidden=!preview.hidden;previewButton.textContent=preview.hidden?'预览':'收起预览';previewButton.setAttribute('aria-pressed',String(!preview.hidden));update();});
    toolbar.append(button('☺ 表情',()=>openEditorEmojiPicker(input)),previewButton,button('上传图片',()=>imageDialog(insert)),button('转 Base64',()=>{const selection=input.value.slice(input.selectionStart,input.selectionEnd);if(!selection){toast('请先选中要编码的文字');return;}insert(encodeBase64(selection));}),button('解码',()=>{const text=input.value.slice(input.selectionStart,input.selectionEnd);if(!text){toast('请先选中 Base64 文字');return;}insert(decodeBase64(text));}));
    input.before(toolbar);input.after(preview);input.addEventListener('input',update);
    const unbindEmoji=bindEmojiFormData(input);
    const paste=(event:ClipboardEvent)=>{if(!enabled())return;const files=Array.from(event.clipboardData?.files||[]).filter(f=>f.type.startsWith('image/'));if(files.length){event.preventDefault();void imageDialog(insert,files);}};
    const dragover=(event:DragEvent)=>{if(enabled()&&event.dataTransfer?.types.includes('Files'))event.preventDefault();};
    const drop=(event:DragEvent)=>{if(!enabled())return;const files=Array.from(event.dataTransfer?.files||[]).filter(f=>f.type.startsWith('image/'));if(files.length){event.preventDefault();void imageDialog(insert,files);}};
    input.addEventListener('paste',paste);input.addEventListener('dragover',dragover);input.addEventListener('drop',drop);
    cleanups.push(()=>{
      input.removeEventListener('input',update);input.removeEventListener('paste',paste);input.removeEventListener('dragover',dragover);input.removeEventListener('drop',drop);
      unbindEmoji();toolbar.remove();preview.remove();delete input.dataset.gzkEditor;
    });
  });
  return ()=>{if(!active)return;active=false;cleanups.forEach(cleanup=>cleanup());};
}
