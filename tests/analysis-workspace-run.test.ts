import { expect, it, vi } from 'vitest';
import { mountWorkspace } from '../src/analysis/workspace';
import { AnalysisRepository } from '../src/analysis/repository';
import { createRun } from '../src/analysis/engine';
import { splitSpans } from '../src/analysis/snapshot';
import { examplePackage, questionDrafts } from './fixtures/analysis/package';

const config = { id: 'local', name: '测试配置', baseUrl: 'https://api.example.org/v1', model: 'example', temperature: 0, maxOutputTokens: 4096, declaredVersion: '' };
const findButton = (root: HTMLElement, name: string) => [...root.querySelectorAll('button')].find(button => button.textContent === name)!;

async function runningWorkspace() {
  const values: Record<string, unknown> = {};
  const repo = new AnalysisRepository({ get: async key => ({ [key]: values[key] }), set: async next => { Object.assign(values, next); }, remove: async key => { delete values[key]; } });
  const pkg = examplePackage();
  const job = createRun(pkg.snapshot, config);
  job.package.sources = pkg.sources;
  await repo.saveJob(job); await repo.savePackage(job.package);
  let releasePlan!: () => void;
  let rejectPlan!: (error: Error) => void;
  let held = false;
  const request = vi.fn(async (message: any): Promise<any> => {
    if (message.type === 'analysis:config:get') return { configs: [{ ...config, hasKey: true }], hasSearchKey: false };
    if (message.type === 'analysis:run:prepare') return repo.getJob(message.jobId);
    if (message.type === 'analysis:cancel') { rejectPlan?.(new Error('cancelled')); return true; }
    if (message.type !== 'analysis:call') return null;
    if (message.stage === 'plan' && !held) {
      held = true;
      await new Promise<void>((resolve, reject) => { releasePlan = resolve; rejectPlan = reject; });
    }
    const value = message.stage === 'claims' ? {
      claims: pkg.claims,
      coverage: pkg.snapshot.messages.flatMap(m => splitSpans(m).map(span => ({ span, claimIds: m.kind === 'reply' ? ['C01'] : [], disposition: m.kind === 'reply' ? 'claim' : 'non_assertive', reason: m.kind === 'reply' ? '提出费用事实' : '提问' }))),
    } : message.stage === 'plan' ? { questions: questionDrafts() }
      : message.stage === 'relations' ? { relations: pkg.relations, data: [] }
        : { evaluations: pkg.evaluations };
    return { value, usage: { inputTokens: 10, outputTokens: 10 }, providerModel: 'example' };
  });
  const root = document.createElement('div'); document.body.append(root);
  const dispose = await mountWorkspace(root, { repo, request, loadTopic: vi.fn(), permissions: { contains: async () => true, request: async () => true } }, undefined, 'history');
  await vi.waitFor(() => expect(findButton(root, '打开')).toBeDefined()); findButton(root, '打开').click();
  await vi.waitFor(() => expect(findButton(root, '开始分析')).toBeDefined());
  const consent = root.querySelector<HTMLInputElement>('#analysis-consent')!;
  consent.checked = true; consent.dispatchEvent(new Event('change'));
  findButton(root, '开始分析').click();
  await vi.waitFor(() => expect(request.mock.calls.some(([message]) => message.type === 'analysis:call' && message.stage === 'plan')).toBe(true));
  return { root, repo, request, jobId: job.id, releasePlan: () => releasePlan(), cleanup: () => { dispose(); root.remove(); } };
}

it('shows saved claims before the next model step returns', async () => {
  const flow = await runningWorkspace();
  try {
    expect((await flow.repo.getJob(flow.jobId))?.package.claims).toHaveLength(1);
    expect(flow.root.querySelectorAll('.analysis-counts strong')[1]?.textContent).toBe('1');
    expect(flow.root.querySelector('[aria-label="本轮分析进度"]')?.textContent).toContain('建立核查问题');
    expect(flow.root.textContent).toContain('已保存 1 项主张');
    expect(flow.root.querySelector('.analysis-report-heading')?.textContent).toContain('部分完成');
  } finally {
    flow.releasePlan();
    await vi.waitFor(async () => expect((await flow.repo.getJob(flow.jobId))?.state).toBe('completed'));
    flow.cleanup();
  }
});

it('keeps an open excerpt and keyboard focus when the run finishes, until the reader refreshes', async () => {
  const flow = await runningWorkspace();
  try {
    findButton(flow.root, '主张与证据').click();
    const summary = [...flow.root.querySelectorAll('summary')].find(item => item.textContent === '核对主张摘录')!;
    const details = summary.parentElement as HTMLDetailsElement;
    details.open = true; summary.tabIndex = 0; summary.focus();
    expect(document.activeElement).toBe(summary);
    flow.releasePlan();
    await vi.waitFor(async () => expect((await flow.repo.getJob(flow.jobId))?.state).toBe('completed'));
    await vi.waitFor(() => expect(findButton(flow.root, '取消分析').disabled).toBe(true));
    expect(summary.isConnected).toBe(true);
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(summary);
    expect(flow.root.querySelector('.analysis-report-heading')?.textContent).toContain('部分完成');
    findButton(flow.root, '查看已保存结果').click();
    expect(flow.root.querySelector('.analysis-report-heading')?.textContent).toContain('本轮完成');
  } finally { flow.cleanup(); }
});

it('does not replace a focused excerpt when delayed qualification arrives', async () => {
  const values: Record<string, unknown> = {};
  const repo = new AnalysisRepository({ get: async key => ({ [key]: values[key] }), set: async next => { Object.assign(values, next); }, remove: async key => { delete values[key]; } });
  await repo.savePackage(examplePackage());
  const pending: (() => void)[] = [];
  const root = document.createElement('div'); document.body.append(root);
  const request = async (message: Record<string, unknown>) => {
    if (message.type === 'analysis:config:get') return { configs: [], hasSearchKey: false };
    if (message.type === 'analysis:report:qualification') return new Promise(resolve => pending.push(() => resolve(null)));
    return null;
  };
  const dispose = await mountWorkspace(root, { repo, request, loadTopic: vi.fn(), permissions: { contains: async () => false, request: async () => false } }, undefined, 'history');
  try {
    await vi.waitFor(() => expect(findButton(root, '打开')).toBeDefined()); findButton(root, '打开').click();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    findButton(root, '主张与证据').click();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    const summary = [...root.querySelectorAll('summary')].find(item => item.textContent === '核对主张摘录')!;
    const details = summary.parentElement as HTMLDetailsElement;
    details.open = true; summary.tabIndex = 0; summary.focus();
    pending.forEach(resolve => resolve());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(summary.isConnected).toBe(true);
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(summary);
  } finally { dispose(); root.remove(); }
});

it.each([1, 2])('preserves the excerpt across a %i-round replay queue and its completion', async repetitions => {
  const values: Record<string, unknown> = {};
  const repo = new AnalysisRepository({ get: async key => ({ [key]: values[key] }), set: async next => { Object.assign(values, next); }, remove: async key => { delete values[key]; } });
  await repo.savePackage(examplePackage());
  const pending: (() => void)[] = [];
  const root = document.createElement('div'); document.body.append(root);
  const request = async (message: Record<string, unknown>): Promise<any> => {
    if (message.type === 'analysis:config:get') return { configs: [{ ...config, hasKey: true }], hasSearchKey: false };
    if (message.type === 'analysis:run:prepare') return repo.getJob(String(message.jobId));
    if (message.type === 'analysis:call') {
      await new Promise<void>(resolve => pending.push(resolve));
      return { value: { evaluations: examplePackage().evaluations }, usage: { inputTokens: 10, outputTokens: 10 }, providerModel: 'example' };
    }
    return null;
  };
  const dispose = await mountWorkspace(root, { repo, request, loadTopic: vi.fn(), permissions: { contains: async () => true, request: async () => true } }, undefined, 'history');
  try {
    await vi.waitFor(() => expect(findButton(root, '打开')).toBeDefined()); findButton(root, '打开').click();
    await vi.waitFor(() => expect(root.querySelector('.analysis-report-heading')?.textContent).toContain('测试讨论'));
    findButton(root, '复跑与对比').click();
    const count = [...root.querySelectorAll('label')].find(label => label.textContent?.includes('每个配置重复次数'))!.querySelector('input')!;
    count.value = String(repetitions);
    for (const consent of root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) { consent.checked = true; consent.dispatchEvent(new Event('change')); }
    findButton(root, '执行选中的复跑队列').click();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    findButton(root, '主张与证据').click();
    const summary = [...root.querySelectorAll('summary')].find(item => item.textContent === '核对主张摘录')!;
    const details = summary.parentElement as HTMLDetailsElement;
    details.open = true; summary.tabIndex = 0; summary.focus();
    for (let i = 0; i < repetitions; i++) {
      await vi.waitFor(() => expect(pending).toHaveLength(i + 1));
      expect(summary.isConnected).toBe(true); expect(details.open).toBe(true); expect(document.activeElement).toBe(summary);
      pending[i]!();
    }
    await vi.waitFor(() => expect(root.querySelector('[role="status"]')?.textContent).toContain('复跑队列完成'));
    expect(summary.isConnected).toBe(true); expect(details.open).toBe(true); expect(document.activeElement).toBe(summary);
  } finally { dispose(); pending.forEach(resolve => resolve()); root.remove(); }
});

it('keeps cancellation available on other tabs and resumes from saved steps', async () => {
  const flow = await runningWorkspace();
  try {
    findButton(flow.root, '模型设置').click();
    const cancel = findButton(flow.root, '取消分析');
    expect(cancel, 'changing views must not hide the running job controls').toBeDefined();
    cancel.click();
    await vi.waitFor(async () => expect((await flow.repo.getJob(flow.jobId))?.state).toBe('cancelled'));
    expect(flow.root.querySelector('[aria-label="本轮分析进度"]')?.textContent).toContain('已取消');
    findButton(flow.root, '概览').click();
    await vi.waitFor(() => expect(findButton(flow.root, '继续未完成步骤')).toBeDefined());
    const consent = flow.root.querySelector<HTMLInputElement>('#analysis-consent')!;
    consent.checked = true; consent.dispatchEvent(new Event('change'));
    findButton(flow.root, '继续未完成步骤').click();
    await vi.waitFor(async () => expect((await flow.repo.getJob(flow.jobId))?.state).toBe('completed'));
    expect(flow.request.mock.calls.filter(([message]) => message.type === 'analysis:call' && message.stage === 'claims')).toHaveLength(1);
    expect((await flow.repo.getJob(flow.jobId))?.callsUsed).toBe(5);
    expect(flow.root.textContent).toContain('未配置外部检索');
    await vi.waitFor(() => expect(findButton(flow.root, '本轮已完成')).toBeDefined());
    const completedConsent = flow.root.querySelector<HTMLInputElement>('#analysis-consent')!;
    completedConsent.checked = true; completedConsent.dispatchEvent(new Event('change'));
    expect(findButton(flow.root, '本轮已完成').disabled).toBe(true);
  } finally { flow.releasePlan(); flow.cleanup(); }
});
