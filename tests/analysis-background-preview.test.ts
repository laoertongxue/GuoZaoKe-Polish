import { expect, it, vi } from 'vitest';
import { createAnalysisHandler } from '../src/analysis/background';
import { AnalysisRepository } from '../src/analysis/repository';
import { examplePackage } from './fixtures/analysis/package';
it('isolates the read-only forum iframe from credentials, calls and other topic histories', async () => {
  const values: Record<string,unknown>={};const area={get:async(key:string)=>({[key]:values[key]}),set:async(next:Record<string,unknown>)=>{Object.assign(values,next);},remove:async(key:string)=>{delete values[key];}};
  const api={runtime:{id:'ours',getURL:(path:string)=>`chrome-extension://ours${path}`},storage:{local:area,session:area},permissions:{contains:async()=>true},tabs:{create:vi.fn(async()=>({}))}};
  const pkg=examplePackage();await new AnalysisRepository(area).savePackage(pkg);const handle=createAnalysisHandler(api);
  const sender={id:'ours',url:'chrome-extension://ours/analysis-view.html?topic=121894'};
  expect(await handle({type:'analysis:view:get'},sender)).toEqual(pkg);
  expect(await handle({type:'analysis:view:get'},{...sender,url:'chrome-extension://ours/analysis-view.html?topic=999'})).toBeNull();
  for(const type of ['analysis:config:get','analysis:call','analysis:source:bytes','analysis:config:save']) await expect(handle({type},sender)).rejects.toThrow('untrusted_sender');
  await expect(handle({type:'analysis:open',url:'https://www.guozaoke.com/t/999'},sender)).rejects.toThrow('untrusted_sender');
  await handle({type:'analysis:open',url:pkg.snapshot.url},sender);expect(api.tabs.create).toHaveBeenCalledTimes(1);
});
