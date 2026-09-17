import type {StorageArea} from './repository';

export const DEFAULT_SOURCE_BYTES=24*1024*1024;
export const MAX_SOURCE_FILE_BYTES=8*1024*1024;
export const sourceBudgetKey=(id:string)=>`gzk:analysis:source-budget:v1:${id}`;
export const sourceBudgetGuardKey=(id:string)=>`gzk:analysis:source-budget-started:v1:${id}`;
export class SourceBudgetError extends Error {constructor(readonly code:'source_budget_exhausted'|'source_budget_changed'|'source_budget_corrupt'){super(code);}}
interface Ledger {version:1;limit:number;maxAttempts:number;chargedBytes:number;attempts:number;pending:Record<string,number>}
interface Reservation {jobId:string;id:string;maxBytes:number}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;

/** Charge the allowance before transport. Interrupted/failed reads keep their charge;
 * only a confirmed complete response can return unused bytes. This survives worker restart. */
export class SourceReadBudget {
  private queue:Promise<unknown>=Promise.resolve();
  constructor(private readonly area:StorageArea){}
  private serial<T>(action:()=>Promise<T>){const next=this.queue.then(action,action);this.queue=next.catch(()=>{});return next;}
  private async read(jobId:string):Promise<Ledger|null>{
    const value=(await this.area.get(sourceBudgetKey(jobId)))[sourceBudgetKey(jobId)];
    const guard=(await this.area.get(sourceBudgetGuardKey(jobId)))[sourceBudgetGuardKey(jobId)];
    if(value===undefined&&guard===undefined)return null;
    // The independent start record prevents a missing ledger from looking like a fresh job.
    // Write both together before the first transport; incomplete storage always fails closed.
    if(value===undefined||!object(guard)||guard.version!==1||!object(value)||guard.limit!==value.limit||guard.maxAttempts!==value.maxAttempts)throw new SourceBudgetError('source_budget_corrupt');
    if(!object(value)||value.version!==1||!integer(value.limit)||!integer(value.maxAttempts)||!integer(value.chargedBytes)||!integer(value.attempts)||value.chargedBytes>value.limit||value.attempts>value.maxAttempts||!object(value.pending)||Object.values(value.pending).some(n=>!integer(n)||n>MAX_SOURCE_FILE_BYTES)||Object.values(value.pending).reduce<number>((sum,n)=>sum+Number(n),0)>value.chargedBytes)throw new SourceBudgetError('source_budget_corrupt');
    return structuredClone(value) as unknown as Ledger;
  }
  reserve(jobId:string,limit:number,maxAttempts:number):Promise<Reservation>{return this.serial(async()=>{
    if(!Number.isSafeInteger(limit)||limit<1024||limit>64*1024*1024||!integer(maxAttempts)||maxAttempts>90)throw new Error('invalid_budget');
    const ledger=await this.read(jobId)??{version:1 as const,limit,maxAttempts,chargedBytes:0,attempts:0,pending:{}};
    if(ledger.limit!==limit||ledger.maxAttempts!==maxAttempts)throw new SourceBudgetError('source_budget_changed');
    const maxBytes=Math.min(MAX_SOURCE_FILE_BYTES,limit-ledger.chargedBytes);
    if(maxBytes<=0||ledger.attempts>=maxAttempts)throw new SourceBudgetError('source_budget_exhausted');
    const id=crypto.randomUUID();ledger.pending[id]=maxBytes;ledger.chargedBytes+=maxBytes;ledger.attempts++;
    await this.area.set({[sourceBudgetKey(jobId)]:ledger,[sourceBudgetGuardKey(jobId)]:{version:1,limit,maxAttempts}});return {jobId,id,maxBytes};
  });}
  complete(reservation:Reservation,bytes:number):Promise<void>{return this.serial(async()=>{
    const ledger=await this.read(reservation.jobId);
    if(!ledger||!Object.hasOwn(ledger.pending,reservation.id)||ledger.pending[reservation.id]!==reservation.maxBytes||!integer(bytes)||bytes>reservation.maxBytes)throw new SourceBudgetError('source_budget_corrupt');
    ledger.chargedBytes-=reservation.maxBytes-bytes;delete ledger.pending[reservation.id];
    await this.area.set({[sourceBudgetKey(reservation.jobId)]:ledger});
  });}
}
