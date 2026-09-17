import {unwrapAnalysisResponse,analysisErrorCode} from '../../src/analysis/errors';
import { browser } from 'wxt/browser';
import { mountWorkspace } from '../../src/analysis/workspace';
import { AnalysisRepository } from '../../src/analysis/repository';
import { readEvidence, importEvidenceFile } from '../../src/analysis/evidence';
import { fetchDocument } from '../../src/site/client';
import { applyTheme, watchSystemTheme } from '../../src/shared/app-ui';
import { readStoredState } from '../../src/shared/storage';
import {SourceBudgetError} from '../../src/analysis/source-budget';
import '../../src/styles/analysis.css';

async function request(message: Record<string, unknown>) {
  const response = await browser.runtime.sendMessage(message);
  return unwrapAnalysisResponse(response);
}
const root = document.getElementById('app')!;
async function main() {
  const state = await readStoredState(); applyTheme(state.settings); const stopTheme = watchSystemTheme(() => state.settings);
  const params=new URL(location.href).searchParams;const topic=params.get('topic');
  const url=topic&&/^\d+$/.test(topic)?`https://www.guozaoke.com/t/${topic}`:undefined;
  const autoStart=!!(url&&params.get('launch')&&await request({type:'analysis:launch:consume',token:params.get('launch'),url}));
  let activate:(()=>Promise<void>)|undefined;
  const onLaunch=(message:any,sender:{id?:string})=>{
    if(!activate||sender.id!==browser.runtime.id||message?.type!=='analysis:panel:activate'||message.url!==url||String(message.tabId)!==params.get('panelTab'))return;
    return request({type:'analysis:launch:consume',token:message.token,url}).then(accepted=>{
      if(accepted)void activate!();
      return {analysisLaunchAccepted:accepted===true};
    });
  };
  browser.runtime.onMessage.addListener(onLaunch);
  const dispose = await mountWorkspace(root, {
    request, repo: new AnalysisRepository(browser.storage.local), loadTopic: fetchDocument,
    permissions: {
      contains: origin => browser.permissions.contains({ origins: [`${origin}/*`] }),
      request: origins => browser.permissions.request({ origins: [...new Set(origins)].map(origin => `${origin}/*`) }),
    },
    importFile: file => importEvidenceFile(file),
    readSource: (url, requestId, scope, signal) => readEvidence(url, { signal, fetch: async () => {
      const onAbort = () => { void request({ type: 'analysis:cancel', jobId: requestId }); };
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const value = await request({ type: 'analysis:source:bytes', url, requestId, scope });
        const bytes = Uint8Array.from(atob(value.base64), c => c.charCodeAt(0));
        return new Response(bytes, { headers: { 'content-type': value.contentType } });
      } catch(error) {
        const code=analysisErrorCode(error);
        if(['source_budget_exhausted','source_budget_changed','source_budget_corrupt'].includes(code))throw new SourceBudgetError(code as SourceBudgetError['code']);
        throw error;
      } finally { signal?.removeEventListener('abort', onAbort); }
    } }),
  }, topic && /^\d+$/.test(topic) ? `https://www.guozaoke.com/t/${topic}` : undefined, location.hash === '#settings' ? 'settings' : 'overview', { compact: params.get('panel') === '1',simple:params.get('advanced')!=='1',autoStart,onReady:start=>{activate=start;} });
  window.addEventListener('pagehide', () => { browser.runtime.onMessage.removeListener(onLaunch);dispose(); stopTheme(); }, { once: true });
}
main().catch(() => { root.textContent = '讨论分析未能打开。请重新加载扩展后再试。'; });
