import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stringify} from 'csv-stringify/sync';
import {withApp} from './policy-fixture.js';
import {line,policy} from '../../engine/test/fixtures.js';
import {prColumns} from '../src/csv.js';
import {loadMasterData,loadSeedPolicy} from '../src/repository.js';
import {resetDemo} from '../src/reset-demo.js';
import {validateRestatements,applyPolicyEdits,editSchema} from '../src/policy-edits.js';
import type {DraftParser} from '../src/llm.js';
import {amendmentExamples} from '../src/amendment-examples.js';
const headers={authorization:'Bearer test','x-actor':'hardening-test'};
const add=(path:string,value:unknown)=>({op:'add' as const,path,value_json:JSON.stringify(value)});
const restriction={id:'chakan-restriction',clause:'test',order:45,when:{all:[{fact:'plant',operator:'eq',value:'CHK1'},{fact:'requirement_value_inr',operator:'gte',value:{parameter:'local_limit'}},{fact:'requirement_value_inr',operator:'lt',value:{parameter:'spot_limit_inr'}}]},outcome:{route:'RFQ'}};
async function json(url:string,path:string,body:unknown){const r=await fetch(url+path,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};}
async function processFixtureBatch(url:string,date='2026-11-02'){
 const body=new FormData();body.set('file',new Blob([stringify([line(1,{quantity:'150000',plant:'CHK1'}),line(2,{quantity:'150000',plant:'P'})],{header:true,columns:[...prColumns]})]),'fixture.csv');body.set('as_of_date',date);body.set('policy_version','5.0');
 const r=await fetch(url+'/api/process-batch',{method:'POST',headers,body});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;
}
async function manualDraft(url:string,version='review-me'){
 const p=policy();p.parameters.local_limit=100000;
 p.rules.push({id:'narrow-spot',clause:'test',order:45,when:{all:[{fact:'plant',operator:'eq',value:'CHK1'},{fact:'requirement_value_inr',operator:'lt',value:{parameter:'local_limit'}}]},outcome:{route:'SPOT_PO'}});
 const body=new FormData();body.set('version',version);body.set('effective_date','2026-11-03');body.set('base_version','5.0');body.set('text','Lower the spot limit to 100000.');body.set('policy_json',JSON.stringify(p));
 const r=await fetch(url+'/api/admin/policies/drafts',{method:'POST',headers,body});const data=await r.json();assert.equal(r.status,201,JSON.stringify(data));return data;
}
test('impact exposes an ineffective draft; feedback regenerates it and approval rejects missing/stale previews',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 let calls=0;
 const parser:DraftParser=async(source,base,context)=>{
  calls++;assert.match(source,/Lower the spot/);assert.equal(context?.v5.version,'5.0');assert.ok(context?.current_draft?.rules.some(r=>r.id==='narrow-spot'));assert.match(context!.feedback!,/only to CHK1/);
  if(context?.feedback?.includes('ambiguous'))return{operations:[],unresolved:['Specify the scope'],rule_restatements:[]};
  return{operations:[add('/parameters/local_limit',100000),add('/rules/4',restriction)],unresolved:[],rule_restatements:[{rule_id:'chakan-restriction',text:'CHK1 purchases at or above the local limit require RFQ after earlier contract and emergency rules.'}]};
 };
 await withApp(parser,async(url,pool)=>{
  const run=await processFixtureBatch(url),original=(await pool.query('SELECT result,policy_snapshot FROM processing_runs WHERE id=$1',[run.run_id])).rows[0];
  let review=await manualDraft(url);
  assert.equal((await json(url,'/api/admin/policies/review-me/approve',{review_hash:review.review_hash})).status,400);
  const first=await json(url,'/api/admin/policies/review-me/impact',{review_hash:review.review_hash});assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.data.changed_rows,0);assert.deepEqual(first.data.transitions,[]);
  assert.deepEqual((await pool.query('SELECT result,policy_snapshot FROM processing_runs WHERE id=$1',[run.run_id])).rows[0],original);
  assert.equal((await pool.query('SELECT count(*)::int n FROM processing_runs')).rows[0].n,1);
  const oldHash=review.review_hash,oldPreview=first.data.preview_id;
  const regenerated=await json(url,'/api/admin/policies/review-me/regenerate',{feedback:'No, the limit applies only to CHK1.',review_hash:oldHash});assert.equal(regenerated.status,200,JSON.stringify(regenerated));review=regenerated.data;
  assert.notEqual(review.review_hash,oldHash);assert.equal(review.rule_restatements.length,1);assert.equal(review.feedback_history.length,1);
  const rejected=await json(url,'/api/admin/policies/review-me/regenerate',{feedback:'The request is ambiguous; it applies only to CHK1.',review_hash:review.review_hash});assert.equal(rejected.status,400);
  assert.equal((await fetch(url+'/api/policies/review-me').then(r=>r.json())).review_hash,review.review_hash);
  assert.equal((await json(url,'/api/admin/policies/review-me/approve',{review_hash:review.review_hash,preview_id:oldPreview})).status,400);
  const impact=await json(url,'/api/admin/policies/review-me/impact',{review_hash:review.review_hash});assert.equal(impact.status,200,JSON.stringify(impact));assert.equal(impact.data.changed_rows,1);assert.equal(impact.data.route_changed_rows,1);assert.deepEqual(impact.data.transitions,[{old_route:'SPOT_PO',new_route:'RFQ',count:1}]);
  await processFixtureBatch(url,'2026-11-04');
  assert.equal((await json(url,'/api/admin/policies/review-me/approve',{review_hash:review.review_hash,preview_id:impact.data.preview_id})).status,400);
  const fresh=await json(url,'/api/admin/policies/review-me/impact',{review_hash:review.review_hash});
  const approved=await json(url,'/api/admin/policies/review-me/approve',{review_hash:review.review_hash,preview_id:fresh.data.preview_id});assert.equal(approved.status,200,JSON.stringify(approved));
  assert.equal((await json(url,'/api/admin/policies/review-me/regenerate',{feedback:'Only to CHK1',review_hash:review.review_hash})).status,400);
  assert.equal(calls,2);
 });
});
test('no-batch approval requires explicit acknowledgement; reset previews by default and preserves master data',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 await withApp(undefined,async(url,pool)=>{
  const review=await manualDraft(url),impact=await json(url,'/api/admin/policies/review-me/impact',{review_hash:review.review_hash});assert.equal(impact.data.available,false);
  assert.equal((await json(url,'/api/admin/policies/review-me/approve',{review_hash:review.review_hash,preview_id:impact.data.preview_id})).status,400);
  assert.equal((await json(url,'/api/admin/policies/review-me/approve',{review_hash:review.review_hash,preview_id:impact.data.preview_id,allow_no_batch:true})).status,200);
  await processFixtureBatch(url);const before=await loadMasterData(pool),raw=(await pool.query('SELECT count(*)::int n FROM pr_lines')).rows[0].n;
  const dry=await resetDemo(pool);assert.equal(dry.dry_run,true);assert.deepEqual(dry.policies_to_delete,['review-me']);assert.equal(dry.runs_to_delete,1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM policy_versions')).rows[0].n,2);
  await resetDemo(pool,true,'test-reset');assert.equal((await pool.query('SELECT count(*)::int n FROM processing_runs')).rows[0].n,0);assert.equal((await pool.query('SELECT count(*)::int n FROM policy_impact_previews')).rows[0].n,0);
  const policies=(await pool.query('SELECT document FROM policy_versions')).rows;assert.equal(policies.length,1);assert.deepEqual(policies[0].document,await loadSeedPolicy());
  assert.deepEqual(await loadMasterData(pool),before);assert.equal((await pool.query('SELECT count(*)::int n FROM pr_lines')).rows[0].n,raw);
  assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='DEMO_RESET'")).rows[0].n,1);
  const saved=process.env.NODE_ENV;process.env.NODE_ENV='production';try{await assert.rejects(resetDemo(pool,true),/disabled in production/);}finally{if(saved===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=saved;}
 });
});
test('restatements cover new rules, reject duplicates/multiline text, and all three prompt examples validate',()=>{
 for(const example of amendmentExamples){const base=policy(),candidate=applyPolicyEdits(base,example.json);validateRestatements(base,candidate,example.json.rule_restatements);}
 const base=policy(),candidate=applyPolicyEdits(base,{operations:[add('/parameters/local_limit',100000),add('/rules/4',restriction)],unresolved:[]});
 assert.throws(()=>validateRestatements(base,candidate,[]),/Missing/);
 assert.throws(()=>validateRestatements(base,candidate,[{rule_id:restriction.id,text:'one'},{rule_id:restriction.id,text:'two'}]),/Duplicate/);
 assert.throws(()=>editSchema.parse({operations:[],unresolved:[],rule_restatements:[{rule_id:'x',text:'one\ntwo'}]}));
});
