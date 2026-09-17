import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildTrialSuite } from '../src/analysis/calibration-suite';
import { CalibrationService, type CalibrationBatch } from '../src/analysis/calibration';
import type { QualificationRecord } from '../src/analysis/comparison';
import { chatCompletion, normalizeModelConfig, ProviderError, type ModelConfig } from '../src/analysis/providers';
import { AnalysisRepository, type StorageArea } from '../src/analysis/repository';

const HELP = `Usage: node scripts/analysis-calibrate.mjs --config <file.json> [--max-calls <1..500>] [--execute]

Default: preview only; no credential lookup, network call or file write.
--max-calls is the TOTAL command budget across all configurations (default: 100).
--execute authorizes sending the frozen synthetic suite to each configured provider.
API keys are read only from the specified GZK_ANALYSIS_KEY_* environment variables.
Never put an API key in this command or the JSON file. Unknown fields are rejected.

Config JSON (all fields required):
{"version":1,"configurations":[{"id":"model-1","name":"My model","baseUrl":"https://api.example.org/v1","model":"model-name","temperature":0,"maxOutputTokens":4096,"declaredVersion":"","keyEnv":"GZK_ANALYSIS_KEY_MODEL_1"}]}

Each configuration runs the same complete case/repetition batch in listed order.
Failed slots remain in the batch; no retry, case selection or resume is accepted.
Results/checkpoints: artifacts/analysis-calibration/<unique-run-id>/ (files 0600).
These CLI artifacts cannot grant trusted extension qualification.
Exit codes: 0 preview/help or completed trial; 1 setup/storage failure;
2 incomplete/failed trial; 130 cancelled. Trial success is not independent certification.
`;

export interface CalibrationCliDependencies {
  projectDirectory: string;
  /** Only consulted after --execute and after strict configuration validation. */
  readEnvironment?: (name: string) => string | undefined;
  /** Injection is at the actual HTTP boundary; service, engine and provider parsing stay real. */
  fetch?: typeof fetch;
  writeOutput?: (text: string) => void;
  signal?: AbortSignal;
}
type CliCode = 'invalid_arguments' | 'config_read' | 'invalid_config' | 'missing_key' | 'invalid_key' | 'secret_in_artifact' | 'storage_write' | 'execution_failed';
class CliError extends Error {
  constructor(readonly code: CliCode) { super(code); }
}
interface CliConfiguration { config: ModelConfig; keyEnv: string }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(',') === [...keys].sort().join(',');

function argumentsFor(argv: string[]) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { help: true as const };
  let configPath: string | undefined; let maxCalls = 100; let execute = false;
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (seen.has(flag)) throw new CliError('invalid_arguments');
    seen.add(flag);
    if (flag === '--execute') execute = true;
    else if (flag === '--config' || flag === '--max-calls') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new CliError('invalid_arguments');
      if (flag === '--config') configPath = value;
      else {
        if (!/^[1-9]\d{0,2}$/.test(value) || Number(value) > 500) throw new CliError('invalid_arguments');
        maxCalls = Number(value);
      }
    } else throw new CliError('invalid_arguments');
  }
  if (!configPath) throw new CliError('invalid_arguments');
  return { help: false as const, configPath, maxCalls, execute };
}
async function readConfigurations(path: string): Promise<CliConfiguration[]> {
  let raw: unknown;
  try {
    const file = await open(resolve(path), 'r');
    try {
      if (!(await file.stat()).isFile() || (await file.stat()).size > 128_000) throw new CliError('invalid_config');
      raw = JSON.parse(await file.readFile('utf8'));
    } finally { await file.close(); }
  } catch (error) { throw error instanceof CliError ? error : new CliError('config_read'); }
  if (!object(raw) || !exactKeys(raw, ['version', 'configurations']) || raw.version !== 1 || !Array.isArray(raw.configurations) || raw.configurations.length < 1 || raw.configurations.length > 20) throw new CliError('invalid_config');
  const ids = new Set<string>();
  return raw.configurations.map(value => {
    if (!object(value) || !exactKeys(value, ['id', 'name', 'baseUrl', 'model', 'temperature', 'maxOutputTokens', 'declaredVersion', 'keyEnv']) || typeof value.keyEnv !== 'string' || !/^GZK_ANALYSIS_KEY_[A-Z0-9][A-Z0-9_]{0,79}$/.test(value.keyEnv)) throw new CliError('invalid_config');
    let config: ModelConfig;
    try { config = normalizeModelConfig(value); } catch { throw new CliError('invalid_config'); }
    if (ids.has(config.id) || config.maxOutputTokens < 128) throw new CliError('invalid_config');
    ids.add(config.id);
    return { config, keyEnv: value.keyEnv };
  });
}

/** Match the raw and JSON-escaped forms, including nested serialized package strings.
 * Reject the artifact or response; redaction would invalidate its evidence hashes. */
function assertNoSecrets(value: unknown, secrets: string[]): void {
  const serialized = JSON.stringify(value);
  for (const secret of secrets) {
    let encoded = secret;
    for (let depth = 0; depth < 4; depth++) {
      if (serialized.includes(encoded)) throw new CliError('secret_in_artifact');
      encoded = JSON.stringify(encoded).slice(1, -1);
    }
  }
}
async function privateDirectory(parent: string, name: string) {
  const path = join(parent, name);
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if (!object(error) || error.code !== 'EEXIST') throw new CliError('storage_write'); }
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new CliError('storage_write');
  return path;
}
async function atomicJson(directory: string, name: string, value: unknown, secrets: string[]) {
  assertNoSecrets(value, secrets);
  const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
    await file.sync(); await file.close(); file = undefined;
    await rename(temporary, join(directory, name));
  } catch { throw new CliError('storage_write'); }
  finally { await file?.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}

/** An isolated CLI envelope, never an extension storage import or a portable AnalysisPackage. */
class CheckpointArea implements StorageArea {
  private entries: Record<string, unknown> = Object.create(null);
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string, private runId: string, private maxCalls: number, private secrets: string[]) {}
  private reserved(entries = this.entries) {
    return Object.entries(entries).reduce((sum, [key, value]) => sum + (key.startsWith('gzk:analysis:calibration:batch:v1:') && object(value) && typeof value.callsUsed === 'number' ? value.callsUsed : 0), 0);
  }
  get callsReserved() { return this.reserved(); }
  async get(key: string) {
    await this.queue;
    return { [key]: structuredClone(this.entries[key]) };
  }
  private update(change: (entries: Record<string, unknown>) => void) {
    const action = async () => {
      const next = structuredClone(this.entries); change(next);
      const callsReserved = this.reserved(next);
      if (callsReserved > this.maxCalls) throw new CliError('storage_write');
      await atomicJson(this.directory, 'checkpoint.json', {
        artifactType: 'gzk-analysis-calibration-cli-checkpoint', version: 1, trustedForExtension: false,
        runId: this.runId, updatedAt: new Date().toISOString(), budget: { maxCallsTotal: this.maxCalls, callsReserved }, entries: next,
      }, this.secrets);
      this.entries = next;
    };
    const result = this.queue.then(action, action); this.queue = result.catch(() => {}); return result;
  }
  set(items: Record<string, unknown>) { const copy = structuredClone(items); return this.update(next => { Object.assign(next, copy); }); }
  remove(key: string) { return this.update(next => { delete next[key]; }); }
}
interface CliResult {
  configurationId: string;
  state: 'pending' | 'running' | 'not_started_budget' | 'not_started_cancelled' | 'not_started_failure' | 'failed' | 'finished';
  batch: CalibrationBatch;
  assessment?: QualificationRecord;
}

export async function runCalibrationCli(argv: string[], dependencies: CalibrationCliDependencies): Promise<number> {
  const output = dependencies.writeOutput ?? (text => process.stdout.write(text));
  const secrets: string[] = []; const credentials = new Map<string, string>();
  try {
    const args = argumentsFor(argv);
    if (args.help) { output(HELP); return 0; }
    const configurations = await readConfigurations(args.configPath);
    const suite = await buildTrialSuite();
    const preview = {
      mode: 'preview', trustedForExtension: false,
      suite: { id: suite.id, hash: suite.hash, methodVersion: suite.methodVersion, frozenAt: suite.frozenAt, referenceLabel: suite.referenceLabel, caseCount: suite.cases.length, repetitions: suite.thresholds.repetitions, runsPerConfiguration: suite.cases.length * suite.thresholds.repetitions, tracks: { extraction: suite.cases.filter(c => c.track === 'extraction').length, rating: suite.cases.filter(c => c.track === 'rating').length } },
      configurations: configurations.map(({ config, keyEnv }) => ({ ...config, keyEnv })),
      budget: { maxCallsTotal: args.maxCalls, maxOutputTokensTotalUpperBound: args.maxCalls * Math.max(...configurations.map(item => item.config.maxOutputTokens)), monetaryCost: 'unknown; depends on provider pricing and actual input/output usage', allocation: 'listed order; one shared command budget; completion is not guaranteed' },
    };
    if (!args.execute) { output(JSON.stringify(preview, null, 2) + '\n'); return 0; }
    const readEnvironment = dependencies.readEnvironment ?? (name => process.env[name]);
    for (const item of configurations) {
      const key = readEnvironment(item.keyEnv);
      if (!key) throw new CliError('missing_key');
      if (key.length > 8192 || /[^\x21-\x7e]/.test(key)) throw new CliError('invalid_key');
      credentials.set(item.config.id, key); if (!secrets.includes(key)) secrets.push(key);
    }
    assertNoSecrets(preview, secrets);
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
    const artifactRoot = await privateDirectory(resolve(dependencies.projectDirectory), 'artifacts');
    const calibrationRoot = await privateDirectory(artifactRoot, 'analysis-calibration');
    const directory = join(calibrationRoot, runId);
    await mkdir(directory, { mode: 0o700 });
    const local = new CheckpointArea(directory, runId, args.maxCalls, secrets);
    let invoked = 0;
    const service = new CalibrationService({ local, repo: new AnalysisRepository(local), invoke: async (config, messages, signal, limit) => {
      // CalibrationService has already atomically persisted its reservation here.
      if (invoked >= args.maxCalls || local.callsReserved > args.maxCalls) throw new Error('budget_exhausted');
      await saveReport();
      invoked++;
      const key = credentials.get(config.id);
      if (!key) throw new Error('missing_key');
      const result = await chatCompletion({ ...config, maxOutputTokens: limit }, key, messages, { signal, fetch: dependencies.fetch });
      try { assertNoSecrets(result, secrets); } catch { throw new ProviderError('schema'); }
      return result;
    } });
    const report = {
      artifactType: 'gzk-analysis-calibration-cli-report', version: 1, trustedForExtension: false, runId,
      suite: preview.suite, configurations: preview.configurations,
      startedAt: new Date().toISOString(), finishedAt: null as string | null,
      state: 'running', errorCode: null as CliCode | null,
      budget: { ...preview.budget, callsReserved: 0 }, results: [] as CliResult[],
      limitations: ['CLI execution records do not grant extension qualification and are not accepted as report imports.', 'Candidate synthetic rule trials have no independent expert labels or formal holdout certification.', 'Reservations mean possibly sent, not confirmed billed; unknown token counts remain null.', 'No retry or resume: running this command again creates a new full batch and requires its own budget.'],
    };
    const saveReport = async () => {
      for (const result of report.results) result.batch = (await service.readBatch(result.batch.id)) ?? result.batch;
      report.budget.callsReserved = local.callsReserved;
      await atomicJson(directory, 'report.json', report, secrets);
    };
    output(JSON.stringify({ ...preview, mode: 'execute', runId }, null, 2) + '\n');
    // Declare every configuration's complete matrix before the first possible send.
    // These per-batch ceilings are additionally bounded by CheckpointArea's single
    // persisted command cap; they are never independent additive call allowances.
    for (const { config } of configurations) {
      const batch = await service.createBatch(suite, config, args.maxCalls);
      report.results.push({ configurationId: config.id, state: 'pending', batch });
    }
    await saveReport();
    try {
      for (const result of report.results) {
        if (dependencies.signal?.aborted) { result.state = 'not_started_cancelled'; await saveReport(); continue; }
        const remaining = args.maxCalls - local.callsReserved;
        if (!remaining) { result.state = 'not_started_budget'; await saveReport(); continue; }
        // Allocate only the command's unspent budget to this existing complete batch.
        // The service then uses its usual paused-state and mid-case budget behavior.
        result.batch.maxCalls = remaining;
        result.batch.updatedAt = new Date().toISOString();
        await local.set({ [`gzk:analysis:calibration:batch:v1:${result.batch.id}`]: result.batch });
        result.state = 'running';
        await saveReport();
        while (result.batch.state === 'ready' || result.batch.state === 'running') {
          if (dependencies.signal?.aborted) break;
          const step = await service.stepBatch(suite, result.batch.id, dependencies.signal);
          result.batch = step.batch;
          await saveReport();
          if (!step.execution) break;
        }
        result.assessment = await service.assessBatch(suite, result.batch.id);
        result.state = 'finished';
        await saveReport();
      }
      report.state = dependencies.signal?.aborted ? 'cancelled' : report.results.every(result => result.assessment?.status === 'qualified_trial') ? 'completed' : 'incomplete_or_failed';
    } catch (error) {
      report.state = 'failed'; report.errorCode = error instanceof CliError ? error.code : 'execution_failed';
      for (const result of report.results) {
        if (result.state === 'running') result.state = 'failed';
        else if (result.state === 'pending') result.state = 'not_started_failure';
      }
    }
    report.finishedAt = new Date().toISOString();
    await saveReport();
    output(JSON.stringify({ mode: 'result', trustedForExtension: false, runId, output: `artifacts/analysis-calibration/${runId}/`, state: report.state, budget: report.budget, configurations: report.results.map(result => ({ id: result.configurationId, state: result.state, assessment: result.assessment?.status ?? null })), errorCode: report.errorCode }, null, 2) + '\n');
    return report.state === 'cancelled' ? 130 : report.state === 'completed' ? 0 : report.state === 'failed' ? 1 : 2;
  } catch (error) {
    output(JSON.stringify({ mode: 'error', code: error instanceof CliError ? error.code : 'execution_failed' }) + '\n');
    return 1;
  } finally { credentials.clear(); secrets.length = 0; }
}
