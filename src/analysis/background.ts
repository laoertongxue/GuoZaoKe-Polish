import { AnalysisRepository, SessionCredentials, type StorageArea } from './repository';
import { buildMessages } from './prompts';
import { chatCompletion, normalizeModelConfig, ProviderError, validatePublicUrl, type ChatOptions, type ChatMessage, type ChatResult, type ModelConfig } from './providers';
import { topicUrl } from '../site/urls';
import { METHOD_VERSION, type Stage, type RunCheckpoint, type ReportQualification } from './types';
import { hashValue } from './contracts';
import { CalibrationService } from './calibration';
import { buildTrialSuite } from './calibration-suite';
import { configurationFingerprint, qualificationMatches } from './comparison';
import {DEFAULT_SOURCE_BYTES,MAX_SOURCE_FILE_BYTES,SourceBudgetError,SourceReadBudget} from './source-budget';

export interface AnalysisBrowser {
  runtime: { id: string; getURL(path: string): string; sendMessage?(message:Record<string,unknown>):Promise<unknown> };
  storage: { local: StorageArea; session: StorageArea };
  permissions: { contains(permission: { origins: string[] }): Promise<boolean> };
  tabs: { create(options: { url: string }): Promise<unknown> };
  sidePanel?: { setOptions(options: { tabId: number; path: string; enabled: boolean }): Promise<unknown>; open(options: { tabId: number }): Promise<unknown> };
}
interface Dependencies {
  call?: (config: ModelConfig, key: string, messages: ChatMessage[], options?: ChatOptions) => Promise<ChatResult>;
  search?: (query: string, key: string, signal: AbortSignal) => Promise<unknown>;
  readSource?: (url: string, signal: AbortSignal, maxBytes?: number) => Promise<{ url: string; bytes: Uint8Array; contentType: string }>;
}
const CONFIG_KEY = 'gzk:analysis:configs:v1';
const DEFAULT_CONFIG_KEY = 'gzk:analysis:default-model:v1';
const LAUNCH_KEY = 'gzk:analysis:launches:v1';
const TICKETS_KEY = 'gzk:analysis:tickets:v1';
const SEARCH_ORIGIN = 'https://api.tavily.com';
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown, max = 200): string => { if (typeof value !== 'string' || !value || value.length > max) throw new Error('invalid_request'); return value; };

/** Content scripts can open a topic workspace, but never access credentials or the request proxy. */
export function createAnalysisHandler(api: AnalysisBrowser, deps: Dependencies = {}) {
  const vault = new SessionCredentials(api.storage.session); const repo = new AnalysisRepository(api.storage.local);
  const sourceBudget=new SourceReadBudget(api.storage.local);
  const pending = new Map<string, AbortController>(); let queue: Promise<unknown> = Promise.resolve();
  const calibrating = new Set<string>();
  const suite = buildTrialSuite();
  const serial = <T>(action: () => Promise<T>) => { const next = queue.then(action, action); queue = next.catch(() => {}); return next; };
  // Register before the first await so cancellation includes permission/storage preparation.
  const withPending = async <T>(id: string, action: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (pending.has(id)) throw new Error('request_in_progress');
    const controller = new AbortController(); pending.set(id, controller);
    try { return await action(controller.signal); }
    finally { if(pending.get(id)===controller)pending.delete(id); }
  };
  const checkCancelled = (signal?: AbortSignal) => { if(signal?.aborted)throw new ProviderError('cancelled'); };
  const trusted = (sender: { id?: string; url?: string }) => {
    if (sender.id !== api.runtime.id || !sender.url) return false;
    try { const url = new URL(sender.url); return ['/analysis.html', '/options.html'].some(path => `${url.protocol}//${url.host}${url.pathname}` === api.runtime.getURL(path)); } catch { return false; }
  };
  const readOnlyTopic = (sender: { id?: string; url?: string }) => {
    if (sender.id !== api.runtime.id || !sender.url) return null;
    try { const url = new URL(sender.url); const topic = url.searchParams.get('topic'); return `${url.protocol}//${url.host}${url.pathname}` === api.runtime.getURL('/analysis-view.html') && topic && /^\d+$/.test(topic) ? topicUrl(`https://www.guozaoke.com/t/${topic}`) : null; } catch { return null; }
  };
  const configs = async (): Promise<ModelConfig[]> => {
    const value = (await api.storage.local.get(CONFIG_KEY))[CONFIG_KEY];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 12) throw new Error('config_corrupt');
    return value.map(normalizeModelConfig);
  };
  const defaultConfig = async (list:ModelConfig[]) => {
    if(list.length===1)return list[0]!.id;
    const id=(await api.storage.local.get(DEFAULT_CONFIG_KEY))[DEFAULT_CONFIG_KEY];
    return list.some(c=>c.id===id)?id as string:null;
  };
  const launches = async (): Promise<{token:string;url:string;expires:number}[]> => {
    const value=(await api.storage.session.get(LAUNCH_KEY))[LAUNCH_KEY];
    return Array.isArray(value)?value.filter(v=>isRecord(v)&&typeof v.token==='string'&&typeof v.url==='string'&&typeof v.expires==='number'&&v.expires>Date.now()).slice(-20):[];
  };
  const issueLaunch = (url:string) => serial(async()=>{
    const token=crypto.randomUUID();
    await api.storage.session.set({[LAUNCH_KEY]:[...(await launches()),{token,url,expires:Date.now()+300_000}]});
    return token;
  });
  const config = async (id: unknown) => { const found = (await configs()).find(c => c.id === id); if (!found) throw new Error('missing_configuration'); return found; };
  const permission = async (origin: string) => { if (!await api.permissions.contains({ origins: [`${origin}/*`] })) throw new Error('permission_required'); };
  async function invokeFrozen(cfg: ModelConfig, input: ChatMessage[], signal?: AbortSignal, outputLimit?: number, job?: RunCheckpoint): Promise<ChatResult> {
    checkCancelled(signal);
    const origin = new URL(cfg.baseUrl).origin; await permission(origin);
    // Recheck at dispatch, serialized with configuration and qualification changes.
    // Wrap the response promise so network latency never occupies this gate.
    const dispatched = await serial(async () => {
      const live = await config(cfg.id);
      if (await configurationFingerprint(live) !== await configurationFingerprint(cfg)) throw new Error('configuration_changed');
      if (job) checkConfiguration(job, live);
      const qualification = job?.package.provenance.mode === 'standard'
        ? await runQualification(job, live) : await currentQualification(live);
      const key = await vault.read(`model-${live.id}`, origin);
      checkCancelled(signal);
      const response = (async () => {
        try { return await (deps.call ?? chatCompletion)({ ...live, maxOutputTokens: Math.min(live.maxOutputTokens, outputLimit ?? live.maxOutputTokens) }, key, input, { signal }); }
        catch (error) { if (error instanceof ProviderError) throw error; throw new Error('provider_failed'); }
      })();
      return { response, qualification };
    });
    const result = await dispatched.response;
    if (dispatched.qualification && result.providerModel !== dispatched.qualification.providerModel) {
      await serial(() => api.storage.local.set({ [invalidQualificationKey(dispatched.qualification!.configurationHash)]: Date.now() }));
      throw new Error('qualification_model_changed');
    }
    return result;
  }
  const invoke = async (id: string, input: ChatMessage[], signal?: AbortSignal, outputLimit?: number) => invokeFrozen(await config(id), input, signal, outputLimit);
  const calibration = new CalibrationService({ local: api.storage.local, repo, invoke: invokeFrozen });
  const invalidQualificationKey = (fingerprint: string) => `gzk:analysis:qualification:invalid-before:${fingerprint}`;
  async function currentQualification(cfg: ModelConfig) {
    const frozen = await suite;
    const batches = (await calibration.listBatches(frozen.hash, cfg)).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    const batch=batches[0]; const id=batch?.qualificationId; if (!id) return null;
    if (await batchInvalidated(batch)) return null;
    const record = await calibration.readQualification(id);
    return record?.providerModel && await qualificationMatches(record, cfg, frozen.methodVersion, frozen.hash) ? record : null;
  }
  async function batchInvalidated(batch: {configurationHash:string;createdAt:string}) {
    const cutoff=(await api.storage.local.get(invalidQualificationKey(batch.configurationHash)))[invalidQualificationKey(batch.configurationHash)];
    return cutoff!==undefined && (typeof cutoff!=='number' || !Number.isFinite(cutoff) || Date.parse(batch.createdAt)<=cutoff);
  }
  function checkConfiguration(job: RunCheckpoint, cfg: ModelConfig) {
    const p = job.package.provenance;
    if (job.package.methodVersion !== METHOD_VERSION || cfg.baseUrl !== p.endpoint || cfg.model !== p.model || cfg.temperature !== p.parameters.temperature || cfg.maxOutputTokens !== p.parameters.maxOutputTokens || cfg.declaredVersion !== p.declaredVersion || Math.min(cfg.maxOutputTokens,job.budget.maxOutputTokens)!==cfg.maxOutputTokens) throw new Error('configuration_changed');
  }
  async function runQualification(job: RunCheckpoint, cfg: ModelConfig) {
    if (job.package.provenance.mode !== 'standard') return null;
    const record = await currentQualification(cfg);
    if (!record || record.id !== job.package.provenance.qualificationId) throw new Error('qualification_changed');
    if (job.requests.some(r => r.stage !== 'evidence' && r.providerModel !== record.providerModel)) throw new Error('qualification_model_changed');
    return record;
  }
  async function reportQualification(id: string, expectedHash: string): Promise<ReportQualification> {
    const result: ReportQualification = { state:'unverified',qualificationId:null,assessedAt:null,referenceLabel:null,providerModel:null };
    const pkg = await repo.getPackage(id); const job = await repo.getJob(id);
    if (!pkg || !job || await hashValue(pkg)!==expectedHash || await hashValue(job.package)!==expectedHash) return result;
    if (pkg.provenance.mode!=='standard') return {...result,state:'exploratory'};
    try {
      const cfg = await config(pkg.provenance.modelConfigId); checkConfiguration(job,cfg);
      const record = await runQualification(job,cfg);
      if (!record || (job.requests.length && pkg.provenance.providerModel!==record.providerModel)) return {...result,state:'expired'};
      return {state:'qualified_trial',qualificationId:record.id,assessedAt:record.createdAt,referenceLabel:record.referenceLabel,providerModel:record.providerModel};
    } catch { return {...result,state:'expired'}; }
  }
  async function reservation(message: Record<string, unknown>) {
    const jobId = string(message.jobId); const job = await repo.getJob(jobId);
    if (!job || job.state !== 'running' || !Number.isSafeInteger(message.ticket) || message.ticket !== job.callsUsed || job.callsUsed < 1 || job.callsUsed > job.budget.maxCalls || job.inputCharactersUsed > job.budget.maxInputCharacters) throw new Error('invalid_reservation');
    const cfg = await config(job.package.provenance.modelConfigId); checkConfiguration(job,cfg);
    const qualification = await runQualification(job,cfg);
    const ticket = `${jobId}:${message.ticket}`;
    await serial(async () => {
      const stored = (await api.storage.session.get(TICKETS_KEY))[TICKETS_KEY]; const tickets = Array.isArray(stored) ? stored.filter(t => typeof t === 'string') : [];
      if (tickets.includes(ticket)) throw new Error('invalid_reservation');
      if (tickets.length >= 5000) throw new Error('session_capacity');
      await api.storage.session.set({ [TICKETS_KEY]: [...tickets, ticket] });
    });
    return { job, cfg, qualification };
  }
  return async (input: unknown, sender: { id?: string; url?: string; frameId?: number; tab?: { id?: number } }): Promise<unknown> => {
    if (!isRecord(input)) throw new Error('invalid_request');
    const message = input;
    if (message.type === 'analysis:panel:prepare' || message.type === 'analysis:panel:open') {
      // Only this extension’s top-frame content script can request a one-use launch for its own topic.
      // The native panel is analysis.html, which is NOT web-accessible or embeddable.
      let url: string;
      try {
        url = topicUrl(string(message.url, 2048));
        if (sender.id !== api.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) || sender.tab!.id! < 0 || topicUrl(sender.url || '') !== url) throw new Error();
      } catch { throw new Error('untrusted_sender'); }
      const tabId = sender.tab!.id!;
      if (message.type === 'analysis:panel:prepare') {
        if (!api.sidePanel?.open) return false;
        await api.sidePanel.setOptions({ tabId, path: `analysis.html?topic=${url.split('/').pop()}&panel=1&panelTab=${tabId}`, enabled: true });
        return true;
      }
      // No asynchronous storage reads before open(): retain the click's user gesture.
      if (api.sidePanel?.open) {
        await api.sidePanel.open({ tabId });
        if(message.start===true){
          const token=await issueLaunch(url);
          // An existing panel keeps its document and active request. Only navigate when no panel accepts the launch.
          let accepted=false;
          try{const response=await api.runtime.sendMessage?.({type:'analysis:panel:activate',token,url,tabId});accepted=isRecord(response)&&response.analysisLaunchAccepted===true;}catch{/* No live panel yet. */}
          if(!accepted)await api.sidePanel.setOptions({tabId,path:`analysis.html?topic=${url.split('/').pop()}&panel=1&panelTab=${tabId}&launch=${token}`,enabled:true});
        }
        return true;
      }
      const token=message.start===true?await issueLaunch(url):null;
      await api.tabs.create({ url: `${api.runtime.getURL('/analysis.html')}?topic=${url.split('/').pop()}${token?`&launch=${token}`:''}` });
      return true;
    }
    if (message.type === 'analysis:open') {
      if (sender.id !== api.runtime.id) throw new Error('untrusted_sender');
      const url = topicUrl(string(message.url, 2048));
      if (!trusted(sender) && readOnlyTopic(sender) !== url) {
        try { if (topicUrl(sender.url || '') !== url) throw new Error(); } catch { throw new Error('untrusted_sender'); }
      }
      if(message.start===true&&!trusted(sender)&&(sender.frameId!==0||!Number.isInteger(sender.tab?.id)||sender.tab!.id!<0))throw new Error('untrusted_sender');
      const token=message.start===true?await issueLaunch(url):null;
      await api.tabs.create({ url: `${api.runtime.getURL('/analysis.html')}?topic=${url.split('/').pop()}${token?`&launch=${token}`:''}${trusted(sender)&&message.advanced===true?'&advanced=1':''}` }); return true;
    }
    if (message.type === 'analysis:view:get') {
      const url = readOnlyTopic(sender); if (!url) throw new Error('untrusted_sender');
      const history = (await repo.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      for (const item of history) { const pkg = await repo.getPackage(item.id); if (pkg?.snapshot.url === url) return pkg; }
      return null;
    }
    if (message.type === 'analysis:report:qualification') {
      const id=string(message.packageId); const previewTopic=readOnlyTopic(sender);
      if (!trusted(sender)) {
        if (!previewTopic) throw new Error('untrusted_sender');
        const pkg=await repo.getPackage(id);
        if (!pkg || pkg.snapshot.url!==previewTopic) throw new Error('untrusted_sender');
      }
      return reportQualification(id,string(message.packageHash,64));
    }
    if (!trusted(sender)) throw new Error('untrusted_sender');
    if (message.type === 'analysis:launch:consume') return serial(async()=>{
      const token=string(message.token);const url=topicUrl(string(message.url,2048));
      const list=await launches();const launch=list.find(item=>item.token===token&&item.url===url);
      await api.storage.session.set({[LAUNCH_KEY]:list.filter(item=>item.token!==token)});
      return Boolean(launch);
    });
    if (message.type === 'analysis:run:prepare') return serial(async()=>{
      const job=await repo.getJob(string(message.jobId)); if(!job)throw new Error('missing_run');
      const cfg=await config(job.package.provenance.modelConfigId);checkConfiguration(job,cfg);
      if(job.state==='ready' && !job.callsUsed && !job.requests.length && !job.completedStages.length && !Object.keys(job.package.provenance.stageHashes).length){
        const qualification=await currentQualification(cfg);
        job.package.provenance.mode=qualification?'standard':'exploratory';
        job.package.provenance.qualificationId=qualification?.id??null;
        await repo.saveJob(job);await repo.savePackage(job.package);
      } else await runQualification(job,cfg);
      return job;
    });
    if (message.type === 'analysis:calibration:info') {
      const frozen = await suite;
      return { id: frozen.id, hash: frozen.hash, methodVersion: frozen.methodVersion, frozenAt: frozen.frozenAt,
        referenceLabel: frozen.referenceLabel, thresholds: frozen.thresholds,
        cases: frozen.cases.map(c => ({ id: c.id, track: c.track, stratum: c.stratum, title: c.reference.snapshot.title })) };
    }
    if (message.type === 'analysis:calibration:create') return serial(async () => {
      const cfg = await config(message.configId); await permission(new URL(cfg.baseUrl).origin);
      if (!await vault.has(`model-${cfg.id}`, new URL(cfg.baseUrl).origin)) throw new Error('missing_key');
      return calibration.createBatch(await suite, cfg, Number(message.maxCalls));
    });
    if (message.type === 'analysis:calibration:list') return calibration.listBatches((await suite).hash, message.configId ? await config(message.configId) : undefined);
    if (message.type === 'analysis:calibration:step') {
      const id = string(message.batchId);
      return withPending(id, async signal => {
        const batch = await calibration.readBatch(id); if (!batch) throw new Error('missing_batch');
        checkCancelled(signal);
        if (calibrating.has(batch.configuration.id)) throw new Error('request_in_progress');
        calibrating.add(batch.configuration.id);
        try { const result = await calibration.stepBatch(await suite, id, signal); return result.batch; }
        finally { calibrating.delete(batch.configuration.id); }
      });
    }
    if (message.type === 'analysis:calibration:assess') return serial(async () => {
      const id=string(message.batchId); const result=await calibration.assessBatch(await suite,id);
      const batch=await calibration.readBatch(id);
      if(batch && await batchInvalidated(batch))return {...result,status:'not_qualified',reasons:[...new Set([...result.reasons,'configuration_invalidated'])]};
      return result;
    });
    if (message.type === 'analysis:qualification:get') return currentQualification(await config(message.configId));
    if (message.type === 'analysis:config:get') {
      const list = await configs();
      return { defaultConfigId: await defaultConfig(list), configs: await Promise.all(list.map(async c => ({ ...c, hasKey: await vault.has(`model-${c.id}`, new URL(c.baseUrl).origin) }))), hasSearchKey: await vault.has('search-tavily', SEARCH_ORIGIN) };
    }
    if (message.type === 'analysis:config:default') return serial(async()=>{
      const cfg=await config(message.configId); await api.storage.local.set({[DEFAULT_CONFIG_KEY]:cfg.id});return true;
    });
    if (message.type === 'analysis:config:save') return serial(async () => {
      const next = normalizeModelConfig(message.config); const origin = new URL(next.baseUrl).origin; await permission(origin);
      if (calibrating.has(next.id)) throw new Error('configuration_in_use');
      const list = await configs(); const old = list.find(c => c.id === next.id);
      if (!old && list.length >= 12) throw new Error('configuration_limit');
      if (old && new URL(old.baseUrl).origin !== origin) await vault.clear(`model-${old.id}`);
      if (typeof message.key === 'string' && message.key) await vault.set(`model-${next.id}`, origin, message.key);
      const chosen=await defaultConfig(list);
      await api.storage.local.set({ [CONFIG_KEY]: [...list.filter(c => c.id !== next.id), next], [DEFAULT_CONFIG_KEY]: chosen || (list.length===0?next.id:null) }); return true;
    });
    if (message.type === 'analysis:config:delete') return serial(async () => {
      const id = string(message.configId); if (calibrating.has(id)) throw new Error('configuration_in_use'); await vault.clear(`model-${id}`);
      const remaining=(await configs()).filter(c=>c.id!==id);
      await api.storage.local.set({ [CONFIG_KEY]: remaining, [DEFAULT_CONFIG_KEY]:await defaultConfig(remaining) }); return true;
    });
    if (message.type === 'analysis:key:clear') return serial(async () => { await vault.clear(message.configId ? `model-${string(message.configId)}` : undefined); return true; });
    if (message.type === 'analysis:search:configure') { await permission(SEARCH_ORIGIN); await vault.set('search-tavily', SEARCH_ORIGIN, string(message.key, 8192)); return true; }
    if (message.type === 'analysis:probe') {
      const result = await invoke(string(message.configId), [{ role: 'system', content: 'Return exactly a JSON object {"ok":true,"missing":null,"items":[1,2]}. Do not call tools.' }, { role: 'user', content: '检查 JSON 输出连接。' }], undefined, 128);
      const structure = isRecord(result.value) && result.value.ok === true && result.value.missing === null && JSON.stringify(result.value.items) === '[1,2]';
      return { connected: true, structure, semanticQualified: false, usage: result.usage, providerModel: result.providerModel };
    }
    if (message.type === 'analysis:cancel') { pending.get(string(message.jobId))?.abort(); return true; }
    if (message.type === 'analysis:call') {
      if (!['claims', 'plan', 'relations', 'replies'].includes(String(message.stage))) throw new Error('invalid_stage');
      return withPending(string(message.jobId), async signal => {
      const { job, cfg } = await reservation(message);
      if (job.stage !== message.stage) throw new Error('invalid_stage');
      const messages = buildMessages(message.stage as Stage, message.input);
      if (messages.reduce((n, m) => n + m.content.length, 0) > job.inputCharactersUsed) throw new Error('invalid_reservation');
      return invokeFrozen(cfg, messages, signal, job.budget.maxOutputTokens, job);
      });
    }
    if (message.type === 'analysis:search') {
      if (!deps.search) throw new Error('retrieval_unavailable');
      return withPending(string(message.jobId), async signal => {
      await reservation(message); await permission(SEARCH_ORIGIN);
      const query = string(message.query, 500); const key = await vault.read('search-tavily', SEARCH_ORIGIN);
      checkCancelled(signal);
      try { return await deps.search!(query, key, signal); }
      catch (error) { if (error instanceof ProviderError) throw error; throw new Error('search_failed'); }
      });
    }
    if (message.type === 'analysis:source:bytes') {
      if (!deps.readSource) throw new Error('retrieval_unavailable');
      if(message.scope!=='job'&&message.scope!=='manual')throw new Error('invalid_request');
      return withPending(string(message.requestId), async signal => {
      const url = validatePublicUrl(string(message.url, 2048)); await permission(url.origin);
      checkCancelled(signal);
      const job=await repo.getJob(string(message.requestId));
      if(message.scope==='job'?(!job||job.state!=='running'||job.stage!=='evidence'):!!job)throw new Error('invalid_reservation');
      const allowance=job?await sourceBudget.reserve(job.id,job.budget.maxSourceBytes??DEFAULT_SOURCE_BYTES,job.budget.maxSources*3):null;
      // Budget storage is asynchronous too: a task deleted/changed while reserving
      // must not reach transport or silently inherit the separate manual allowance.
      if(job){const live=await repo.getJob(job.id);if(!live||live.state!=='running'||live.stage!=='evidence'||JSON.stringify(live.budget)!==JSON.stringify(job.budget))throw new Error('invalid_reservation');}
      checkCancelled(signal);
      try {
        const source = await deps.readSource!(url.href, signal,allowance?.maxBytes??MAX_SOURCE_FILE_BYTES);
        if(source.bytes.byteLength>(allowance?.maxBytes??MAX_SOURCE_FILE_BYTES))throw new ProviderError('too_large');
        checkCancelled(signal);
        if(allowance)await sourceBudget.complete(allowance,source.bytes.byteLength);
        // Chrome runtime messages use JSON serialization rather than transferable typed arrays.
        let encoded = ''; for (let i = 0; i < source.bytes.length; i += 8192) encoded += String.fromCharCode(...source.bytes.subarray(i, i + 8192));
        return { url: source.url, contentType: source.contentType, base64: btoa(encoded) };
      } catch (error) { if (error instanceof ProviderError || error instanceof SourceBudgetError) throw error; throw new Error('source_unavailable'); }
      });
    }
    throw new Error('unknown_analysis_request');
  };
}
