import { browser } from 'wxt/browser';
import { el, button, applyTheme } from '../../src/shared/app-ui';
import { readStoredState } from '../../src/shared/storage';
import { assertPackage, hashValue } from '../../src/analysis/contracts';
import { renderReport } from '../../src/analysis/workspace';
import '../../src/styles/analysis.css';
const root = document.getElementById('app')!;
async function main() {
  const topic = new URL(location.href).searchParams.get('topic'); if (!topic || !/^\d+$/.test(topic)) throw new Error();
  const state = await readStoredState(); applyTheme(state.settings);
  const toolbar = el('nav', 'analysis-nav'); const content = el('main', 'analysis-main'); root.replaceChildren(toolbar, content);
  toolbar.append(button('打开完整工作区', 'button primary', () => void browser.runtime.sendMessage({ type: 'analysis:open', url: `https://www.guozaoke.com/t/${topic}` })));
  const response = await browser.runtime.sendMessage({ type: 'analysis:view:get' });
  if (!response?.ok) throw new Error();
  if (!response.data) { content.textContent = '本机还没有这篇帖子的分析。请打开完整工作区，采集并开始分析。'; return; }
  assertPackage(response.data); const pkg = response.data;
  const result=await browser.runtime.sendMessage({type:'analysis:report:qualification',packageId:pkg.id,packageHash:await hashValue(pkg)}).catch(()=>null);
  const qualification=result?.ok?result.data:undefined;
  for (const [name, view] of [['概览', 'overview'], ['证据', 'evidence'], ['回复', 'replies']] as const) toolbar.append(button(name, 'button', () => renderReport(content, pkg, view, qualification)));
  renderReport(content, pkg, 'overview', qualification);
}
main().catch(() => { root.textContent = '本帖分析暂未加载，请打开完整工作区查看。'; });
