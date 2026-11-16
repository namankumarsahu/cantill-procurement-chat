import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stringify} from 'csv-stringify/sync';
import {loadSeedPolicy} from '../src/repository.js';
import {withApp} from './policy-fixture.js';
import {master,line,policy} from '../../engine/test/fixtures.js';
import {prColumns} from '../src/csv.js';
import {applyPolicyEdits,type PolicyEdits} from '../src/policy-edits.js';
import {parseAmendment} from '../src/llm.js';
import {describeDiff} from '../src/policy-diff.js';
import type {DraftParser} from '../src/llm.js';
const header={'authorization':'Bearer test','x-actor':'procurement-test'};
const add=(path:string,value:unknown)=>({op:'add' as const,path,value_json:JSON.stringify(value)});
const scoped=(fact:string,value:string,param:string)=>({id:'scoped-limit',clause:'test amendment',order:45,when:{all:[{fact,operator:'eq',value},{fact:'requirement_value_inr',operator:'gte',value:{parameter:param}},{fact:'requirement_value_inr',operator:'lt',value:{parameter:'spot_limit_inr'}}]},outcome:{route:'RFQ'}});
const cases=[
 {name:'spot limit',quantity:'250000',plant:'P',before:'RFQ',after:'SPOT_PO',edits:[add('/parameters/spot_limit_inr',400000)]},
 {name:'CHK1-only rule',quantity:'150000',plant:'CHK1',before:'SPOT_PO',after:'RFQ',edits:[add('/parameters/chakan_spot_limit_inr',100000),add('/rules/4',scoped('plant','CHK1','chakan_spot_limit_inr'))]},
 {name:'category-specific limit',quantity:'150000',plant:'P',before:'SPOT_PO',after:'RFQ',edits:[add('/parameters/parts_spot_limit_inr',100000),add('/rules/4',scoped('category','Parts','parts_spot_limit_inr'))]},
 {name:'new quantity fact and new route',quantity:'1500',plant:'P',before:'SPOT_PO',after:'BULK_REVIEW',edits:[add('/parameters/bulk_quantity',1000),add('/fact_registry/total_quantity',{type:'number',source:'requirement.quantity'}),add('/route_registry/BULK_REVIEW',{decision:'SOURCING_REQUEST',supplier_strategy:'none',suggest_count:0,flags:['bulk_review']}),add('/rules/4',{id:'bulk',clause:'test amendment',order:45,when:{fact:'total_quantity',operator:'gt',value:{parameter:'bulk_quantity'}},outcome:{route:'BULK_REVIEW'}})]},
];
function pdf(text:string):Buffer{
 const stream=`BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let out='%PDF-1.4\n';const offsets=[0];for(const [i,obj]of objects.entries()){offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
 const start=Buffer.byteLength(out);out+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Buffer.from(out);
}
async function post(url:string,path:string,body:unknown){if(path.endsWith('/approve')){const preview=await fetch(url+path.replace('/approve','/impact'),{method:'POST',headers:{...header,'content-type':'application/json'},body:JSON.stringify(body)});if(preview.ok){const impact=await preview.json();body={...body as object,preview_id:impact.preview_id,allow_no_batch:!impact.available};}}const r=await fetch(url+path,{method:'POST',headers:{...header,'content-type':'application/json'},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};}
for(const [index,c]of cases.entries())test(`Amendment ${String.fromCharCode(97+index)}: ${c.name}, draft/diff/approve/date/reprocess`,{skip:!process.env.TEST_DATABASE_URL},async()=>{
 let parsedSource='';const parser:DraftParser=async source=>{parsedSource=source;return{operations:c.edits,unresolved:[],rule_restatements:c.edits.filter(e=>e.path.startsWith('/rules/')).map(e=>({rule_id:JSON.parse(e.value_json).id,text:'Apply the scoped amendment while preserving earlier rules.'}))};};
 await withApp(parser,async(url,pool)=>{
  const csv=stringify([line(1,{quantity:c.quantity,plant:c.plant})],{header:true,columns:[...prColumns]});
  async function batch(date:string,version?:string){const form=new FormData();form.set('file',new Blob([csv]),'same-batch.csv');form.set('as_of_date',date);if(version)form.set('policy_version',version);const r=await fetch(url+'/api/process-batch',{method:'POST',headers:header,body:form});return{status:r.status,data:await r.json()};}
  const before=await batch('2026-11-02','5.0');assert.equal(before.status,200);assert.equal(before.data.rows[0].route,c.before);
  const form=new FormData();form.set('version','5.1');form.set('effective_date','2026-11-03');form.set('base_version','5.0');
  if(index===1)form.set('file',new Blob(['A CHK1-only amendment to the normal spot limit.']),'amendment.txt');
  else if(index===2)form.set('file',new Blob([new Uint8Array(pdf('A category-specific procurement limit amendment.'))]),'amendment.pdf');
  else form.set('text',`Please draft ${c.name}.`);
  const drafted=await fetch(url+'/api/admin/policies/drafts',{method:'POST',headers:header,body:form});const review=await drafted.json();assert.equal(drafted.status,201,JSON.stringify(review));
  assert.ok(parsedSource.includes(index===2?'category-specific':index===1?'CHK1':c.name));assert.ok(review.changes.length);assert.equal(review.draft.status,'draft');assert.equal(review.draft.approved_by,null);
  assert.equal((await batch('2026-11-04','5.1')).status,400);
  assert.equal((await batch('2026-11-02')).data.rows[0].route,c.before);
  assert.equal((await post(url,'/api/admin/policies/5.1/approve',{review_hash:'stale'})).status,400);
  const approved=await post(url,'/api/admin/policies/5.1/approve',{review_hash:review.review_hash});assert.equal(approved.status,200,JSON.stringify(approved));assert.equal(approved.data.policy.approved_by,'procurement-test');
  assert.equal((await batch('2026-11-02')).data.rows[0].route,c.before);
  const amended=await batch('2026-11-03');assert.equal(amended.status,200,JSON.stringify(amended));assert.equal(amended.data.rows[0].route,c.after);assert.equal(amended.data.policy_version,'5.1');
  assert.equal(amended.data.run_id,before.data.run_id);assert.equal(amended.data.batch_id,before.data.batch_id);assert.equal(amended.data.replaced,true);
  const repeated=await batch('2026-11-03','5.1');assert.deepEqual(repeated.data.purchase_orders,amended.data.purchase_orders);
  const concurrent=await Promise.all([batch('2026-11-03','5.1'),batch('2026-11-03','5.1')]);assert.ok(concurrent.every(r=>r.status===200&&r.data.run_id===amended.data.run_id));
  assert.equal((await pool.query('SELECT count(*)::int n FROM processing_runs WHERE is_current')).rows[0].n,1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM batches')).rows[0].n,1);
  assert.ok((await pool.query("SELECT before FROM audit_events WHERE action='REPROCESS_BATCH' AND before IS NOT NULL")).rows.some(r=>r.before.result.rows[0].route===c.before));
  if(index===1||index===2){const other=line(2,{quantity:c.quantity,plant:'P'});if(index===2){const data=master();other.item_code='J';data.items.push({...data.items[0],item_code:'J',category:'Other'});data.po_history.push({...data.po_history[0],po_number:'HJ',item_code:'J'});const {processBatch}=await import('../../engine/src/process.js');assert.equal(processBatch(approved.data.policy,data,[other],{as_of_date:'2026-11-03'}).rows[0].route,'SPOT_PO');}else{const {processBatch}=await import('../../engine/src/process.js');assert.equal(processBatch(approved.data.policy,master(),[other],{as_of_date:'2026-11-03'}).rows[0].route,'SPOT_PO');}}
 });
});
test('manual editor fallback validates edits, rejects stale approval, and keeps approved versions immutable',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 await withApp(async()=>{throw new Error('LLM is not configured; use manual JSON');},async(url,pool)=>{
  const p=await loadSeedPolicy();p.parameters.spot_limit_inr+=1;
  const form=new FormData();form.set('version','manual');form.set('effective_date','2030-01-01');form.set('text','Raise the spot limit');
  assert.equal((await fetch(url+'/api/admin/policies/drafts',{method:'POST',headers:header,body:form})).status,400);
  form.set('policy_json',JSON.stringify(p));const r=await fetch(url+'/api/admin/policies/drafts',{method:'POST',headers:header,body:form});let review=await r.json();assert.equal(r.status,201,JSON.stringify(review));
  const originalHash=review.review_hash;review.draft.parameters.spot_limit_inr+=1;
  const edit=await fetch(url+'/api/admin/policies/manual',{method:'PUT',headers:{...header,'content-type':'application/json'},body:JSON.stringify({policy_json:review.draft,review_hash:review.review_hash})});review=await edit.json();assert.equal(edit.status,200);assert.notEqual(review.review_hash,originalHash);
  assert.equal((await post(url,'/api/admin/policies/manual/approve',{review_hash:originalHash})).status,400);
  const staleForm=new FormData();staleForm.set('version','stale-base');staleForm.set('effective_date','2030-01-02');staleForm.set('policy_json',JSON.stringify(p));
  const staleResponse=await fetch(url+'/api/admin/policies/drafts',{method:'POST',headers:header,body:staleForm});const stale=await staleResponse.json();assert.equal(staleResponse.status,201);
  const approved=await post(url,'/api/admin/policies/manual/approve',{review_hash:review.review_hash});assert.equal(approved.status,200);assert.equal(approved.data.lifecycle,'scheduled');
  assert.equal((await post(url,'/api/admin/policies/stale-base/approve',{review_hash:stale.review_hash})).status,400);
  const versions=await fetch(url+'/api/policies?as_of_date=2026-11-02').then(r=>r.json());assert.equal(versions.active_version,'5.0');assert.equal(versions.versions.find((v:{version:string})=>v.version==='manual').lifecycle,'scheduled');
  assert.equal((await fetch(url+'/api/admin/policies/manual',{method:'PUT',headers:{...header,'content-type':'application/json'},body:JSON.stringify({policy_json:review.draft,review_hash:review.review_hash})})).status,400);
  const caps=await fetch(url+'/api/policy-capabilities');assert.equal(caps.status,200);assert.ok((await caps.json()).fact_sources['requirement.quantity']);
  assert.equal((await pool.query("SELECT count(*)::int n FROM policy_versions WHERE version='manual'")).rows[0].n,1);
 });
});
test('unresolved edits, arbitrary source facts and prototype paths are rejected; diff names scoped conditions',()=>{
 assert.throws(()=>applyPolicyEdits(policy(),{operations:[],unresolved:['Missing limit']}));
 assert.throws(()=>applyPolicyEdits(policy(),{operations:[add('/parameters/__proto__/polluted',true)],unresolved:[]}));
 assert.throws(()=>applyPolicyEdits(policy(),{operations:[add('/fact_registry/bad',{type:'string',source:'process.env'})],unresolved:[]}));
 assert.throws(()=>applyPolicyEdits(policy(),{operations:[add('/rules/4',{id:'inherited',clause:'test',order:45,when:{fact:'constructor',operator:'in',value:[]},outcome:{route:'RFQ'}})],unresolved:[]}));
 const base=policy(),next=applyPolicyEdits(base,{operations:cases[1].edits,unresolved:[]});assert.ok(describeDiff(base,next).some(c=>c.after.includes('CHK1')));
});
test('OpenAI-compatible adapter requests strict edits and rejects bad JSON/provider errors without activation',async()=>{
 let request:Record<string,unknown>={};
 const mock=(async(_url:unknown,init:RequestInit)=>{request=JSON.parse(String(init.body));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({operations:cases[0].edits,unresolved:[],rule_restatements:[]})}}]}),{status:200});})as typeof fetch;
 const config={base_url:'https://example.invalid/v1',model:'mock',api_key:'fake-test-key'};
 const edits=await parseAmendment('Raise limit',policy(),config,mock);assert.equal(edits.operations.length,1);assert.equal(request.temperature,0);assert.ok(JSON.stringify(request.messages).includes('reference v5.0 policy'));assert.ok(JSON.stringify(request.messages).includes('Illustrative amendment text'));assert.equal(edits.rule_restatements.length,0);
 await parseAmendment('Lower the spot limit',policy(),config,mock,{v5:policy(),current_draft:policy(),feedback:'No, only to CHK1.'});const messages=request.messages as {role:string;content:string}[];assert.ok(messages.at(-1)!.content.includes('only to CHK1'));assert.ok(messages.at(-1)!.content.includes('original_amendment'));assert.equal((request.response_format as {json_schema:{strict:boolean}}).json_schema.strict,true);assert.ok(!JSON.stringify(request.response_format).includes('starts_with'));
 await assert.rejects(parseAmendment('x',policy(),{},mock),/not configured/);
 await assert.rejects(parseAmendment('x',policy(),config,(async()=>new Response('{"choices":[{"message":{"content":"oops"}}]}'))as typeof fetch),/invalid/);
 await assert.rejects(parseAmendment('x',policy(),config,(async()=>new Response('',{status:500}))as typeof fetch),/HTTP 500/);
 await assert.rejects(parseAmendment('x',policy(),config,(async()=>new Response(JSON.stringify({error:{message:`Rejected key ${config.api_key}`}}),{status:401}))as typeof fetch),(error:unknown)=>error instanceof Error&&error.message.includes('[redacted]')&&!error.message.includes(config.api_key));
});
