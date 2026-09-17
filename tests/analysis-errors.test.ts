import {expect,it,vi} from 'vitest';
import {createRun,executeRun} from '../src/analysis/engine';
import {ProviderError} from '../src/analysis/providers';
import {analysisErrorCode,unwrapAnalysisResponse} from '../src/analysis/errors';
import {examplePackage} from './fixtures/analysis/package';
const config={id:'local',name:'Model',baseUrl:'https://api.example.org/v1',model:'test',temperature:0,maxOutputTokens:4096,declaredVersion:''};
it.each(['unauthorized','network','timeout','invalid_json'] as const)('preserves %s across background message serialization and engine checkpoints',async code=>{
 const remote=new ProviderError(code);const payload=JSON.parse(JSON.stringify({ok:false,error:remote.message,code:analysisErrorCode(remote)}));
 const job=await executeRun(createRun(examplePackage().snapshot,config),{save:vi.fn(async()=>{}),call:async()=>unwrapAnalysisResponse(payload)});
 expect(job.errors.at(-1)?.code).toBe(code);expect(job.callsUsed).toBe(1);
});
it('never exposes an unrecognized remote error body',()=>{
 try{unwrapAnalysisResponse({ok:false,code:'private-token',error:'private-token in upstream response'});throw new Error('expected rejection');}
 catch(error){expect(String(error)).not.toContain('private-token');}
});
