import{test}from'node:test';import assert from'node:assert/strict';import{stringify}from'csv-stringify/sync';
import{withApp}from'./policy-fixture.js';import{line,contract}from'../../engine/test/fixtures.js';import{prColumns,readCSV}from'../src/csv.js';import{loadMasterData,saveImport}from'../src/repository.js';
const headers={authorization:'Bearer test','x-actor':'buyer-one','x-role':'buyer','content-type':'application/json'};
async function batch(url:string,lines:ReturnType<typeof line>[]){const form=new FormData();form.set('file',new Blob([stringify(lines,{header:true,columns:[...prColumns]})]),'batch.csv');form.set('policy_version','5.0');const r=await fetch(url+'/api/process-batch',{method:'POST',headers:{'x-actor':'buyer-one'},body:form});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body;}
async function act(url:string,run:string,group:string,action:string,body:unknown={}){const r=await fetch(url+`/api/buyer/runs/${run}/requirements/${group}/${action}`,{method:'POST',headers,body:JSON.stringify(body)});return{status:r.status,data:await r.json()};}

test('PO overrides persist consolidated IDs in audit and export; sourcing clears them and approval creates the document',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 await withApp(undefined,async(url,pool)=>{
  const run=await batch(url,[line(1,{need_by_date:'2099-01-01'}),line(2,{need_by_date:'2099-02-01'})]);const [a,b]=run.requirements;
  async function override(group:string,body:unknown){const result=await act(url,run.run_id,group,'override',body);assert.equal(result.status,200,JSON.stringify(result));const req=result.data.requirements.find((r:any)=>r.group_id===group),record=(await pool.query('SELECT effective FROM buyer_decisions WHERE run_id=$1 AND group_id=$2',[run.run_id,group])).rows[0].effective,audit=(await pool.query("SELECT after FROM audit_events WHERE action='REQUIREMENT_OVERRIDDEN' ORDER BY id DESC LIMIT 1")).rows[0].after;assert.deepEqual(record,req);assert.deepEqual(audit,req);const csv=readCSV(await fetch(url+run.export_url).then(r=>r.text()),['po_id','decision']);const exported=csv.find(r=>r.group_id===group)!;assert.equal(exported.po_id,req.po_id);assert.equal(exported.decision,req.decision);if(req.decision==='PO'){assert.ok(req.po_id);assert.ok(result.data.purchase_orders.some((p:any)=>p.po_id===req.po_id&&p.group_ids.includes(group)));}else assert.equal(req.po_id,'');return req;}
  const same=await override(a.group_id,{route:a.route,supplier_id:a.supplier_id,unit_price:a.unit_price,comment:'Reviewed; retain existing terms'});assert.equal(same.po_id,a.po_id);
  const split=await override(b.group_id,{route:'SPOT_PO',supplier_id:'B',unit_price:'2',comment:'Use alternate supplier'});assert.notEqual(split.po_id,same.po_id);
  await override(a.group_id,{route:'RFQ',comment:'Obtain quotes instead'});
  await override(a.group_id,{route:'SPOT_PO',supplier_id:'B',unit_price:'2',comment:'Accept alternate supplier for both requirements'});
  assert.equal((await pool.query('SELECT count(*)::int n FROM procurement_documents')).rows[0].n,0);
  const approved=await act(url,run.run_id,a.group_id,'approve');assert.equal(approved.status,200);assert.equal(approved.data.document.kind,'PO');assert.equal((await pool.query('SELECT count(*)::int n FROM procurement_document_lines')).rows[0].n,2);
  const csv=readCSV(await fetch(url+run.export_url).then(r=>r.text()),['po_id']);assert.ok(csv.every(r=>r.po_id===approved.data.document.document_no));
 });
});
test('approval materializes one consolidated PO idempotently, and sourcing creates an RFQ record',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 await withApp(undefined,async(url,pool)=>{
  const lines=[line(1,{need_by_date:'2099-01-01'}),line(2,{need_by_date:'2099-01-20'}),line(3,{quantity:'300000',need_by_date:'2099-02-01'})];const run=await batch(url,lines);assert.equal(run.requirements.length,3);
  const approved=await act(url,run.run_id,run.requirements[0].group_id,'approve');assert.equal(approved.status,200,JSON.stringify(approved));assert.equal(approved.data.document.kind,'PO');
  const again=await act(url,run.run_id,run.requirements[1].group_id,'approve');assert.equal(again.data.document.id,approved.data.document.id);assert.equal(again.data.reused,true);
  assert.equal((await pool.query('SELECT count(*)::int n FROM procurement_document_lines')).rows[0].n,2);
  const source=await act(url,run.run_id,run.requirements[2].group_id,'approve');assert.equal(source.data.document.kind,'RFQ');assert.equal((await pool.query('SELECT count(*)::int n FROM procurement_documents')).rows[0].n,2);
  const exported=readCSV(await fetch(url+run.export_url).then(r=>r.text()),['po_id']);assert.equal(exported[0].po_id,approved.data.document.document_no);assert.equal(exported[1].po_id,approved.data.document.document_no);
  const changed=await batch(url,lines);assert.equal(changed.replaced,false);
  const form=new FormData();form.set('file',new Blob([stringify(lines,{header:true,columns:[...prColumns]})]),'batch.csv');form.set('as_of_date','2026-11-03');assert.equal((await fetch(url+'/api/process-batch',{method:'POST',body:form})).status,400);
  assert.equal((await act(url,run.run_id,run.requirements[0].group_id,'override',{route:'RFQ',comment:'Too late'})).status,400);
 });
});
test('overrides require a comment, retain original evidence, reject blocked suppliers, and appear in audit/export',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 await withApp(undefined,async(url,pool)=>{
  const run=await batch(url,[line(1,{quantity:'300000'})]),group=run.requirements[0].group_id;
  assert.equal((await act(url,run.run_id,group,'override',{route:'SPOT_PO',supplier_id:'B',unit_price:'2',comment:''})).status,400);
  assert.equal((await act(url,run.run_id,group,'override',{route:'SPOT_PO',supplier_id:'X',unit_price:'2',comment:'Exception'})).status,400);
  const result=await act(url,run.run_id,group,'override',{route:'SPOT_PO',supplier_id:'B',unit_price:'2',comment:'Buyer-approved commercial exception'});assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.requirements[0].route,'SPOT_PO');
  const record=(await pool.query('SELECT * FROM buyer_decisions')).rows[0];assert.equal(record.original.route,'RFQ');assert.equal(record.effective.route,'SPOT_PO');
  const csv=readCSV(await fetch(url+run.export_url).then(r=>r.text()),['route','reason']);assert.equal(csv[0].route,'SPOT_PO');assert.match(csv[0].reason,/commercial exception/);
  const approved=await act(url,run.run_id,group,'approve');assert.equal(approved.status,200);assert.equal(approved.data.document.supplier_id,'B');
  const audits=await fetch(url+'/api/audit?action=REQUIREMENT_OVERRIDDEN').then(r=>r.json());assert.equal(audits[0].actor,'buyer-one');assert.equal(audits[0].role,'buyer');assert.equal(audits[0].before.route,'RFQ');assert.equal(audits[0].after.route,'SPOT_PO');
 });
});
test('approval rechecks current supplier status and global contract consumption across runs',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 await withApp(undefined,async(url,pool)=>{
  const original=await loadMasterData(pool),data=original.data;data.contracts=[contract({value_cap:'100',lines:[{item_code:'I',uom:'NOS',rate:'60'}]})];await saveImport(pool,{data,batch:[],documents:[],warnings:[],fingerprint:'with-contract',snapshot_date:'2026-01-01'},'test');
  const a=await batch(url,[line(1)]),b=await batch(url,[line(2)]);assert.equal(a.rows[0].route,'CONTRACT_PO');assert.equal(b.rows[0].route,'CONTRACT_PO');
  assert.equal((await act(url,a.run_id,a.requirements[0].group_id,'approve')).status,200);
  const over=await act(url,b.run_id,b.requirements[0].group_id,'approve');assert.equal(over.status,400);assert.match(over.data.error,/ceiling/);assert.equal((await pool.query('SELECT sum(amount)::text n FROM contract_allocations')).rows[0].n,'60.00');
  const current=await loadMasterData(pool);current.data.suppliers[0].status='Blocked';await saveImport(pool,{data:current.data,batch:[],documents:[],warnings:[],fingerprint:'blocked-current',snapshot_date:'2026-01-01'},'test');
  const inactive=await act(url,b.run_id,b.requirements[0].group_id,'approve');assert.equal(inactive.status,400);assert.match(inactive.data.error,/Active/);assert.equal((await pool.query('SELECT count(*)::int n FROM procurement_documents')).rows[0].n,1);
 });
});
