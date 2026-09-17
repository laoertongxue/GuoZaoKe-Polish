import { assertPackage, exportPackage, importPackage } from './contracts';
import { validatePublicUrl } from './providers';
import type { AnalysisPackage, RunCheckpoint } from './types';
import {sourceBudgetKey,sourceBudgetGuardKey} from './source-budget';

export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}
const HISTORY_KEY = 'gzk:analysis:history:v1';
const JOBS_KEY = 'gzk:analysis:jobs:v1';
const KEYS_KEY = 'gzk:analysis:session-credentials:v1';
const deletedKey = (id:string) => `gzk:analysis:deleted:v1:${id}`;
const RECORD_LOCK='gzk-analysis-records-v1';
const memoryQueues=new WeakMap<StorageArea,Promise<unknown>>();
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Local non-secret history. Web Locks serialize mutations across extension pages/workers. */
export class AnalysisRepository {
  constructor(private readonly area: StorageArea) {}
  private async write<T>(task: () => Promise<T>): Promise<T> {
    if(typeof navigator!=='undefined'&&navigator.locks)return await navigator.locks.request(RECORD_LOCK,{mode:'exclusive'},task);
    // Production extension contexts must not fall back to a per-page lock.
    if(typeof location!=='undefined'&&/^(chrome|moz)-extension:$/.test(location.protocol))return Promise.reject(new Error('storage_lock_unavailable: 浏览器不支持安全的分析存储锁'));
    // Pure in-memory tests and the single-process CLI share their injected area's queue.
    const previous=memoryQueues.get(this.area)??Promise.resolve();const next=previous.then(task,task);
    memoryQueues.set(this.area,next.catch(()=>{}));return next;
  }
  private async records(key: string): Promise<Record<string, unknown>> {
    const value = (await this.area.get(key))[key]; return record(value) ? value : {};
  }
  private async persist(key: string, data: unknown) {
    if (JSON.stringify(data).length > 7_000_000) throw new Error('storage_capacity: 请先导出或删除旧分析，当前内容未保存');
    try { await this.area.set({ [key]: data }); } catch { throw new Error('storage_write: 分析保存失败，可能超出本机存储容量'); }
  }
  private async deleted(id:string):Promise<boolean>{return (await this.area.get(deletedKey(id)))[deletedKey(id)]!==undefined;}
  private async ensureWritable(id:string){if(await this.deleted(id))throw new Error('analysis_deleted: 分析已删除，请重新采集并建立新分析');}
  private async removeRecords(id:string){
    const history=await this.records(HISTORY_KEY);const jobs=await this.records(JOBS_KEY);
    delete history[id];delete jobs[id];
    await this.persist(HISTORY_KEY,history);await this.persist(JOBS_KEY,jobs);
    await this.area.remove(sourceBudgetKey(id));await this.area.remove(sourceBudgetGuardKey(id));
  }
  async savePackage(pkg: AnalysisPackage): Promise<void> {
    const serialized = await exportPackage(pkg);
    return this.write(async () => {
      await this.ensureWritable(pkg.id);
      const records = await this.records(HISTORY_KEY);
      const next = Object.assign(Object.create(null), records, { [pkg.id]: serialized });
      await this.persist(HISTORY_KEY, next);
    });
  }
  async getPackage(id: string): Promise<AnalysisPackage | null> {
    const records = await this.records(HISTORY_KEY); const value = Object.hasOwn(records, id) ? records[id] : null;
    if(await this.deleted(id))return null;
    return typeof value === 'string' ? importPackage(value) : null;
  }
  async list(): Promise<{ id: string; title: string; createdAt: string; status: AnalysisPackage['status'] }[]> {
    const records = await this.records(HISTORY_KEY);
    const items=await Promise.all(Object.values(records).map(async text => {
      if (typeof text !== 'string') throw new Error('storage_corrupt: 本地分析格式损坏');
      const pkg = await importPackage(text);
      return await this.deleted(pkg.id)?null:{ id: pkg.id, title: pkg.snapshot.title, createdAt: pkg.createdAt, status: pkg.status };
    }));
    return items.filter((item):item is NonNullable<typeof item>=>item!==null);
  }
  delete(id: string): Promise<void> {
    return this.write(async () => {
      await this.area.set({[deletedKey(id)]:true});
      await this.removeRecords(id);
    });
  }
  saveJob(job: RunCheckpoint): Promise<void> {
    // Checkpoints are internal data only, not accepted from a web page or a generic JSON import.
    assertPackage(job.package);
    const copy = structuredClone(job);
    return this.write(async () => {
      await this.ensureWritable(job.id);
      const jobs = await this.records(JOBS_KEY);
      await this.persist(JOBS_KEY, Object.assign(Object.create(null), jobs, { [job.id]: copy }));
    });
  }
  async getJob(id: string): Promise<RunCheckpoint | null> {
    const jobs = await this.records(JOBS_KEY); const job = Object.hasOwn(jobs, id) ? jobs[id] : null;
    if (await this.deleted(id)||!record(job)) return null;
    assertPackage(job.package);
    if (job.id !== id || !Array.isArray(job.requests) || !Array.isArray(job.completedStages) || !record(job.budget)) throw new Error('storage_corrupt: 任务记录损坏');
    return structuredClone(job) as unknown as RunCheckpoint;
  }
}

/** Instantiate only with chrome.storage.session. This class has no sync/local fallback. */
export class SessionCredentials {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly session: StorageArea) {}
  private async all(): Promise<Record<string, unknown>> {
    const stored = (await this.session.get(KEYS_KEY))[KEYS_KEY]; return record(stored) ? stored : {};
  }
  async set(purpose: string, origin: string, key: string): Promise<void> {
    const allowedOrigin = validatePublicUrl(origin).origin;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(purpose) || ['__proto__', 'constructor', 'prototype'].includes(purpose) || origin !== allowedOrigin || !key.trim() || key.length > 8192 || /[^\x21-\x7e]/.test(key)) throw new Error('invalid_credential');
    const action = async () => {
      const values = await this.all();
      await this.session.set({ [KEYS_KEY]: Object.assign(Object.create(null), values, { [purpose]: { origin, key } }) });
    };
    const next = this.queue.then(action, action); this.queue = next.catch(() => {}); return next;
  }
  async read(purpose: string, origin: string): Promise<string> {
    const values = await this.all(); const value = Object.hasOwn(values, purpose) ? values[purpose] : null;
    if (!record(value) || value.origin !== origin || typeof value.key !== 'string' || !value.key) throw new Error('missing_key');
    return value.key;
  }
  async has(purpose: string, origin: string): Promise<boolean> {
    try { await this.read(purpose, origin); return true; } catch { return false; }
  }
  clear(purpose?: string): Promise<void> {
    const action = async () => {
      if (purpose === undefined) { await this.session.remove(KEYS_KEY); return; }
      const values = await this.all(); delete values[purpose]; await this.session.set({ [KEYS_KEY]: values });
    };
    const next = this.queue.then(action, action); this.queue = next.catch(() => {}); return next;
  }
}
