import {it,expect,vi} from 'vitest';
const {sendMessage}=vi.hoisted(()=>({sendMessage:vi.fn(async()=>({ok:true,data:true}))}));
vi.mock('wxt/browser',()=>({browser:{runtime:{sendMessage}}}));
import {installAnalysisEntry} from '../src/features/analysis';
it('ignores website-generated clicks so they cannot request paid analysis or its fallback',async()=>{
 const installed=installAnalysisEntry('https://www.guozaoke.com/t/121894');document.body.append(installed.entry);
 await vi.waitFor(()=>expect(installed.entry.disabled).toBe(false));
 installed.entry.click();installed.entry.dispatchEvent(new MouseEvent('click',{bubbles:true}));
 await Promise.resolve();expect(sendMessage).toHaveBeenCalledTimes(1);expect(sendMessage).toHaveBeenCalledWith({type:'analysis:panel:prepare',url:'https://www.guozaoke.com/t/121894'});installed.destroy();
});
