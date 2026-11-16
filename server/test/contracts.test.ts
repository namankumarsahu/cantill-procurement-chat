import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractContractDraft,reconcileContracts,type ContractParser} from '../src/contracts.js';
import {withApp} from './policy-fixture.js';
import {loadMasterData} from '../src/repository.js';
import {master,policy,line} from '../../engine/test/fixtures.js';
import {processBatch} from '../../engine/src/process.js';
const text='Contract No. RC-2026-999\nSupplier ID S1\nvalid from 2026-11-20 to 2027-11-20\nshall not exceed INR 1,00,000\nITM-001 Test component NOS 12.50\n';
const fields={contract_id:'MANUAL-1',supplier_id:'A',start_date:'2026-01-01',end_date:'2027-12-31',value_cap:'1000',consumed_value:'0',baseline_date:'2026-01-01',lines:[{item_code:'I',uom:'NOS',rate:'10'}]};
const headers={authorization:'Bearer test','x-actor':'contract-buyer','x-role':'buyer','content-type':'application/json'};
const failing:ContractParser=async()=>{throw new Error('provider offline');};
test('deterministic contract extraction precedes LLM and proposes zero only for a future-start PDF',async()=>{
 let calls=0;const parser:ContractParser=async()=>{calls++;throw Error('must not be called');};const r=await extractContractDraft(text,master(),'2026-10-31',parser);
 assert.equal(r.method,'deterministic');assert.equal(calls,0);assert.equal(r.fields.value_cap,'100000');assert.equal(r.fields.consumed_value,'0');assert.equal(r.fields.baseline_date,'2026-11-20');
 const older=await extractContractDraft(text.replaceAll('2026-11-20','2026-01-01'),master(),'2026-10-31',parser);assert.equal(older.fields.consumed_value,undefined);assert.equal(older.fields.baseline_date,undefined);
});
test('LLM fallback validates shape, and failed or no-key extraction retains manual completion',async()=>{
 const r=await extractContractDraft('an irregularly formatted signed agreement',master(),'2026-10-31',async()=>({contract_id:'C',supplier_id:'A',start_date:'2026-01-01',end_date:'2026-12-31',value_cap:'500',lines:[{item_code:'I',uom:'NOS',rate:'4'}]}));assert.equal(r.method,'llm');assert.equal(r.fields.consumed_value,undefined);
 const fail=await extractContractDraft('scanned',master(),'2026-10-31',failing);assert.equal(fail.method,'manual');assert.deepEqual(fail.fields,{});
 const saved=process.env.LLM_API_KEY;delete process.env.LLM_API_KEY;try{const local=await extractContractDraft('scanned',master(),'2026-10-31');assert.equal(local.method,'manual');assert.match(local.notes[0],/No LLM/);}finally{if(saved!==undefined)process.env.LLM_API_KEY=saved;}
 const invalid=await extractContractDraft('text',master(),'2026-10-31',async()=>({invented:true})as any);assert.equal(invalid.method,'manual');
 const scanned=await extractContractDraft('',master(),'2026-10-31',async()=>{throw Error('empty documents must not reach the model');});assert.match(scanned.notes[0],/OCR is not enabled/);
});
test('reconciliation compares exact signed terms, reports unmatched PDFs, expiry and inactive suppliers',async()=>{
 const extracted=(await extractContractDraft(text,master(),'2026-10-31',failing)).fields;const data=master();data.suppliers[0].status='Blocked';data.contracts=[{...fields,contract_id:'RC-2026-999',supplier_id:'S1',start_date:'2026-11-20',end_date:'2027-11-20',value_cap:'100000.00',source:'register',lines:[{item_code:'ITM-001',uom:'NOS',rate:'12.500'}]}];
 const documents=[{filename:'RC-2026-999.pdf',sha256:'x',text}];let r=reconcileContracts(data,documents,'2028-01-01');assert.equal(r.contracts[0].reconciliation,'MATCHED');assert.equal(r.contracts[0].date_status,'EXPIRED');
 data.contracts[0].lines[0].rate='13';r=reconcileContracts(data,documents,'2026-11-25');assert.equal(r.contracts[0].reconciliation,'MISMATCH');assert.match(r.contracts[0].differences.join(),/lines/);
 data.contracts=[];r=reconcileContracts(data,documents,'2026-11-25');assert.equal(r.pdf_only[0].fields?.contract_id,extracted.contract_id);
 data.contracts=[{...fields,source:'manual'}];r=reconcileContracts(data,[],'2026-11-25');assert.equal(r.contracts[0].reconciliation,'NO_PDF');assert.equal(r.contracts[0].supplier_status,'Blocked');
});
async function post(url:string,path:string,body:unknown){const response=await fetch(url+path,{method:'POST',headers,body:JSON.stringify(body)});return{status:response.status,data:await response.json()};}
test('buyer confirmation validates references, creates an immutable master snapshot, and audits/replays once',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 await withApp(undefined,async(url,pool)=>{
  const old=await loadMasterData(pool),draft=await post(url,'/api/contracts/drafts',{});assert.equal(draft.status,201);assert.equal((await loadMasterData(pool)).import_id,old.import_id);
  const path=`/api/contracts/drafts/${draft.data.id}/confirm`;
  assert.equal((await post(url,path,{fields,reviewed:false,comment:'checked'})).status,400);
  assert.equal((await post(url,path,{fields,reviewed:true,comment:''})).status,400);
  assert.equal((await post(url,path,{fields:{...fields,end_date:'2025-01-01'},reviewed:true,comment:'checked'})).status,400);
  assert.equal((await post(url,path,{fields:{...fields,lines:[{item_code:'unknown',uom:'NOS',rate:'10'}]},reviewed:true,comment:'checked'})).status,400);
  assert.equal((await post(url,path,{fields:{...fields,lines:[{item_code:'I',uom:'KG',rate:'10'}]},reviewed:true,comment:'checked'})).status,400);
  const confirmed=await post(url,path,{fields,reviewed:true,comment:'Verified signed terms and opening balance'});assert.equal(confirmed.status,200,JSON.stringify(confirmed));
  const current=await loadMasterData(pool);assert.notEqual(current.import_id,old.import_id);assert.equal(current.data.contracts[0].source,'manual');assert.equal((await loadMasterData(pool,old.import_id)).data.contracts.length,0);assert.equal(processBatch(policy(),current.data,[line(1)]).rows[0].route,'CONTRACT_PO');
  const repeat=await post(url,path,{fields,reviewed:true,comment:'checked again'});assert.equal(repeat.data.reused,true);assert.equal(repeat.data.import_id,current.import_id);
  assert.equal((await post(url,path,{fields:{...fields,value_cap:'1001'},reviewed:true,comment:'changed'})).status,400);
  const audit=(await pool.query("SELECT * FROM audit_events WHERE action='CONTRACT_CONFIRMED'")).rows;assert.equal(audit.length,1);assert.equal(audit[0].actor,'contract-buyer');assert.equal(audit[0].before,null);assert.equal(audit[0].after.contract.value_cap,'1000');
 });
});
test('stale contract drafts cannot overwrite newer imports, and upload fallback requires buyer confirmation',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 await withApp(undefined,async(url,pool)=>{
  const a=await post(url,'/api/contracts/drafts',{}),b=await post(url,'/api/contracts/drafts',{});
  await post(url,`/api/contracts/drafts/${a.data.id}/confirm`,{fields,reviewed:true,comment:'checked'});
  const stale=await post(url,`/api/contracts/drafts/${b.data.id}/confirm`,{fields:{...fields,contract_id:'another'},reviewed:true,comment:'checked'});assert.equal(stale.status,400);assert.match(stale.data.error,/Master data changed/);
  const form=new FormData();form.set('file',new Blob(['%PDF-1.7\n%%EOF'],{type:'application/pdf'}),'scanned.pdf');const draft=await fetch(url+'/api/contracts/drafts',{method:'POST',headers:{authorization:'Bearer test','x-actor':'contract-buyer','x-role':'buyer'},body:form}).then(r=>r.json());assert.equal(draft.method,'manual');assert.equal((await loadMasterData(pool)).data.contracts.length,1);
  const confirmed=await post(url,`/api/contracts/drafts/${draft.id}/confirm`,{fields:{...fields,contract_id:'PDF-ONLY-2'},reviewed:true,comment:'Manually transcribed PDF and verified opening consumption'});assert.equal(confirmed.status,200,JSON.stringify(confirmed));
  const list=await fetch(url+'/api/contracts').then(r=>r.json());assert.equal(list.documents.length,1);const added=list.contracts.find((c:any)=>c.contract_id==='PDF-ONLY-2');assert.equal(added.source,'pdf_only');assert.equal(added.pdf_filenames.length,1);assert.equal(added.reconciliation,'MISMATCH');const pdf=await fetch(url+'/api/contracts/documents/'+list.documents[0].sha256);assert.equal(pdf.headers.get('content-type'),'application/pdf');
  assert.equal((await pool.query('SELECT count(*)::int n FROM contract_drafts WHERE confirmed_import_id IS NOT NULL')).rows[0].n,2);
 },{contractParser:failing});
});
