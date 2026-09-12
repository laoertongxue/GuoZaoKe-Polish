import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { applyAction } from '../src/shared/state';
import { readableUrl, topicUrl, ORIGIN } from '../src/site/urls';
import { readStoredState } from '../src/shared/storage';
import { readShareImage } from '../src/site/share-images';

export default defineBackground(() => {
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
      if (message?.type==='state:get') return serial(read);
      if (message?.type==='state:mutate') return serial(()=>write(message.action,message.payload));
      if (message?.type==='site:get') return getPage(message.url);
      if (message?.type==='share:open') { const id=topicUrl(message.url).split('/').pop()!; await browser.tabs.create({url:`${browser.runtime.getURL('/share.html')}?topic=${id}`});return true; }
      if (message?.type==='share:image') return readShareImage(message.url,origin=>browser.permissions.contains({origins:[origin]}));
      if (message?.type==='image:upload') {
        if(typeof message.base64!=='string'||message.base64.length>14_000_000||!/^[A-Za-z0-9+/]+=*$/.test(message.base64)||!['image/png','image/jpeg','image/gif','image/webp'].includes(message.mime))throw new Error('图片格式或大小不支持');
        if(!await browser.permissions.contains({origins:['https://api.imgur.com/*']}))throw new Error('请先在控制选项中授权 Imgur');
        const stored=await browser.storage.local.get('gzk:imgur-client');const client=stored['gzk:imgur-client'];
        if(typeof client!=='string'||!client.trim())throw new Error('请先配置 Imgur Client ID');
        const body=new FormData();body.append('image',message.base64);body.append('type','base64');
        const res=await fetch('https://api.imgur.com/3/image',{method:'POST',headers:{Authorization:`Client-ID ${client.trim()}`},body,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(60000)});
        const json=await res.json();if(!res.ok||!json.success||typeof json.data?.link!=='string')throw new Error(`Imgur 上传失败（${res.status}），请检查 Client ID、网络或额度`);
        const link=new URL(json.data.link);if(link.protocol!=='https:'||link.hostname!=='i.imgur.com')throw new Error('图床返回了意外地址');
        return link.href;
      }
      if (message?.type==='options:open') {
        if(message.page==='tags') await browser.tabs.create({url:`${browser.runtime.getURL('/options.html')}#tags`});
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
