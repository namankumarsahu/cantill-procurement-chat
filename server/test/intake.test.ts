import {test}from'node:test';import assert from'node:assert/strict';
import {master,policy}from'../../engine/test/fixtures.js';
import {emptyIntake,intakeTurn,type IntakeParser}from'../src/intake.js';
import {withApp}from'./policy-fixture.js';
const emptyParser:IntakeParser=async()=>({description:null,quantity:null,plant:null,need_by_date:null,urgency:null,estimated_unit_price:null,uom:null});
const data=()=>{const d=master();d.items.push({...d.items[0],item_code:'B10',description:'Hex bolt M10x40'},{...d.items[0],item_code:'B12',description:'Hex bolt M12x50'});return d;};
test('vague red bolts asks for a specification instead of selecting an item or becoming NEW',async()=>{
 const r=await intakeTurn('the red bolts',emptyIntake(),data(),policy(),'2026-11-16',emptyParser);assert.equal(r.ready,false);assert.equal(r.item,undefined);assert.equal(r.is_new,false);assert.match(r.question,/Which item/);assert.equal(r.candidates.length,2);
 const hallucinating:IntakeParser=async()=>({...await emptyParser('',emptyIntake(),''),description:'Hex bolt M10x40'});const protectedTurn=await intakeTurn('the red bolts',emptyIntake(),data(),policy(),'2026-11-16',hallucinating);assert.equal(protectedTurn.item,undefined);assert.match(protectedTurn.question,/Which item/);
});
test('missing quantity, plant and date each trigger a follow-up',async()=>{
 let state=emptyIntake();let r=await intakeTurn('I',state,data(),policy(),'2026-11-16',emptyParser);assert.match(r.question,/quantity/i);
 r=await intakeTurn('quantity 2',r.state,data(),policy(),'2026-11-16',emptyParser);assert.match(r.question,/Which plant/);
 r=await intakeTurn('P',r.state,data(),policy(),'2026-11-16',emptyParser);assert.match(r.question,/need-by date/);
 r=await intakeTurn('2099-01-01',r.state,data(),policy(),'2026-11-16',emptyParser);assert.match(r.question,/Normal or Emergency/);
 r=await intakeTurn('Normal',r.state,data(),policy(),'2026-11-16',emptyParser);assert.equal(r.ready,true);assert.match(r.question,/confirm/i);
});
test('unknown description becomes NEW and requires an estimated price and UOM',async()=>{
 const r=await intakeTurn('need 2 experimental widgets for P by 2099-01-01 Normal',emptyIntake(),data(),policy(),'2026-11-16',emptyParser);assert.equal(r.is_new,true);assert.equal(r.item,undefined);assert.match(r.question,/estimated unit price/);
 const price=await intakeTurn('price 250',r.state,data(),policy(),'2026-11-16',emptyParser);assert.match(price.question,/unit of measure/);
 const complete=await intakeTurn('UOM NOS',price.state,data(),policy(),'2026-11-16',emptyParser);assert.equal(complete.ready,true);assert.match(complete.question,/NEW/);
});
test('no-key mode and invalid parser output retain deterministic intake',async()=>{
 const saved=process.env.LLM_API_KEY;delete process.env.LLM_API_KEY;
 try{const r=await intakeTurn('need 2 Synthetic component for P by tomorrow Normal',emptyIntake(),master(),policy(),'2026-11-16');assert.equal(r.degraded,true);assert.equal(r.ready,true);assert.equal(r.state.fields.need_by_date,'2026-11-17');}finally{if(saved!==undefined)process.env.LLM_API_KEY=saved;}
 const failed=await intakeTurn('need 3 Synthetic component for P by next Friday Normal',emptyIntake(),master(),policy(),'2026-11-16',async()=>{throw new Error('provider unavailable');});assert.equal(failed.degraded,true);assert.equal(failed.ready,true);assert.equal(failed.state.fields.need_by_date,'2026-11-20');
});
test('chat confirmation creates one PR/run, NEW sourcing is deterministic, and acting-user ownership is enforced',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 await withApp(undefined,async(url,pool)=>{
  const headers={'x-actor':'requester-one','x-role':'requester','content-type':'application/json'};
  const session=await fetch(url+'/api/chat/sessions',{method:'POST',headers}).then(r=>r.json());
  async function say(text:string){const r=await fetch(url+`/api/chat/sessions/${session.id}/messages`,{method:'POST',headers,body:JSON.stringify({text})});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body;}
  let r=await say('need 2 experimental widgets for P by 2099-01-01 Normal');assert.equal(r.state.stage,'collecting');
  r=await say('price 15');r=await say('UOM NOS');assert.equal(r.state.stage,'confirmation');assert.equal((await pool.query('SELECT count(*)::int n FROM processing_runs')).rows[0].n,0);
  const created=await say('confirm'),again=await say('confirm');assert.equal(created.pr_no,again.pr_no);assert.equal(created.run_id,again.run_id);
  const result=(await pool.query('SELECT result FROM processing_runs WHERE id=$1',[created.run_id])).rows[0].result;assert.equal(result.rows[0].route,'NEW_ITEM_SOURCING');assert.equal(result.rows[0].group_value_inr,'30.00');assert.equal(result.rows[0].resolved_item_code,'NEW');
  assert.equal((await pool.query('SELECT count(*)::int n FROM procurement_documents')).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE actor='requester-one' AND role='requester' AND action='PR_CREATED'")).rows[0].n,1);
  assert.equal((await fetch(url+`/api/chat/sessions/${session.id}/messages`,{method:'POST',headers:{...headers,'x-actor':'different-user'},body:JSON.stringify({text:'confirm'})})).status,400);
 },{intakeParser:emptyParser});
});
