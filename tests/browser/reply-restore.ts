import { enhanceReplies } from '../../src/features/replies';
import { defaults } from '../../src/shared/settings';

const root = document.querySelector('#restore-replies')!;
for (const [index, author] of ['alpha', 'beta', 'gamma'].entries()) {
  const row = document.createElement('div');
  row.id = `native-${index + 1}`;
  row.className = 'reply-item';
  row.innerHTML = `<a href="#"><img class="avatar" src="./preview-fixture.svg" alt="本地测试头像"></a><div class="main"><div class="meta"><a class="reply-username" href="/u/${author}">${author}</a><span class="floor" title="原楼层">#${index + 1}</span><a class="J_replyVote" href="#reply_id=${index + 1}" data-count="${index}">赞 ${index}</a><a class="J_replyTo" href="#native-action">原生回复</a></div><span class="content">${index === 1 ? '<a href="/u/alpha">@alpha</a> #1 这是一条嵌套回复。' : '本地测试正文，用于确认节点及草稿保留。'}</span></div>`;
  root.append(row);
}
const rows = [...root.querySelectorAll<HTMLElement>('.reply-item')];
const result = document.querySelector('#native-result')!;
rows.forEach(row => {
  row.querySelector<HTMLElement>('.floor')!.onclick = () => { result.textContent = '原生楼层点击已响应'; };
  row.querySelector<HTMLElement>('.J_replyTo')!.onclick = event => { event.preventDefault(); result.textContent = '原生回复入口已响应'; };
});
const controller = enhanceReplies({ ...defaults, preload: false });
const status = document.querySelector('#restore-status')!;
status.textContent = '增强已启用';
document.querySelector('#restore-disable')!.addEventListener('click', () => {
  document.documentElement.classList.add('gzk-disabled');
  delete document.documentElement.dataset.gzkTheme;
  controller.update({ ...defaults, enabled: false, preload: false });
  status.textContent = `增强已停用，原节点保留 ${rows.filter(row => root.contains(row)).length}/3`;
});
document.querySelector('#restore-enable')!.addEventListener('click', () => {
  document.documentElement.classList.remove('gzk-disabled');
  document.documentElement.dataset.gzkTheme = 'dark';
  controller.update({ ...defaults, preload: false });
  status.textContent = '增强已重新启用';
});
