import {test} from 'node:test';import assert from 'node:assert/strict';
import {master,policy,line,contract} from './fixtures.js';
import {processBatch,testCondition} from '../src/process.js';
import {validatePolicy} from '../src/policy.js';
function amendment(source:'requirement.earliest_need_by_date'|'requirement.days_until_need_by'|'preferred_supplier.on_time_pct'|'preferred_supplier.quality_rating'|'contract_supplier.on_time_pct'|'contract_supplier.quality_rating',operator:'lt'|'lte'|'gt'|'gte',value:string|number){
 const p=policy();p.fact_registry.check={type:source.endsWith('_date')?'date':'number',source};p.route_registry.REVIEW={decision:'SOURCING_REQUEST',supplier_strategy:'none',suggest_count:0,flags:[]};p.rules.push({id:'fact-review',clause:'amendment',order:25,when:{fact:'check',operator,value},outcome:{route:'REVIEW'}});return validatePolicy(p);
}
test('date and days facts use the earliest grouped need-by and original creation date',()=>{
 const d=master(),rows=[line(1,{need_by_date:'2026-11-08'}),line(2,{need_by_date:'2026-11-04'})];
 for(const p of [amendment('requirement.earliest_need_by_date','lte','2026-11-04'),amendment('requirement.days_until_need_by','lte',2)]){const result=processBatch(p,d,rows);assert.equal(result.requirements.length,1);assert.equal(result.rows[0].route,'REVIEW');}
 assert.equal(processBatch(amendment('requirement.days_until_need_by','lt',2),d,rows).rows[0].route,'SPOT_PO');
 assert.throws(()=>amendment('requirement.earliest_need_by_date','lt','2026-02-30'),/comparison needs/);
});
test('supplier facts distinguish preferred from usable contract and exclude nonactive suppliers',()=>{
 const d=master();d.contracts=[contract({supplier_id:'B'})];
 assert.equal(processBatch(amendment('preferred_supplier.on_time_pct','gte',90),d,[line()]).rows[0].route,'REVIEW');
 assert.equal(processBatch(amendment('contract_supplier.on_time_pct','lt',85),d,[line()]).rows[0].route,'REVIEW');
 assert.equal(processBatch(amendment('preferred_supplier.quality_rating','gte',4),d,[line()]).rows[0].route,'REVIEW');
 assert.equal(processBatch(amendment('contract_supplier.quality_rating','gte',5),d,[line()]).rows[0].route,'REVIEW');
 d.suppliers.find(s=>s.supplier_id==='B')!.status='Blocked';assert.equal(processBatch(amendment('contract_supplier.on_time_pct','lt',85),d,[line()]).rows[0].route,'SPOT_PO');
});
test('missing supplier ratings do not match comparisons, including nested negation',()=>{
 const d=master();d.po_history=[];const p=amendment('preferred_supplier.on_time_pct','lt',90),rule=p.rules.find(r=>r.id==='fact-review')!;
 rule.when={not:{fact:'check',operator:'lt',value:90}};
 assert.equal(testCondition(rule.when,{check:null},p),undefined);assert.equal(processBatch(p,d,[line()]).rows[0].route,'RFQ');
 assert.equal(testCondition({all:[{fact:'check',operator:'gt',value:0},{fact:'check',operator:'lt',value:90}]},{check:null},p),undefined);
 assert.equal(testCondition({any:[{fact:'check',operator:'gt',value:0},{fact:'check',operator:'lt',value:90}]},{check:null},p),undefined);
});
