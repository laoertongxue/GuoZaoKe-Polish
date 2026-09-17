import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { applyAction } from '../src/shared/state';
import { readableUrl, topicUrl, ORIGIN } from '../src/site/urls';
import { readStoredState } from '../src/shared/storage';
import { readShareImage } from '../src/site/share-images';
import { uploadImage } from '../src/site/image-upload';
import { createAnalysisHandler } from '../src/analysis/background';
import { fetchEvidenceBytes, searchTavily } from '../src/analysis/evidence';

export default defineBackground(() => {
  const analysis = createAnalysisHandler(browser, {
    search: (query, key, signal) => searchTavily(query, key, { signal }),
    readSource: (url, signal,maxBytes) => fetchEvidenceBytes(url, { signal,maxBytes }),
  });
  // Keep sensitive storage inaccessible to content scripts, with no persistent fallback.
  void browser.storage.session?.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
  let queue=Promise.resolve();
  const serial=<T>(run:()=>Promise<T>):Promise<T>=>{
    const result=queue.then(run); queue=result.then(()=>undefined,()=>undefined); return result;
  };
  const read=readStoredState;
  async function write(action:string,payload:unknown) {
    const old=await read(), next=applyAction(old,action,payload);
    const prefs={settings:next.settings,tags:next.tags};
    const changed=JSON.stringify(prefs)!==JSON.stringify({settings:old.settings,tags:old.tags});
    if (changed) {
      if (new TextEncoder().encode(JSON.stringify(prefs)).length>7800) throw new Error('设置和标签超过浏览器单项同步容量，请先导出备份并减少标签');
      await browser.storage.sync.set({'gzk:prefs':prefs});
    }
    try { if (JSON.stringify(old.reading)!==JSON.stringify(next.reading)) await browser.storage.local.set({'gzk:state':{reading:next.reading}}); }
    catch (error) { if(changed) await browser.storage.sync.set({'gzk:prefs':{settings:old.settings,tags:old.tags}}); throw error; }
    return next;
  }
  const requests=new Map<string,Promise<string>>();
  async function getPage(value:string):Promise<string> {
    const url=readableUrl(value);
    if (requests.has(url)) return requests.get(url)!;
    const task=(async()=>{
      const res=await fetch(url,{credentials:'include',redirect:'follow',signal:AbortSignal.timeout(20000)});
      const final=new URL(res.url);
      if (final.origin!==ORIGIN) throw new Error('站点跳转到了意外地址');
      if (final.pathname==='/login') throw new Error('请先登录过早客后重试');
      if (!res.ok) throw new Error(`过早客请求失败（${res.status}）`);
      if (!(res.headers.get('content-type')||'').includes('text/html')) throw new Error('站点返回了非网页内容');
      const html=await res.text();
      if (html.length>5_000_000) throw new Error('页面过大，已停止读取');
      return html;
    })();
    requests.set(url,task);
    try {return await task;} finally {requests.delete(url);}
  }
  browser.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if (sender.id!==browser.runtime.id) return;
    const run=async()=>{
      if (typeof message?.type === 'string' && message.type.startsWith('analysis:')) return analysis(message, sender);
      if (message?.type==='state:get') return serial(read);
      if (message?.type==='state:mutate') return serial(()=>write(message.action,message.payload));
      if (message?.type==='site:get') return getPage(message.url);
      if (message?.type==='share:open') { const id=topicUrl(message.url).split('/').pop()!; await browser.tabs.create({url:`${browser.runtime.getURL('/share.html')}?topic=${id}`});return true; }
      if (message?.type==='share:image') return readShareImage(message.url,origin=>browser.permissions.contains({origins:[origin]}));
      if (message?.type==='image:upload') {
        return uploadImage(message,sender);
      }
      if (message?.type==='options:open') {
        if(message.page==='tags') await browser.tabs.create({url:`${browser.runtime.getURL('/options.html')}#tags`});
        else if(message.page==='images') await browser.tabs.create({url:`${browser.runtime.getURL('/options.html')}#image-hosting`});
        else await browser.runtime.openOptionsPage();
        return true;
      }
      throw new Error('未知请求');
    };
    run().then(data=>sendResponse({ok:true,data}),error=>sendResponse({ok:false,error:error instanceof Error?error.message:'操作失败'}));
    return true;
  });
  browser.runtime.onInstalled.addListener(async()=>{
    await browser.contextMenus.removeAll();
    const patterns=['https://www.guozaoke.com/*','https://guozaoke.com/*'];
    browser.contextMenus.create({id:'gzk-decode',title:'GuoZaoKe Polish：解码 Base64',contexts:['selection'],documentUrlPatterns:patterns});
    browser.contextMenus.create({id:'gzk-reading',title:'加入稍后阅读',contexts:['page','link'],documentUrlPatterns:patterns});
    browser.contextMenus.create({id:'gzk-options',title:'GuoZaoKe Polish 控制选项',contexts:['page'],documentUrlPatterns:patterns});
  });
  browser.contextMenus.onClicked.addListener(async(info,tab)=>{
    try {
      if(info.menuItemId==='gzk-options') return await browser.runtime.openOptionsPage();
      if(tab?.id==null) return;
      if(info.menuItemId==='gzk-decode') await browser.tabs.sendMessage(tab.id,{type:'decode',text:info.selectionText||''});
      if(info.menuItemId==='gzk-reading') await browser.tabs.sendMessage(tab.id,{type:'reading',url:topicUrl(info.linkUrl||info.pageUrl||'')});
    } catch(error) { console.warn('GuoZaoKe Polish 右键操作：',error); }
  });
});
