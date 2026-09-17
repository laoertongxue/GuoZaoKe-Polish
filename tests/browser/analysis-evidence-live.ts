import { importEvidenceFile } from '../../src/analysis/evidence';
interface Item {id:string;url:string;file:string;status:string;contentType?:string;sha256?:string}
const result=document.querySelector<HTMLPreElement>('#result')!;
const button=document.querySelector<HTMLButtonElement>('#run')!;
const directory='/artifacts/analysis-live-evidence-20260915/';
const hash=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(x=>x.toString(16).padStart(2,'0')).join('');
button.onclick=async()=>{
  button.disabled=true;result.textContent='解析中';
  const records:unknown[]=[];
  try{
    const receipt=await(await fetch(directory+'fetch-receipt.json')).json() as {cases:Item[]};
    for(const item of receipt.cases){
      if(item.status!=='read'){records.push({id:item.id,status:'not_fetched'});continue;}
      // Vite transforms .html responses; use an identical .bin copy for byte-for-byte validation.
      const response=await fetch(directory+item.file+(item.contentType==='text/html'?'.bin':''));
      if(!response.ok)throw new Error('local_original_missing');
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(await hash(bytes)!==item.sha256)throw new Error('original_hash_mismatch');
      const source=await importEvidenceFile(new File([bytes],item.file,{type:item.contentType}),{timeoutMs:20000});
      const repeated=await importEvidenceFile(new File([bytes],item.file,{type:item.contentType}),{timeoutMs:20000});
      const tableAt=source.text.indexOf('[表格 1 行 1]');
      records.push({id:item.id,originalUrl:item.url,rawHash:item.sha256,status:source.status,kind:source.kind,title:source.title,publisher:source.publisher,publishedAt:source.publishedAt,locator:source.locator,characters:source.text.length,textHash:await hash(new TextEncoder().encode(source.text)),repeatIdentical:source.id===repeated.id&&source.text===repeated.text,numericFacts:source.data.length,limitations:source.limitations,sample:source.text.slice(0,200),tableSample:tableAt<0?null:source.text.slice(tableAt,tableAt+600)});
      result.textContent=JSON.stringify({status:'running',modelCalls:0,records},null,2);
    }
    result.textContent=JSON.stringify({status:'finished',modelCalls:0,records},null,2);
  }catch(error){result.textContent=JSON.stringify({status:'failed',error:error instanceof Error?error.message:'unknown',modelCalls:0,records},null,2);}
  finally{button.disabled=false;}
};
