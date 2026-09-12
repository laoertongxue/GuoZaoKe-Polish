import { getState, addReading, removeReading, markRead } from '../shared/store';
import type { Topic } from '../shared/types';
import { button, el, modal, richHtml, toast } from '../shared/ui';
import { fetchTopic } from '../site/client';
export async function saveTopic(topic:Topic) { await addReading(topic);toast('已加入稍后阅读'); }
export async function previewTopic(url:string) {
  const view=modal('主题预览'); view.body.textContent='正在读取主题…';
  try {
    const topic=await fetchTopic(url);if(!view.host.isConnected)return;
    view.body.replaceChildren();const title=el('h2',topic.title),info=el('p',`${topic.author} · ${topic.node} · ${topic.replies} 条回复`,'muted');const content=el('div');richHtml(content,topic.html,topic.url);
    const actions=el('div','','actions');const open=el('a','打开主题 ↗','gzk-button');open.href=topic.url;open.target='_blank';open.rel='noopener';actions.append(button('稍后阅读',()=>saveTopic(topic)),open);const heading=el('div','','preview-heading');heading.append(title,info);content.className='preview-content';view.body.append(heading,content);view.footer.append(actions);
  } catch(error) {view.body.replaceChildren(el('p',error instanceof Error?error.message:'读取失败'),button('重试',()=>{view.close();return previewTopic(url);}));}
}
export async function showReading() {
  const view=modal('稍后阅读');
  async function render() {
    const state=await getState();if(!view.host.isConnected)return;view.body.replaceChildren();
    if(!state.reading.length){view.body.append(el('p','还没有保存的主题。在主题列表或正文旁点击「稍后阅读」。','muted'));return;}
    for(const item of state.reading) {
      const row=el('div','',`reading-row${item.read?' read':''}`);const link=el('a',item.title);link.href=item.url;link.target='_blank';link.rel='noopener';link.addEventListener('click',()=>{markRead(item.id,true).catch(e=>toast(String(e),true));});
      const actions=el('div','','actions');actions.append(button(item.read?'标为未读':'标为已读',async()=>{await markRead(item.id,!item.read);await render();}),button('移除',async()=>{await removeReading(item.id);await render();}));row.append(link,actions);view.body.append(row);
    }
  }
  await render();
}
