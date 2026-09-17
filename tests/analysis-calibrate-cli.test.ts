// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildTrialSuite } from '../src/analysis/calibration-suite';
import { importPackage } from '../src/analysis/contracts';

const temporary: string[] = [];
const source = resolve('scripts/analysis-calibrate.ts');
const secret = 'CLI_ONLY_SECRET_74ae_"\\_DO_NOT_PERSIST';
const config = { id: 'one', name: 'Mock model', baseUrl: 'https://api.example.org/v1', model: 'mock-model', temperature: 0, maxOutputTokens: 4096, declaredVersion: 'mock-v1', keyEnv: 'GZK_ANALYSIS_KEY_ONE' };
async function fixture(configurations: unknown[] = [config]) {
  const directory = await mkdtemp(join(tmpdir(), 'gzk-calibrate-cli-')); temporary.push(directory);
  const path = join(directory, 'config.json');
  await writeFile(path, JSON.stringify({ version: 1, configurations }));
  return { directory, path };
}
async function cli() {
  expect(existsSync(source), 'the production calibration CLI module exists').toBe(true);
  return (await import('../scripts/analysis-calibrate.ts')).runCalibrationCli;
}
async function artifacts(directory: string) {
  const root = join(directory, 'artifacts/analysis-calibration');
  const entries = await readdir(root);
  expect(entries).toHaveLength(1);
  const run = join(root, entries[0]!);
  const names = await readdir(run);
  const files = await Promise.all(names.map(async name => ({ name, text: await readFile(join(run, name), 'utf8'), mode: (await stat(join(run, name))).mode & 0o777 })));
  return { run, files, checkpoint: JSON.parse(files.find(f => f.name === 'checkpoint.json')!.text), report: JSON.parse(files.find(f => f.name === 'report.json')!.text) };
}
const completion = (value: unknown, model = 'mock-model') => new Response(JSON.stringify({ model, choices: [{ message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8 } }), { status: 200 });
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('calibration CLI, real service with injected HTTP transport', () => {
  it('previews the frozen suite and total budget without accessing credentials, network or disk writes', async () => {
    const run = await cli(); const { directory, path } = await fixture();
    const writeOutput = vi.fn(); const readEnvironment = vi.fn(() => { throw new Error(secret); }); const transport = vi.fn();
    expect(await run(['--config', path, '--max-calls', '7'], { projectDirectory: directory, writeOutput, readEnvironment, fetch: transport })).toBe(0);
    expect(readEnvironment).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual(['config.json']);
    const preview = JSON.parse(writeOutput.mock.calls[0]![0]); const suite = await buildTrialSuite();
    expect(preview).toMatchObject({ mode: 'preview', trustedForExtension: false, budget: { maxCallsTotal: 7 }, suite: { hash: suite.hash, caseCount: 21, repetitions: 3, runsPerConfiguration: 63 } });
  });

  it.each([
    ['--max-calls', '501'], ['--max-calls', '0'], ['--max-calls', '1.5'], ['--max-calls', '-1'],
    ['--key', secret], ['--api-key', secret], ['--execute', '--execute'], ['--output', '/tmp/leak'],
  ])('rejects unsafe or ambiguous command arguments %j', async (...extra) => {
    const run = await cli(); const { directory, path } = await fixture(); const writeOutput = vi.fn(); const readEnvironment = vi.fn(); const transport = vi.fn();
    expect(await run(['--config', path, ...extra], { projectDirectory: directory, writeOutput, readEnvironment, fetch: transport })).toBe(1);
    expect(JSON.stringify(writeOutput.mock.calls)).not.toContain('CLI_ONLY_SECRET');
    expect(readEnvironment).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled(); expect(await readdir(directory)).toEqual(['config.json']);
  });

  it.each([
    { ...config, key: secret }, { ...config, apiKey: secret }, { ...config, keyEnv: 'OPENAI_API_KEY' },
    { ...config, keyEnv: 'GZK_ANALYSIS_KEY_ONE\nOTHER' }, { ...config, keyEnv: 'GZK_ANALYSIS_KEY_' },
    { ...config, baseUrl: 'https://api.example.org/v1?key=hidden' }, { ...config, maxOutputTokens: 127 },
  ])('rejects secret-bearing or invalid configuration before environment access', async entry => {
    const run = await cli(); const { directory, path } = await fixture([entry]); const writeOutput = vi.fn(); const readEnvironment = vi.fn();
    expect(await run(['--config', path, '--execute'], { projectDirectory: directory, writeOutput, readEnvironment })).toBe(1);
    expect(readEnvironment).not.toHaveBeenCalled(); expect(JSON.stringify(writeOutput.mock.calls)).not.toContain('CLI_ONLY_SECRET'); expect(await readdir(directory)).toEqual(['config.json']);
  });

  it('requires all specified credentials before creating output or making a call', async () => {
    const run = await cli(); const { directory, path } = await fixture([config, { ...config, id: 'two', keyEnv: 'GZK_ANALYSIS_KEY_TWO' }]);
    const writeOutput = vi.fn(); const readEnvironment = vi.fn(name => name === config.keyEnv ? secret : undefined); const transport = vi.fn();
    expect(await run(['--config', path, '--execute'], { projectDirectory: directory, writeOutput, readEnvironment, fetch: transport })).toBe(1);
    expect(transport).not.toHaveBeenCalled(); expect(await readdir(directory)).toEqual(['config.json']); expect(JSON.stringify(writeOutput.mock.calls)).not.toContain('CLI_ONLY_SECRET');
  });

  it('persists the reservation before HTTP, retains failures and caps the entire command across configurations', async () => {
    const run = await cli(); const { directory, path } = await fixture([config, { ...config, id: 'two', keyEnv: 'GZK_ANALYSIS_KEY_TWO' }]); const writeOutput = vi.fn();
    let callCount = 0;
    const transport = vi.fn(async (_url, init) => {
      callCount++;
      const saved = await artifactsWithoutReport(directory);
      expect(saved.budget.maxCallsTotal).toBe(64);
      expect(saved.budget.callsReserved).toBe(callCount);
      expect(JSON.stringify(saved)).toContain('possibly_sent');
      expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${secret}`);
      if (callCount === 1) throw new Error(`remote failure ${secret}`);
      return completion({ wrongShape: true });
    });
    expect(await run(['--config', path, '--max-calls', '64', '--execute'], { projectDirectory: directory, writeOutput, readEnvironment: () => secret, fetch: transport })).toBe(2);
    expect(transport).toHaveBeenCalledTimes(64);
    const saved = await artifacts(directory);
    expect(saved.report.budget).toMatchObject({ maxCallsTotal: 64, callsReserved: 64 });
    expect(saved.report.results.map((r: any) => r.batch.slots.length)).toEqual([63, 63]);
    expect(saved.report.results.map((r: any) => r.batch.callsUsed)).toEqual([63, 1]);
    expect(saved.report.results[0].assessment.failures).toHaveLength(63);
    expect(saved.report.results[0].assessment.status).toBe('not_qualified');
    expect(saved.report.results[1].batch.state).toBe('paused');
    expect(saved.checkpoint).toMatchObject({ artifactType: 'gzk-analysis-calibration-cli-checkpoint', trustedForExtension: false });
    for (const file of saved.files) { expect(file.mode).toBe(0o600); expect(file.text).not.toContain('CLI_ONLY_SECRET'); expect(file.name).not.toMatch(/tmp/); }
    expect(JSON.stringify(writeOutput.mock.calls)).not.toContain('CLI_ONLY_SECRET');
    await expect(importPackage(JSON.stringify(saved.report))).rejects.toThrow();
    await expect(importPackage(JSON.stringify(saved.checkpoint))).rejects.toThrow();
  }, 60_000);

  it.each(['budget', 'cancelled'] as const)('predeclares every configuration matrix before HTTP and retains unstarted %s slots', async stop => {
    const run = await cli(); const { directory, path } = await fixture([config, { ...config, id: 'two', keyEnv: 'GZK_ANALYSIS_KEY_TWO' }]);
    const controller = new AbortController(); const writeOutput = vi.fn(); const beforeHttp: Awaited<ReturnType<typeof artifacts>>[] = [];
    const transport = vi.fn(async () => {
      beforeHttp.push(await artifacts(directory));
      if (stop === 'cancelled') controller.abort();
      throw new Error(secret);
    });
    expect(await run(['--config', path, '--max-calls', '1', '--execute'], { projectDirectory: directory, writeOutput, readEnvironment: () => secret, fetch: transport, signal: controller.signal })).toBe(stop === 'cancelled' ? 130 : 2);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(beforeHttp).toHaveLength(1);
    const expectedSlots = (await buildTrialSuite()).cases.flatMap(item => [1, 2, 3].map(repetition => [item.id, repetition]));
    for (const saved of [beforeHttp[0]!, await artifacts(directory)]) {
      expect(saved.report.results.map((result: any) => result.configurationId)).toEqual(['one', 'two']);
      const batches = Object.entries(saved.checkpoint.entries).filter(([key]) => key.startsWith('gzk:analysis:calibration:batch:v1:')).map(([, value]) => value) as any[];
      expect(batches).toHaveLength(2);
      for (const batch of [...batches, ...saved.report.results.map((result: any) => result.batch)]) {
        expect(batch.slots.map((slot: any) => [slot.caseId, slot.repetition])).toEqual(expectedSlots);
      }
      expect(saved.report.budget.callsReserved).toBe(1);
      expect(saved.checkpoint.budget.callsReserved).toBe(1);
      expect(saved.report.results[1].batch.slots.every((slot: any) => slot.state === 'pending' && slot.receiptId === null && slot.runId === null)).toBe(true);
    }
    expect(beforeHttp[0]!.report.results[0].state).toBe('running');
    expect(beforeHttp[0]!.report.results[0].batch.slots[0].state).toBe('running');
    expect((await artifacts(directory)).report.results[1].state).toBe(stop === 'cancelled' ? 'not_started_cancelled' : 'not_started_budget');
  });

  it('retains all configuration matrices when cancelled before the first request', async () => {
    const run = await cli(); const { directory, path } = await fixture([config, { ...config, id: 'two', keyEnv: 'GZK_ANALYSIS_KEY_TWO' }]);
    const controller = new AbortController(); controller.abort(); const transport = vi.fn();
    expect(await run(['--config', path, '--max-calls', '1', '--execute'], { projectDirectory: directory, writeOutput: vi.fn(), readEnvironment: () => secret, fetch: transport, signal: controller.signal })).toBe(130);
    expect(transport).not.toHaveBeenCalled();
    const saved = await artifacts(directory);
    expect(saved.report.results.map((result: any) => [result.state, result.batch?.slots.length])).toEqual([['not_started_cancelled', 63], ['not_started_cancelled', 63]]);
    expect(saved.checkpoint.budget.callsReserved).toBe(0);
    expect(Object.keys(saved.checkpoint.entries).filter(key => key.startsWith('gzk:analysis:calibration:batch:v1:'))).toHaveLength(2);
  });

  it('rejects a reflected credential in a successful response before it reaches the checkpoint', async () => {
    const run = await cli(); const { directory, path } = await fixture(); const writeOutput = vi.fn();
    const transport = vi.fn(async () => completion({ reflection: secret }, secret));
    expect(await run(['--config', path, '--max-calls', '1', '--execute'], { projectDirectory: directory, writeOutput, readEnvironment: () => secret, fetch: transport })).toBe(2);
    const saved = await artifacts(directory);
    expect(saved.report.budget.callsReserved).toBe(1);
    expect(saved.report.results[0].assessment.failures[0].code).toBe('execution_failed');
    const entry = Object.values(saved.checkpoint.entries).find((value: any) => value?.receipt) as any;
    expect(entry.receipt.errorCode).toBe('schema');
    for (const file of saved.files) expect(file.text).not.toContain('CLI_ONLY_SECRET');
    expect(JSON.stringify(writeOutput.mock.calls)).not.toContain('CLI_ONLY_SECRET');
  });

  it('uses the shared multi-stage pipeline and stops mid-case at the total budget', async () => {
    const run = await cli(); const { directory, path } = await fixture(); const suite = await buildTrialSuite(); const reference = suite.cases[0]!.reference;
    const writeOutput = vi.fn(); const payloads: any[] = [];
    const transport = vi.fn(async (_url, init) => {
      const body = JSON.parse(init!.body as string); const payload = JSON.parse(body.messages[1].content); payloads.push(payload);
      if ('spans' in payload) return completion({ claims: reference.claims, coverage: reference.coverage });
      if ('sources' in payload) return completion({ relations: [], data: [] });
      return completion({ questions: [] });
    });
    expect(await run(['--config', path, '--max-calls', '3', '--execute'], { projectDirectory: directory, writeOutput, readEnvironment: () => secret, fetch: transport })).toBe(2);
    expect(transport).toHaveBeenCalledTimes(3); expect(payloads[0]).toHaveProperty('spans'); expect(payloads[1]).toHaveProperty('title'); expect(payloads[2]).toHaveProperty('sources');
    const saved = await artifacts(directory); const batch = saved.report.results[0].batch;
    expect(batch.callsUsed).toBe(3); expect(batch.slots[0].state).toBe('paused'); expect(batch.slots.slice(1).every((slot: any) => slot.state === 'pending')).toBe(true);
    const entry = Object.values(saved.checkpoint.entries).find((value: any) => value?.receipt) as any;
    expect(entry.receipt.errorCode).toBe('budget_exhausted'); expect(entry.requests).toHaveLength(3);
  });

  it('keeps a valid rating response as a completed production receipt', async () => {
    const run = await cli(); const { directory, path } = await fixture(); const suite = await buildTrialSuite();
    const reference = suite.cases.find(item => item.track === 'rating')!.reference;
    const writeOutput = vi.fn(); let calls = 0;
    const transport = vi.fn(async () => ++calls <= 9 ? completion({ wrongShape: true }) : completion({ evaluations: reference.evaluations }));
    expect(await run(['--config', path, '--max-calls', '10', '--execute'], { projectDirectory: directory, writeOutput, readEnvironment: () => secret, fetch: transport })).toBe(2);
    const saved = await artifacts(directory);
    expect(saved.report.results[0].batch.slots[9].state).toBe('completed');
    const completed = Object.values(saved.checkpoint.entries).find((value: any) => value?.receipt?.status === 'completed') as any;
    expect(completed.receipt.output.evaluations).toEqual(reference.evaluations);
    expect(completed.receipt.usage).toEqual({ calls: 1, inputTokens: 12, outputTokens: 8 });
  });

  it('persists cancellation without retrying the possibly sent request', async () => {
    const run = await cli(); const { directory, path } = await fixture(); const controller = new AbortController(); const writeOutput = vi.fn();
    const transport = vi.fn(async () => { controller.abort(); throw new Error(secret); });
    expect(await run(['--config', path, '--max-calls', '2', '--execute'], { projectDirectory: directory, writeOutput, readEnvironment: () => secret, fetch: transport, signal: controller.signal })).toBe(130);
    expect(transport).toHaveBeenCalledTimes(1);
    const saved = await artifacts(directory); expect(saved.report.state).toBe('cancelled'); expect(saved.report.budget.callsReserved).toBe(1);
    expect(saved.report.results[0].batch.slots[0].state).toBe('cancelled');
    for (const file of saved.files) expect(file.text).not.toContain('CLI_ONLY_SECRET');
  });

  it('runs help through the actual mjs entry without requiring config or keys', async () => {
    await cli();
    const output = execFileSync(process.execPath, ['scripts/analysis-calibrate.mjs', '--help'], { cwd: resolve('.'), encoding: 'utf8', env: { PATH: process.env.PATH } });
    expect(output).toContain('--execute'); expect(output).toContain('--max-calls'); expect(output).toContain('GZK_ANALYSIS_KEY_');
  });
});

async function artifactsWithoutReport(directory: string) {
  const root = join(directory, 'artifacts/analysis-calibration'); const names = await readdir(root);
  return JSON.parse(await readFile(join(root, names[0]!, 'checkpoint.json'), 'utf8'));
}
