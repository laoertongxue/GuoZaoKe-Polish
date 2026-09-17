import { assessQualification, calibrationInputHash, configurationFingerprint, createReplayRun, type CalibrationExecutionReceipt, type FrozenCalibrationSuite, type QualificationRecord } from './comparison';
import { hashValue } from './contracts';
import { executeRun } from './engine';
import { buildMessages } from './prompts';
import { normalizeModelConfig, type ChatMessage, type ChatResult, type ModelConfig } from './providers';
import type { AnalysisRepository, StorageArea } from './repository';
import type { RunCheckpoint, Stage } from './types';

export interface CalibrationDependencies {
  local: StorageArea;
  repo: AnalysisRepository;
  /** The trusted transport owns credentials. This module never receives or stores them. */
  invoke(config: ModelConfig, messages: ChatMessage[], signal: AbortSignal | undefined, outputLimit: number): Promise<ChatResult>;
}
export interface CalibrationRequestTrace {
  id: string; stage: Stage; inputHash: string; outputHash: string | null;
  /** Conservative compatibility flag: true means reserved and possibly sent, not confirmed billed. */
  invoked: boolean;
  startedAt: string; finishedAt: string | null;
  status: 'possibly_sent' | 'received' | 'failed' | 'cancelled' | 'interrupted';
  providerModel: string | null; errorCode: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null };
}
export interface CalibrationExecution {
  receipt: CalibrationExecutionReceipt;
  checkpoint: RunCheckpoint;
  requests: CalibrationRequestTrace[];
  state: RunCheckpoint['state'];
}
export interface CalibrationSlot {
  caseId: string; repetition: number;
  state: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused' | 'interrupted';
  receiptId: string | null; runId: string | null;
}
export interface CalibrationBatch {
  id: string; suiteHash: string; configurationHash: string; methodVersion: string;
  configuration: ModelConfig; createdAt: string; updatedAt: string;
  state: 'ready' | 'running' | 'paused' | 'completed';
  maxCalls: number; callsUsed: number; slots: CalibrationSlot[]; qualificationId: string | null;
}
export interface CalibrationBatchStep { batch: CalibrationBatch; execution: CalibrationExecution | null }
type StoredExecution = CalibrationExecution & { version: 1 };
const INDEX = 'gzk:analysis:calibration:receipts:v1';
const QUALIFICATIONS = 'gzk:analysis:calibration:qualifications:v1';
const BATCHES = 'gzk:analysis:calibration:batches:v1';
const entryKey = (id: string) => `gzk:analysis:calibration:receipt:v1:${id}`;
const qualificationKey = (id: string) => `gzk:analysis:calibration:qualification:v1:${id}`;
const batchKey = (id: string) => `gzk:analysis:calibration:batch:v1:${id}`;
const identifier = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const safeCodes = new Set(['unauthorized', 'rate_limited', 'http_error', 'network', 'timeout', 'cancelled', 'too_large', 'invalid_json', 'schema', 'invalid_config', 'invalid_key', 'invalid_request', 'missing_key', 'permission_required', 'budget_exhausted', 'coverage', 'ownership', 'span', 'reference', 'unread_evidence', 'source_attribution', 'dimension', 'stage_schema', 'input_too_large', 'context', 'qualification', 'stage_failed', 'storage_write', 'storage_read', 'storage_corrupt', 'execution_failed', 'provider_model_drift']);
function errorCode(error: unknown): string {
  if (object(error) && typeof error.code === 'string' && safeCodes.has(error.code)) return error.code;
  if (error instanceof Error) { const token = error.message.split(/[: ]/, 1)[0]!; if (safeCodes.has(token)) return token; }
  return 'execution_failed';
}
/** Fixed codes only: never preserve a provider response body or an exception's arbitrary message. */
export class CalibrationError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'CalibrationError'; }
}
function cancellation<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new CalibrationError('cancelled'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(new CalibrationError('cancelled')); };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { if (signal?.aborted) throw new CalibrationError('cancelled'); return work(); }).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/**
 * Instantiate in the trusted extension background, with code-owned frozen suites.
 * No method accepts a completed receipt, a model response or a qualification from UI/import.
 * The ledger prevents report-import forgery; it does not resist local filesystem tampering.
 */
export class CalibrationService {
  private busy = false;
  private activeBatchId: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private transitions: Promise<unknown> = Promise.resolve();
  constructor(private readonly dependencies: CalibrationDependencies) {}
  private write<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task); this.queue = result.catch(() => {}); return result;
  }
  /** Recovery reads may write. Serialize them with the decision to start a slot,
   * separately from storage writes so recovery can persist without a nested lock. */
  private transition<T>(task: () => Promise<T>): Promise<T> {
    const result = this.transitions.then(task, task); this.transitions = result.catch(() => {}); return result;
  }
  private async get(key: string): Promise<unknown> {
    try { return (await this.dependencies.local.get(key))[key]; } catch { throw new CalibrationError('storage_read'); }
  }
  private async index(key: string): Promise<string[]> {
    const value = await this.get(key);
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every(identifier) || new Set(value).size !== value.length) throw new CalibrationError('storage_corrupt');
    return value;
  }
  private async set(items: Record<string, unknown>): Promise<void> {
    if (JSON.stringify(items).length > 7_000_000) throw new CalibrationError('storage_write');
    try { await this.dependencies.local.set(structuredClone(items)); } catch { throw new CalibrationError('storage_write'); }
  }
  private persist(entry: StoredExecution, register = false, batch?: CalibrationBatch): Promise<void> {
    if (batch) batch.updatedAt = new Date().toISOString();
    const copy = structuredClone(entry); const batchCopy = batch ? structuredClone(batch) : null;
    return this.write(async () => {
      const values: Record<string, unknown> = { [entryKey(copy.receipt.id)]: copy };
      if (batchCopy) { batchCopy.updatedAt = new Date().toISOString(); values[batchKey(batchCopy.id)] = batchCopy; }
      if (register) { const ids = await this.index(INDEX); if (!ids.includes(copy.receipt.id)) ids.push(copy.receipt.id); values[INDEX] = ids; }
      await this.set(values);
    });
  }
  private persistBatch(batch: CalibrationBatch, register = false): Promise<void> {
    batch.updatedAt = new Date().toISOString();
    const copy = structuredClone(batch); copy.updatedAt = new Date().toISOString();
    return this.write(async () => {
      const values: Record<string, unknown> = { [batchKey(copy.id)]: copy };
      if (register) { const ids = await this.index(BATCHES); ids.push(copy.id); values[BATCHES] = ids; }
      await this.set(values);
    });
  }
  private async validateSuite(suite: FrozenCalibrationSuite, config: ModelConfig): Promise<void> {
    try {
      // The assessor validates the same closed references, thresholds and frozen suite hash.
      // An empty receipt list does not execute a model or create a qualification record.
      await assessQualification(suite, config, [], async () => null);
      if (!Number.isFinite(Date.parse(suite.frozenAt)) || Date.parse(suite.frozenAt) > Date.now()) throw new Error('future_suite');
    } catch { throw new CalibrationError('invalid_suite'); }
  }

  private batchState(batch: CalibrationBatch): CalibrationBatch['state'] {
    if (batch.slots.some(slot => slot.state === 'running')) return 'running';
    if (!batch.slots.some(slot => slot.state === 'pending')) return 'completed';
    return batch.callsUsed >= batch.maxCalls ? 'paused' : 'ready';
  }
  async createBatch(inputSuite: FrozenCalibrationSuite, inputConfig: ModelConfig, maxCalls: number): Promise<CalibrationBatch> {
    const suite = structuredClone(inputSuite); const config = normalizeModelConfig(inputConfig);
    if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 500) throw new CalibrationError('invalid_budget');
    await this.validateSuite(suite, config);
    const now = new Date().toISOString();
    const batch: CalibrationBatch = {
      id: crypto.randomUUID(), suiteHash: suite.hash, configurationHash: await configurationFingerprint(config), methodVersion: suite.methodVersion,
      configuration: config, createdAt: now, updatedAt: now, state: 'ready', maxCalls, callsUsed: 0,
      slots: suite.cases.flatMap(item => Array.from({ length: suite.thresholds.repetitions }, (_, index): CalibrationSlot => ({ caseId: item.id, repetition: index + 1, state: 'pending', receiptId: null, runId: null }))), qualificationId: null,
    };
    await this.persistBatch(batch, true); return structuredClone(batch);
  }
  readBatch(id: string): Promise<CalibrationBatch | null> {
    return this.transition(() => this.readBatchWithinTransition(id));
  }
  private async readBatchWithinTransition(id: string): Promise<CalibrationBatch | null> {
    // Capture before awaiting storage. An active execution may finish while a
    // status read is pending; its old running snapshot must remain read-only.
    const activeAtReadStart = this.activeBatchId === id;
    if (!identifier(id) || !(await this.index(BATCHES)).includes(id)) return null;
    const raw = await this.get(batchKey(id));
    if (!object(raw) || raw.id !== id || typeof raw.suiteHash !== 'string' || typeof raw.configurationHash !== 'string' || typeof raw.methodVersion !== 'string' || typeof raw.createdAt !== 'string' || typeof raw.updatedAt !== 'string' || !['ready', 'running', 'paused', 'completed'].includes(raw.state as string) || !Number.isSafeInteger(raw.maxCalls) || (raw.maxCalls as number) < 1 || (raw.maxCalls as number) > 500 || !Number.isSafeInteger(raw.callsUsed) || (raw.callsUsed as number) < 0 || (raw.callsUsed as number) > (raw.maxCalls as number) || !Array.isArray(raw.slots) || !raw.slots.length || (raw.qualificationId !== null && !identifier(raw.qualificationId))) throw new CalibrationError('storage_corrupt');
    let config: ModelConfig;
    try { config = normalizeModelConfig(raw.configuration as ModelConfig); } catch { throw new CalibrationError('storage_corrupt'); }
    if (await configurationFingerprint(config) !== raw.configurationHash) throw new CalibrationError('configuration_changed');
    const slots = raw.slots.map((value): CalibrationSlot => {
      if (!object(value) || typeof value.caseId !== 'string' || !Number.isSafeInteger(value.repetition) || (value.repetition as number) < 1 || !['pending', 'running', 'completed', 'failed', 'cancelled', 'paused', 'interrupted'].includes(value.state as string) || (value.receiptId !== null && !identifier(value.receiptId)) || (value.runId !== null && !identifier(value.runId))) throw new CalibrationError('storage_corrupt');
      return { caseId: value.caseId, repetition: value.repetition as number, state: value.state as CalibrationSlot['state'], receiptId: value.receiptId as string | null, runId: value.runId as string | null };
    });
    if (new Set(slots.map(slot => `${slot.caseId}:${slot.repetition}`)).size !== slots.length) throw new CalibrationError('storage_corrupt');
    const batch: CalibrationBatch = { id, suiteHash: raw.suiteHash, configurationHash: raw.configurationHash, methodVersion: raw.methodVersion, configuration: config, createdAt: raw.createdAt, updatedAt: raw.updatedAt, state: raw.state as CalibrationBatch['state'], maxCalls: raw.maxCalls as number, callsUsed: raw.callsUsed as number, slots, qualificationId: raw.qualificationId as string | null };
    if (!activeAtReadStart && slots.some(slot => slot.state === 'running')) {
      for (const slot of slots.filter(slot => slot.state === 'running')) {
        const execution = slot.receiptId ? await this.readExecution(slot.receiptId) : null;
        if (execution?.receipt.status === 'completed' && execution.state === 'completed') slot.state = 'completed';
        else {
          slot.state = 'interrupted';
          if (execution) {
            execution.state = 'failed'; execution.checkpoint.state = 'failed';
            execution.receipt.status = 'failed'; execution.receipt.errorCode = 'interrupted';
            execution.receipt.output = null; execution.receipt.outputHash = null; execution.receipt.finishedAt = new Date().toISOString();
            for (const request of execution.requests) if (request.status === 'possibly_sent') { request.status = 'interrupted'; request.errorCode = 'interrupted'; request.finishedAt = execution.receipt.finishedAt; }
            // Preserve reservations and unknown usage exactly; do not replay this slot.
            batch.state = this.batchState(batch); await this.persist({ version: 1, ...execution }, false, batch);
          }
        }
      }
      batch.state = this.batchState(batch); await this.persistBatch(batch);
    }
    return structuredClone(batch);
  }
  async listBatches(suiteHash?: string, inputConfig?: ModelConfig): Promise<CalibrationBatch[]> {
    const fingerprint = inputConfig ? await configurationFingerprint(inputConfig) : null; const batches: CalibrationBatch[] = [];
    for (const id of await this.index(BATCHES)) {
      try {
        const batch=await this.readBatch(id);
        if(batch && (suiteHash===undefined || batch.suiteHash===suiteHash) && (fingerprint===null || batch.configurationHash===fingerprint))batches.push(batch);
      } catch(error) {
        // Older pipeline fingerprints remain stored, but cannot enter or block a current trial.
        if(!(error instanceof CalibrationError) || error.code!=='configuration_changed')throw error;
      }
    }
    return batches;
  }
  private async batchForSuite(inputSuite: FrozenCalibrationSuite, id: string): Promise<{ batch: CalibrationBatch; suite: FrozenCalibrationSuite }> {
    // Only called inside transition(); avoid re-entering the same serial boundary.
    const suite = structuredClone(inputSuite); const batch = await this.readBatchWithinTransition(id);
    if (!batch) throw new CalibrationError('batch_missing');
    await this.validateSuite(suite, batch.configuration);
    const expected = suite.cases.flatMap(item => Array.from({ length: suite.thresholds.repetitions }, (_, index) => [item.id, index + 1]));
    if (batch.suiteHash !== suite.hash || batch.methodVersion !== suite.methodVersion || JSON.stringify(batch.slots.map(slot => [slot.caseId, slot.repetition])) !== JSON.stringify(expected)) throw new CalibrationError('batch_mismatch');
    return { batch, suite };
  }
  async stepBatch(inputSuite: FrozenCalibrationSuite, batchId: string, signal?: AbortSignal): Promise<CalibrationBatchStep> {
    if (this.busy) throw new CalibrationError('busy');
    this.busy = true;
    try {
      const { suite, batch, slot } = await this.transition(async () => {
        const { suite, batch } = await this.batchForSuite(inputSuite, batchId);
        const slot = batch.slots.find(candidate => candidate.state === 'pending');
        // No recovery read can cross this transition with a pre-start snapshot.
        if (slot && batch.callsUsed < batch.maxCalls) this.activeBatchId = batch.id;
        return { suite, batch, slot };
      });
      if (!slot || batch.callsUsed >= batch.maxCalls) { batch.state = this.batchState(batch); return { batch, execution: null }; }
      try {
        const execution = await this.executeCase(suite, batch, slot, signal);
        return { batch: structuredClone(batch), execution };
      } catch (error) {
        slot.state = 'failed'; batch.state = this.batchState(batch); await this.persistBatch(batch);
        throw new CalibrationError(errorCode(error));
      }
    } finally { this.activeBatchId = null; this.busy = false; }
  }

  private async executeCase(inputSuite: FrozenCalibrationSuite, batch: CalibrationBatch, slot: CalibrationSlot, signal?: AbortSignal): Promise<CalibrationExecution> {
      // Copy before the first await so caller changes cannot replace frozen inputs mid-run.
      const suite = structuredClone(inputSuite); const config = normalizeModelConfig(batch.configuration);
      const maxCalls = batch.maxCalls - batch.callsUsed; const repetition = slot.repetition;
      const item = suite.cases.find(candidate => candidate.id === slot.caseId);
      if (!item) throw new CalibrationError('invalid_case');
      if (!Number.isSafeInteger(repetition) || repetition < 1 || repetition > suite.thresholds.repetitions) throw new CalibrationError('invalid_repetition');
      // Calibration does not search or fetch. Every supplied source belongs to this frozen case.
      if (item.reference.sources.length > 30) throw new CalibrationError('invalid_suite');
      const initial = await createReplayRun(item.reference, config, item.track, { maxCalls, maxInputCharacters: 4_000_000, maxSources: item.reference.sources.length, maxOutputTokens: config.maxOutputTokens });
      const startedAt = new Date().toISOString();
      const entry: StoredExecution = {
        version: 1, state: initial.state, checkpoint: initial, requests: [],
        receipt: {
          id: crypto.randomUUID(), suiteHash: suite.hash, caseId: item.id, repetition,
          configurationHash: await configurationFingerprint(config), inputHash: await calibrationInputHash(item.reference, item.track),
          outputHash: null, output: null, runId: initial.id, methodVersion: suite.methodVersion,
          startedAt, finishedAt: startedAt, status: 'failed', providerModel: null,
          transport: 'chat-completions-v1', requestIds: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0 }, errorCode: 'interrupted',
        },
      };
      slot.state = 'running'; slot.receiptId = entry.receipt.id; slot.runId = initial.id;
      batch.state = 'running'; batch.qualificationId = null;
      await this.dependencies.repo.saveJob(initial).catch(() => { throw new CalibrationError('storage_write'); });
      await this.persist(entry, true, batch);
      const updateUsage = () => {
        const invoked = entry.requests.filter(request => request.invoked);
        entry.receipt.requestIds = invoked.map(request => request.id);
        entry.receipt.usage = { calls: invoked.length, inputTokens: 0, outputTokens: 0 };
        for (const request of invoked) for (const field of ['inputTokens', 'outputTokens'] as const) {
          const value = request.usage[field]; const total = entry.receipt.usage[field];
          entry.receipt.usage[field] = total === null || value === null ? null : total + value;
        }
        entry.receipt.finishedAt = new Date().toISOString();
      };
      try {
        const completed = await executeRun(initial, {
          save: async checkpoint => {
            entry.checkpoint = structuredClone(checkpoint); entry.state = checkpoint.state;
            await this.dependencies.repo.saveJob(checkpoint).catch(() => { throw new CalibrationError('storage_write'); });
            updateUsage(); await this.persist(entry, false, batch);
          },
          acquireEvidence: async () => structuredClone(item.reference.sources).map(source => ({ ...source, data: [] })),
          call: async (stage, input, callSignal) => {
            if (callSignal?.aborted) throw new CalibrationError('cancelled');
            const messages = buildMessages(stage, input);
            if (batch.callsUsed >= batch.maxCalls) throw new CalibrationError('budget_exhausted');
            const trace: CalibrationRequestTrace = { id: crypto.randomUUID(), stage, invoked: true, inputHash: await hashValue(messages), outputHash: null, startedAt: new Date().toISOString(), finishedAt: null, status: 'possibly_sent', providerModel: null, errorCode: null, usage: { inputTokens: null, outputTokens: null } };
            entry.requests.push(trace); batch.callsUsed++; updateUsage();
            // Atomically record the whole-batch reservation, unique request and unknown
            // usage before invoking. A worker crash must never turn this attempt into zero.
            await this.persist(entry, false, batch);
            try {
              const result = await cancellation(() => this.dependencies.invoke(structuredClone(config), messages, callSignal, config.maxOutputTokens), callSignal);
              trace.outputHash = await hashValue(result.value); trace.status = 'received'; trace.providerModel = result.providerModel;
              trace.usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };
              trace.finishedAt = new Date().toISOString(); updateUsage(); await this.persist(entry, false, batch);
              return result;
            } catch (error) {
              trace.status = callSignal?.aborted ? 'cancelled' : 'failed'; trace.errorCode = trace.status === 'cancelled' ? 'cancelled' : errorCode(error);
              trace.finishedAt = new Date().toISOString(); updateUsage(); await this.persist(entry, false, batch);
              throw new CalibrationError(trace.errorCode);
            }
          },
        }, signal);
        entry.checkpoint = completed; entry.state = completed.state;
        entry.receipt.status = completed.state === 'completed' ? 'completed' : completed.state === 'cancelled' ? 'cancelled' : 'failed';
        entry.receipt.errorCode = completed.state === 'completed' ? null : completed.state === 'cancelled' ? 'cancelled' : completed.state === 'paused' ? 'budget_exhausted' : entry.requests.at(-1)?.errorCode ?? completed.errors.at(-1)?.code ?? 'execution_failed';
        if (completed.state === 'completed') {
          const providerModels = new Set(entry.requests.filter(request => request.invoked && request.providerModel !== null).map(request => request.providerModel!));
          if (providerModels.size > 1) throw new CalibrationError('provider_model_drift');
          // One unknown backend response must not be concealed by a later known alias.
          completed.package.provenance.providerModel = entry.requests.some(request => request.invoked && request.providerModel === null) ? null : [...providerModels][0] ?? null;
          entry.receipt.output = structuredClone(completed.package); entry.receipt.outputHash = await hashValue(completed.package);
          entry.receipt.providerModel = completed.package.provenance.providerModel;
        }
      } catch (error) {
        const code = errorCode(error);
        entry.state = signal?.aborted ? 'cancelled' : 'failed'; entry.checkpoint.state = entry.state;
        entry.receipt.status = signal?.aborted ? 'cancelled' : 'failed'; entry.receipt.errorCode = signal?.aborted ? 'cancelled' : code;
        entry.receipt.output = null; entry.receipt.outputHash = null;
      }
      slot.state = entry.state === 'completed' ? 'completed' : entry.state === 'cancelled' ? 'cancelled' : entry.state === 'paused' ? 'paused' : 'failed';
      batch.state = this.batchState(batch); updateUsage(); await this.persist(entry, false, batch);
      return structuredClone({ receipt: entry.receipt, checkpoint: entry.checkpoint, requests: entry.requests, state: entry.state });
  }

  async readExecution(id: string): Promise<CalibrationExecution | null> {
    if (!identifier(id) || !(await this.index(INDEX)).includes(id)) return null;
    const value = await this.get(entryKey(id));
    if (!object(value) || value.version !== 1 || !object(value.receipt) || value.receipt.id !== id || !object(value.checkpoint) || !Array.isArray(value.requests) || typeof value.state !== 'string') throw new CalibrationError('storage_corrupt');
    return structuredClone({ receipt: value.receipt, checkpoint: value.checkpoint, requests: value.requests, state: value.state }) as unknown as CalibrationExecution;
  }
  async readReceipt(id: string): Promise<CalibrationExecutionReceipt | null> { return (await this.readExecution(id))?.receipt ?? null; }
  async listReceipts(suiteHash: string, config: ModelConfig): Promise<CalibrationExecutionReceipt[]> {
    const fingerprint = await configurationFingerprint(config); const result: CalibrationExecutionReceipt[] = [];
    for (const id of await this.index(INDEX)) { const receipt = await this.readReceipt(id); if (receipt?.suiteHash === suiteHash && receipt.configurationHash === fingerprint) result.push(receipt); }
    return result;
  }
  async assessBatch(inputSuite: FrozenCalibrationSuite, batchId: string): Promise<QualificationRecord> {
    if (this.busy) throw new CalibrationError('busy');
    this.busy = true;
    try {
      const { suite, batch } = await this.transition(() => this.batchForSuite(inputSuite, batchId));
      // The caller cannot choose receipts, cases, repetitions or replacement successes.
      const ids = batch.slots.flatMap(slot => slot.receiptId ? [slot.receiptId] : []);
      const result = await assessQualification(suite, batch.configuration, ids, id => this.readReceipt(id));
      if (batch.state !== 'completed') { result.status = 'not_qualified'; result.reasons.push('batch_incomplete'); }
      await this.write(async () => {
        const storedIds = await this.index(QUALIFICATIONS); storedIds.push(result.id);
        batch.qualificationId = result.id; batch.updatedAt = new Date().toISOString();
        await this.set({ [qualificationKey(result.id)]: result, [QUALIFICATIONS]: storedIds, [batchKey(batch.id)]: batch });
      });
      return structuredClone(result);
    } finally { this.busy = false; }
  }
  async readQualification(id: string): Promise<QualificationRecord | null> {
    if (!identifier(id) || !(await this.index(QUALIFICATIONS)).includes(id)) return null;
    const value = await this.get(qualificationKey(id));
    if (!object(value) || value.id !== id || !['qualified_trial', 'not_qualified'].includes(value.status as string)) throw new CalibrationError('storage_corrupt');
    return structuredClone(value) as unknown as QualificationRecord;
  }
}

export const createCalibrationService = (dependencies: CalibrationDependencies): CalibrationService => new CalibrationService(dependencies);
