import { expect, it, vi } from 'vitest';
import { createAnalysisHandler } from '../src/analysis/background';
import { mountWorkspace, renderReport } from '../src/analysis/workspace';
import { AnalysisRepository } from '../src/analysis/repository';
import { createRun } from '../src/analysis/engine';
import { examplePackage } from './fixtures/analysis/package';

const topic = 'https://www.guozaoke.com/t/121894';
const config = { id: 'local', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', temperature: 0, maxOutputTokens: 4096, declaredVersion: '', hasKey: true };
const button = (root: HTMLElement, name: string) => [...root.querySelectorAll('button')].find(b => b.textContent === name);
function storage() {
  const values: Record<string, unknown> = {};
  return { get: async (key: string) => ({ [key]: structuredClone(values[key]) }), set: async (next: Record<string, unknown>) => { Object.assign(values, structuredClone(next)); }, remove: async (key: string) => { delete values[key]; } };
}
function setup() {
  const local = storage(); const session = storage();
  const api = { runtime: { id: 'ours', getURL: (path: string) => `chrome-extension://ours${path}` }, storage: { local, session }, permissions: { contains: async () => true }, tabs: { create: vi.fn(async () => ({})) }, sidePanel: { setOptions: vi.fn(async () => {}), open: vi.fn(async () => {}) } };
  return { api, handle: createAnalysisHandler(api), repo: new AnalysisRepository(local) };
}
const sender = { id: 'ours', url: topic, frameId: 0, tab: { id: 7 } };
it('opens a trusted native analysis panel bound to the clicked topic and sender tab', async () => {
  const { handle, api } = setup();
  await expect(handle({ type: 'analysis:panel:prepare', url: topic }, sender)).resolves.toBe(true);
  expect(api.sidePanel.setOptions).toHaveBeenCalledWith({ tabId: 7, path: 'analysis.html?topic=121894&panel=1', enabled: true });
  await handle({ type: 'analysis:panel:open', url: topic, tabId: 999 }, sender);
  expect(api.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });
  expect(api.tabs.create).not.toHaveBeenCalled();
  await expect(handle({ type: 'analysis:config:get' }, sender)).rejects.toThrow('untrusted_sender');
});
it.each([
  { ...sender, id: 'other' }, { ...sender, frameId: 1 }, { ...sender, tab: undefined },
  { ...sender, url: 'https://evil.example/t/121894' },
  { ...sender, url: 'chrome-extension://ours/analysis-view.html?topic=121894' },
  { ...sender, url: 'https://www.guozaoke.com/t/999' },
])('rejects panel commands from an unrelated topic, foreign sender or embedded frame: %j', async bad => {
  const { handle, api } = setup();
  await expect(handle({ type: 'analysis:panel:prepare', url: topic }, bad)).rejects.toThrow('untrusted_sender');
  await expect(handle({ type: 'analysis:panel:open', url: topic }, bad)).rejects.toThrow('untrusted_sender');
  expect(api.sidePanel.open).not.toHaveBeenCalled(); expect(api.sidePanel.setOptions).not.toHaveBeenCalled();
});
it('falls back to the same-topic full workspace when native panels are unavailable', async () => {
  const { api } = setup(); const handle = createAnalysisHandler({ ...api, sidePanel: undefined });
  await expect(handle({ type: 'analysis:panel:prepare', url: topic }, sender)).resolves.toBe(false);
  await handle({ type: 'analysis:panel:open', url: topic }, sender);
  expect(api.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://ours/analysis.html?topic=121894' });
});

function services(repo: AnalysisRepository, hasKey = true) {
  return { repo, request: vi.fn(async (message: any): Promise<any> => message.type === 'analysis:config:get' ? { configs: [{ ...config, hasKey }], hasSearchKey: false } : null),
    loadTopic: vi.fn(async () => new DOMParser().parseFromString('<div class="topic-detail"><div class="ui-header"><h3 class="title">本帖测试</h3><div class="meta"><span class="username">owner</span></div></div><div class="ui-content">一个待核的问题？</div></div><div class="topic-reply"><div class="ui-header">共收到0条回复</div></div>', 'text/html')),
    permissions: { contains: async () => true, request: async () => true } };
}
it('restores this topic report in the panel without a new capture or model call', async () => {
  const { repo } = setup(); await repo.savePackage(examplePackage());
  const unrelated = examplePackage(); unrelated.id = 'unrelated'; unrelated.createdAt = '2026-09-17T01:00:00Z'; unrelated.snapshot.topicId = '999'; unrelated.snapshot.url = 'https://www.guozaoke.com/t/999'; unrelated.snapshot.title = '另一篇'; unrelated.snapshot.pages[0]!.url = unrelated.snapshot.url; await repo.savePackage(unrelated);
  const root = document.createElement('div'); const svc = services(repo);
  const dispose = await mountWorkspace(root, svc, topic, 'overview', { compact: true });
  try {
    expect(root.textContent).toContain('平均每单是10元。'); expect(root.textContent).not.toContain('另一篇');
    expect(svc.loadTopic).not.toHaveBeenCalled(); expect(svc.request.mock.calls.some(([m]) => m.type === 'analysis:call')).toBe(false);
  } finally { dispose(); }
});
it('prepares a new topic in the panel, showing model, recipient and consent before paid calls', async () => {
  const { repo } = setup(); const root = document.createElement('div'); const svc = services(repo);
  const dispose = await mountWorkspace(root, svc, topic, 'overview', { compact: true });
  try {
    expect(svc.loadTopic).toHaveBeenCalledWith(topic); expect(root.textContent).toContain('api.deepseek.com');
    expect(root.textContent).toContain('deepseek-chat'); expect(button(root, '开始分析')?.disabled).toBe(true);
    expect(root.querySelector<HTMLInputElement>('#analysis-consent')?.checked).toBe(false);
    expect(svc.request.mock.calls.some(([m]) => m.type === 'analysis:call')).toBe(false);
  } finally { dispose(); }
});
it('explains an expired session Key before capture instead of showing an empty report', async () => {
  const { repo } = setup(); const root = document.createElement('div'); const svc = services(repo, false);
  const dispose = await mountWorkspace(root, svc, topic, 'overview', { compact: true });
  try { expect(root.textContent).toContain('本次会话'); expect(button(root, '配置模型')).toBeDefined(); expect(svc.loadTopic).not.toHaveBeenCalled(); }
  finally { dispose(); }
});
it('restores the unfinished topic checkpoint and exposes the last error without claiming completion', async () => {
  const { repo } = setup(); const root = document.createElement('div'); const svc = services(repo);
  const job = createRun(examplePackage().snapshot, config); job.state = 'failed'; job.errors = [{ stage: 'claims', code: 'network' }];
  await repo.savePackage(job.package); await repo.saveJob(job);
  const dispose = await mountWorkspace(root, svc, topic, 'overview', { compact: true });
  try { expect(root.textContent).toContain('执行失败'); expect(button(root, '继续未完成步骤')).toBeDefined(); expect(svc.loadTopic).not.toHaveBeenCalled(); }
  finally { dispose(); }
});
it('shows concrete bounded claim and reply conclusions on the overview without making another model call', () => {
  const root = document.createElement('div'); renderReport(root, examplePackage(), 'overview');
  expect(root.textContent).toContain('本帖分析结论'); expect(root.textContent).toContain('平均每单是10元。');
  expect(root.textContent).toContain('支持样本范围，不能确认总体及时期。'); expect(root.textContent).toContain('费用表');
  expect(root.textContent).toContain('原回复没有给出材料。'); expect(root.textContent).toContain('无法判断');
  expect(root.querySelector('a[href="https://example.org/report"]')).not.toBeNull();
});
it('does not invent a conclusion for a newly captured or evidence-free topic', () => {
  const root = document.createElement('div'); const pkg = examplePackage(); pkg.claims = []; pkg.relations = []; pkg.evaluations = []; pkg.sources = []; pkg.questions = []; pkg.status = 'partial';
  renderReport(root, pkg, 'overview'); expect(root.textContent).toContain('尚未产生分析结论'); expect(root.textContent).not.toContain('本轮完成');
});
it('does not start a second paid runner when this topic job is already open elsewhere', async () => {
  const { repo } = setup(); const job = createRun(examplePackage().snapshot, config); await repo.saveJob(job); await repo.savePackage(job.package);
  const root = document.createElement('div'); const svc = services(repo);
  const dispose = await mountWorkspace(root, svc, topic, 'overview', { compact: true });
  const previous = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: unknown) => unknown) => callback(null) } });
  try {
    const consent = root.querySelector<HTMLInputElement>('#analysis-consent')!; consent.checked = true; consent.dispatchEvent(new Event('change')); button(root, '开始分析')!.click();
    await vi.waitFor(() => expect(root.textContent).toContain('其他分析窗口'));
    expect(svc.request.mock.calls.some(([m]) => m.type === 'analysis:run:prepare' || m.type === 'analysis:call')).toBe(false);
  } finally { if (previous) Object.defineProperty(navigator, 'locks', previous); else Reflect.deleteProperty(navigator, 'locks'); dispose(); }
});
it('honors the edited call cap immediately, without depending on a blur/change event', async () => {
  const { repo } = setup(); const job = createRun(examplePackage().snapshot, config); await repo.saveJob(job); await repo.savePackage(job.package);
  const root = document.createElement('div'); const svc = services(repo);
  svc.request.mockImplementation(async (message: any): Promise<any> => {
    if (message.type === 'analysis:config:get') return { configs: [config], hasSearchKey: false };
    if (message.type === 'analysis:run:prepare') return repo.getJob(message.jobId);
    if (message.type === 'analysis:call') throw new Error('network');
    return null;
  });
  const dispose = await mountWorkspace(root, svc, topic, 'overview', { compact: true });
  try {
    const cap = root.querySelector<HTMLInputElement>('input[type="number"]')!; cap.value = '8'; cap.dispatchEvent(new Event('input'));
    const consent = root.querySelector<HTMLInputElement>('#analysis-consent')!; consent.checked = true; consent.dispatchEvent(new Event('change')); button(root, '开始分析')!.click();
    await vi.waitFor(() => expect(svc.request.mock.calls.some(([m]) => m.type === 'analysis:call')).toBe(true));
    await vi.waitFor(async () => expect((await repo.getJob(job.id))?.state).toBe('partial'));
    expect((await repo.getJob(job.id))?.budget.maxCalls).toBe(8);
  } finally { dispose(); }
});
it('uses the visible stored cap when reopening history, not an abandoned higher edit', async () => {
  const { repo } = setup(); const job = createRun(examplePackage().snapshot, config); await repo.saveJob(job); await repo.savePackage(job.package);
  const root = document.createElement('div'); const svc = services(repo);
  svc.request.mockImplementation(async (message: any): Promise<any> => {
    if (message.type === 'analysis:config:get') return { configs: [config], hasSearchKey: false };
    if (message.type === 'analysis:run:prepare') return repo.getJob(message.jobId);
    if (message.type === 'analysis:call') throw new Error('network');
    return null;
  });
  const dispose = await mountWorkspace(root, svc, topic, 'overview', { compact: true });
  try {
    const cap = root.querySelector<HTMLInputElement>('input[type="number"]')!; cap.value = '200'; cap.dispatchEvent(new Event('input'));
    button(root, '历史')!.click(); await vi.waitFor(() => expect(button(root, '打开')).toBeDefined()); button(root, '打开')!.click();
    await vi.waitFor(() => expect(root.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('30'));
    const consent = root.querySelector<HTMLInputElement>('#analysis-consent')!; consent.checked = true; consent.dispatchEvent(new Event('change')); button(root, '开始分析')!.click();
    await vi.waitFor(async () => expect((await repo.getJob(job.id))?.state).toBe('partial'));
    expect((await repo.getJob(job.id))?.budget.maxCalls).toBe(30);
  } finally { dispose(); }
});
