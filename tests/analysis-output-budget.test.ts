import {expect,it,vi} from 'vitest';
import {chatCompletion,normalizeModelConfig} from '../src/analysis/providers';
import {createRun} from '../src/analysis/engine';
import {examplePackage} from './fixtures/analysis/package';

const config={id:'deepseek',name:'DeepSeek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',temperature:0,maxOutputTokens:65536,declaredVersion:''};
it('carries a 64K model output budget into the frozen run and HTTP request',async()=>{
 const normalized=normalizeModelConfig(config);
 const job=createRun(examplePackage().snapshot,normalized);
 expect(job.budget.maxOutputTokens).toBe(65536);
 expect(job.package.provenance.parameters.maxOutputTokens).toBe(65536);
 const fetch=vi.fn<typeof globalThis.fetch>(async(_url,init)=>{
  expect(JSON.parse(String(init?.body)).max_tokens).toBe(65536);
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'{"ok":true}'}}]}));
 });
 expect((await chatCompletion(normalized,'fixture-key',[{role:'user',content:'json'}],{fetch})).value).toEqual({ok:true});
});
it('uses the official DeepSeek thinking budget in automatic mode but preserves explicit budgets',()=>{
 expect(normalizeModelConfig({...config,maxOutputTokens:4096,outputTokenPolicy:'auto'}).maxOutputTokens).toBe(65536);
 expect(normalizeModelConfig({...config,maxOutputTokens:4096,outputTokenPolicy:'manual'}).maxOutputTokens).toBe(4096);
 expect(normalizeModelConfig({...config,baseUrl:'https://aggregator.example.org',maxOutputTokens:4096,outputTokenPolicy:'auto'}).maxOutputTokens).toBe(4096);
});
it('matches official DeepSeek model names case-insensitively so the 64K hint is not lost to capitalization',()=>{
 expect(normalizeModelConfig({...config,model:'DeepSeek-Flash',outputTokenPolicy:'auto'}).maxOutputTokens).toBe(65536);
 expect(normalizeModelConfig({...config,model:'DEEPSEEK-V4-PRO',outputTokenPolicy:'auto'}).maxOutputTokens).toBe(65536);
});
it('supports the documented output ceiling without treating 1M context as output allowance',()=>{
 expect(normalizeModelConfig({...config,maxOutputTokens:393216}).maxOutputTokens).toBe(393216);
 expect(()=>normalizeModelConfig({...config,maxOutputTokens:1048576})).toThrow();
});
it('lets a 64K request pass the old 60-second cutoff and still supports cancellation',async()=>{
 vi.useFakeTimers();
 try{
  const controller=new AbortController();
  let signal:AbortSignal|undefined;
  const fetch=vi.fn<typeof globalThis.fetch>(async(_url,init)=>{signal=init?.signal as AbortSignal;return new Promise(()=>{});});
  const pending=chatCompletion(config,'fixture-key',[{role:'user',content:'json'}],{fetch,signal:controller.signal}).catch(e=>e);
  await vi.advanceTimersByTimeAsync(61000);
  expect(fetch).toHaveBeenCalledTimes(1);expect(signal?.aborted).toBe(false);
  controller.abort();expect(await pending).toMatchObject({code:'cancelled'});
 }finally{vi.useRealTimers();}
});
it('still times out a stalled large-output request after five minutes',async()=>{
 vi.useFakeTimers();
 try{
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Promise(()=>{}));
  const pending=chatCompletion(config,'fixture-key',[{role:'user',content:'json'}],{fetch}).catch(e=>e);
  await vi.advanceTimersByTimeAsync(300000);
  expect(await pending).toMatchObject({code:'timeout'});expect(fetch).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});
it('allows a large reasoning payload while returning only the structured answer',async()=>{
 const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',reasoning_content:'x'.repeat(2*1024*1024),content:'{"ok":true}'}}]})));
 const result=await chatCompletion({...config,maxOutputTokens:131072},'fixture-key',[{role:'user',content:'json'}],{fetch});
 expect(result.value).toEqual({ok:true});expect(result).not.toHaveProperty('reasoning_content');
});
