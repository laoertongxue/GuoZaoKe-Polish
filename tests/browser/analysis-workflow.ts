import { mountWorkspace } from '../../src/analysis/workspace';
import { AnalysisRepository } from '../../src/analysis/repository';
import { splitSpans } from '../../src/analysis/snapshot';
import { examplePackage, questionDrafts } from '../fixtures/analysis/package';
import type { ThreadMessage } from '../../src/analysis/types';
import type { ModelConfig } from '../../src/analysis/providers';
import '../../src/styles/analysis.css';

// Deliberately isolated fixture storage, never extension storage or real credentials.
const simple=new URL(location.href).searchParams.get('simple')==='1';
const prefix = simple?'gzk-analysis-simple-fixture:':'gzk-analysis-workflow-fixture:';
const repo = new AnalysisRepository({
  get: async key => { const stored = localStorage.getItem(prefix + key); return { [key]: stored === null ? undefined : JSON.parse(stored) }; },
  set: async data => { for (const [key, value] of Object.entries(data)) localStorage.setItem(prefix + key, JSON.stringify(value)); },
  remove: async key => { localStorage.removeItem(prefix + key); },
});
let configs: (ModelConfig & { hasKey: boolean })[] = [{ id: 'local', name: '本地模拟 · 不联网', baseUrl: 'https://api.example.org/v1', model: 'fixture-only', temperature: 0, maxOutputTokens: 4096, declaredVersion: 'synthetic', hasKey: true }];
const counts: Record<string, number> = {};
let pending: { jobId: string; resolve(): void; reject(error: Error): void } | null = null;
const respond = document.querySelector<HTMLButtonElement>('#respond')!;
const fail = document.querySelector<HTMLButtonElement>('#fail')!;
function updateCalls() {
  document.querySelector('#calls')!.textContent = `实际 API 调用：0；模拟阶段请求：${Object.entries(counts).map(([stage, count]) => `${stage} ${count}`).join('、') || '无'}。${pending ? '等待放行或取消。' : ''}`;
  respond.disabled = fail.disabled = pending === null;
}
respond.onclick = () => { pending?.resolve(); pending = null; updateCalls(); };
fail.onclick = () => { pending?.reject(new Error('network')); pending = null; updateCalls(); };
document.querySelector<HTMLSelectElement>('#theme')!.onchange = event => { document.documentElement.dataset.theme = (event.target as HTMLSelectElement).value; };
await mountWorkspace(document.querySelector<HTMLElement>('#app')!, {
  repo,
  permissions: { contains: async () => true, request: async () => true },
  loadTopic: async url => {
    if (url !== 'https://www.guozaoke.com/t/121894') throw new Error('夹具只提供标明的合成帖子。');
    return new DOMParser().parseFromString('<div class="topic-detail"><div class="ui-header"><h3 class="title">费用讨论 · 合成流程验收</h3><div class="meta"><span class="username">owner</span></div></div><div class="ui-content">平均费用是多少？</div></div><div class="topic-reply"><div class="ui-header">共收到1条回复</div><div class="ui-content"><div class="reply-item"><div class="main"><div class="meta"><a class="reply-username">writer</a><span class="floor">#1</span><a class="J_replyVote" href="/replyVote?reply_id=123"></a></div><span class="content">😃平均每单是10元。</span></div></div></div></div>', 'text/html');
  },
  readSource: async url => {
    if (url !== 'https://example.org/report') throw new Error('夹具只提供标明的合成来源。');
    return examplePackage().sources[0]!;
  },
  request: async message => {
    if (message.type === 'analysis:config:get') return { configs, hasSearchKey: false };
    if (message.type === 'analysis:report:qualification') return null;
    if (message.type === 'analysis:config:save') {
      const config = message.config as ModelConfig;
      configs = [...configs.filter(item => item.id !== config.id), { ...config, hasKey: true }];
      return true; // Any typed key is deliberately discarded by the fixture.
    }
    if (message.type === 'analysis:config:delete') { configs = configs.filter(item => item.id !== message.configId); return true; }
    if (message.type === 'analysis:key:clear') { configs = configs.map(item => ({ ...item, hasKey: false })); return true; }
    if (message.type === 'analysis:probe') return { structure: true };
    if (message.type === 'analysis:run:prepare') return repo.getJob(String(message.jobId));
    if (message.type === 'analysis:cancel') {
      if (pending && pending.jobId === message.jobId) { pending.reject(new Error('cancelled')); pending = null; updateCalls(); }
      return true;
    }
    if (message.type !== 'analysis:call') throw new Error('该操作不在本次本地流程夹具范围内。');
    const stage = String(message.stage);
    counts[stage] = (counts[stage] || 0) + 1;
    await new Promise<void>((resolve, reject) => { pending = { jobId: String(message.jobId), resolve, reject }; updateCalls(); });
    const pkg = examplePackage();
    const value = stage === 'claims' ? {
      claims: pkg.claims,
      coverage: (message.input as { messages: ThreadMessage[] }).messages.flatMap(m => splitSpans(m).map(span => ({ span, claimIds: m.kind === 'reply' ? ['C01'] : [], disposition: m.kind === 'reply' ? 'claim' : 'non_assertive', reason: m.kind === 'reply' ? '提出费用事实' : '提问' }))),
    } : stage === 'plan' ? { questions: questionDrafts() }
      : stage === 'relations' ? { relations: simple?[]:pkg.relations, data: [] }
        : { evaluations: pkg.evaluations };
    return { value, usage: { inputTokens: 10, outputTokens: 10 }, providerModel: 'fixture-only' };
  },
}, 'https://www.guozaoke.com/t/121894', 'overview', { compact: new URL(location.href).searchParams.get('panel') === '1',simple,autoStart:simple });
