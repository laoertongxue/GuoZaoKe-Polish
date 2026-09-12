import { bindEmojiFormData, openEditorEmojiPicker, renderEditorPreview } from '../../src/features/emoji';
import '../../src/styles/emoji.css';
import './emoji-fixture.css';
const input=document.querySelector<HTMLTextAreaElement>('#inputor')!, form=input.form!;
const preview=document.querySelector<HTMLElement>('#preview-content')!;
const enabled=document.querySelector<HTMLInputElement>('#enabled')!;
enabled.addEventListener('change',()=>document.documentElement.classList.toggle('gzk-disabled',!enabled.checked));
const update=()=>{if(!preview.hidden)renderEditorPreview(preview,input.value);};
document.querySelector('#emoji')!.addEventListener('click',()=>openEditorEmojiPicker(input));
document.querySelector('#preview')!.addEventListener('click',()=>{preview.hidden=!preview.hidden;update();});
input.addEventListener('input',update);
bindEmojiFormData(input);
form.addEventListener('formdata',event=>{
  // Expose this fixture's own observations on the local result page. No browser
  // automation API is used and the production event handler is not replaced.
  sessionStorage.setItem('gzk-emoji-fixture',JSON.stringify({draft:input.value,enabled:enabled.checked,fields:[...event.formData]}));
});
input.addEventListener('keydown',event=>{
  if(event.ctrlKey&&event.key==='Enter'){event.preventDefault();form.submit();}
});
