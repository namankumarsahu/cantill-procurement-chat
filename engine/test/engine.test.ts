import { test } from 'node:test';
import { Decimal } from 'decimal.js';
import assert from 'node:assert/strict';
import { processBatch, testCondition } from '../src/process.js';
import { matchDescription } from '../src/matching.js';
import { rankSuppliers } from '../src/ranking.js';
import { instant } from '../src/dates.js';
import { policy, master, line, contract } from './fixtures.js';

test('clubbing uses inclusive first-line windows, same plant, and emergency propagation', () => {
  const p = policy(), d = master();
  const result = processBatch(p,d,[
    line(3,{ created_at: '2026-11-17 09:00' }),
    line(2,{ created_at: '2026-11-16 11:00', need_by_date: '2026-11-27', urgency: 'Emergency' }),
    line(1), line(4,{ plant: 'Q' }),
  ]);
  const first = result.requirements[0];
  assert.deepEqual(first.lines.map(l => l.pr_no), ['TEST-001','TEST-002']);
  assert.equal(first.is_emergency,true);
  assert.equal(result.requirements.length,3);
  assert.deepEqual(result.rows.map(r => r.pr_no), ['TEST-003','TEST-002','TEST-001','TEST-004']);
});
test('need-by is measured against the anchor; a line qualifying twice joins the earliest', () => {
  const result = processBatch(policy(),master(),[line(1),line(2,{ need_by_date: '2026-11-30' }),line(3,{ need_by_date: '2026-11-25' })]);
  assert.equal(result.requirements.length,2);
  assert.deepEqual(result.requirements[0].lines.map(l => l.pr_no),['TEST-001','TEST-003']);
});
test('unknown items remain separate, use estimates, and get no suggestions', () => {
  const result = processBatch(policy(),master(),[line(1,{ item_code: '', description: 'Unrelated new gadget', estimated_unit_price: '12.25', quantity: '2' }),line(2,{ item_code: '', description: 'Unrelated new gadget', estimated_unit_price: '12.25' })]);
  assert.equal(result.requirements.length,2);
  assert.equal(result.requirements[0].group_value_inr,'24.50');
  assert.ok(result.rows.every(r => r.route === 'NEW_ITEM_SOURCING' && !r.suggested_supplier_ids));
});
test('invalid and conflicting duplicate rows are retained with explicit reasons', () => {
  const a = line(1), copy = { ...a, source_row: 3 };
  const r = processBatch(policy(),master(),[a,copy,line(3,{ quantity: '0' }),line(4,{ plant: 'missing' }),line(5,{ item_code: 'missing' }),line(6,{ uom: 'KG' }),line(7,{ created_at: '2026-02-30 10:00' }),line(8,{ need_by_date: '2026-11-01' })]);
  assert.equal(r.rows.length,8); assert.equal(r.rows.filter(x => x.route === 'NOT_PROCESSED').length,7);
  assert.ok(r.rows.slice(1).every(x => x.reason));
  const conflict = processBatch(policy(),master(),[a,{ ...copy, quantity: '2' }]);
  assert.ok(conflict.rows.every(x => x.route === 'NOT_PROCESSED'));
});
test('matching expands abbreviations and respects model numbers and ambiguous candidates', () => {
  const p = policy(), item = { ...master().items[0], description: 'Ball bearing 6205-2RS' };
  assert.equal(matchDescription('brg 6205 2rs',[item],p).status,'matched');
  assert.equal(matchDescription('brg 6308 zz',[item],p).status,'new');
  assert.equal(matchDescription(item.description,[item,{ ...item,item_code: 'OTHER' }],p).status,'ambiguous');
});
test('contract choice checks each full requirement at its own rate and shares ceilings across items', () => {
  const d = master(); d.contracts = [contract({ consumed_value: '95' }),contract({ contract_id: 'D', value_cap: '200', lines: [{ item_code: 'I',uom: 'NOS',rate: '12' }] })];
  const r = processBatch(policy(),d,[line(1)]);
  assert.equal(r.requirements[0].contract_id,'D'); assert.equal(r.rows[0].unit_price,'12');
  const shared = master(); shared.items.push({ ...shared.items[0], item_code: 'J', description: 'Other part' });
  shared.contracts = [contract({ lines: [{ item_code: 'I',rate: '60',uom: 'NOS' },{ item_code: 'J',rate: '60',uom: 'NOS' }] })];
  const s = processBatch(policy(),shared,[line(1),line(2,{ item_code: 'J' })]);
  assert.equal(s.rows[0].route,'CONTRACT_PO'); assert.equal(s.rows[1].route,'RFQ');
  assert.equal(s.rows[1].group_value_inr,'60.00'); assert.equal(s.contract_consumed.C,'60.00');
});
test('contract dates are inclusive, exhausted rates still value, and inactive contracts are excluded', () => {
  const d = master(); d.contracts = [contract({ start_date: '2026-11-02', end_date: '2026-11-02' })];
  assert.equal(processBatch(policy(),d,[line()]).rows[0].route,'CONTRACT_PO');
  d.contracts[0].consumed_value = '100';
  const exhausted = processBatch(policy(),d,[line()]);
  assert.equal(exhausted.rows[0].route,'SPOT_PO'); assert.equal(exhausted.rows[0].group_value_inr,'10.00');
  d.suppliers[0].status = 'Inactive';
  const inactive = processBatch(policy(),d,[line()]);
  assert.equal(inactive.rows[0].route,'RFQ'); assert.equal(inactive.rows[0].group_value_inr,'1.00');
  assert.ok(!inactive.rows[0].suggested_supplier_ids.includes('A'));
});
test('valuation uses the latest dated PO then standard price; future POs do not leak', () => {
  const d = master(); d.po_history.push({ ...d.po_history[0],po_number: 'FUTURE',po_date: '2026-11-03',unit_price: '999' });
  assert.equal(processBatch(policy(),d,[line()]).rows[0].group_value_inr,'1.00');
  d.po_history=[]; d.items[0].standard_price='2.55';
  assert.equal(processBatch(policy(),d,[line(1,{ quantity: '2' })]).rows[0].group_value_inr,'5.10');
});
test('rule order and exact value boundaries follow the policy data', () => {
  const p = policy(), d = master();
  const decide = (value: number, urgency = 'Normal') => processBatch(p,d,[line(1,{ quantity: String(value),urgency })]).rows[0].route;
  assert.equal(decide(p.parameters.spot_limit_inr-1),'SPOT_PO');
  assert.equal(decide(p.parameters.spot_limit_inr),'RFQ');
  assert.equal(decide(p.parameters.emergency_limit_inr,'Emergency'),'EMERGENCY_PO');
  assert.equal(decide(p.parameters.emergency_limit_inr+1,'Emergency'),'RFQ');
  assert.equal(decide(p.parameters.rfq_limit_inr),'RFP');
  d.items[0].item_type='Capex'; d.contracts=[contract()];
  const capex = processBatch(p,d,[line()]); assert.equal(capex.rows[0].route,'CAPEX_SOURCING'); assert.equal(capex.contract_consumed.C,'0.00');
});
test('a JSON threshold change and a plant-only restriction change outcomes without engine edits', () => {
  const p = policy(), d = master(), qty = p.parameters.spot_limit_inr;
  assert.equal(processBatch(p,d,[line(1,{ quantity:String(qty) })]).rows[0].route,'RFQ');
  p.parameters.spot_limit_inr += 1;
  assert.equal(processBatch(p,d,[line(1,{ quantity:String(qty) })]).rows[0].route,'SPOT_PO');
  p.parameters.plant_spot_limit_inr = qty/2;
  p.rules.push({ id: 'plant-restriction',clause: 'amendment',order:45,when: { all: [
    { fact:'plant',operator:'eq',value:'Q' },
    { fact:'requirement_value_inr',operator:'gte',value:{ parameter:'plant_spot_limit_inr' } },
    { fact:'requirement_value_inr',operator:'lt',value:{ parameter:'spot_limit_inr' } },
  ] },outcome:{ route:'RFQ' } });
  assert.deepEqual(processBatch(p,d,[line(1,{ quantity:String(qty),plant:'Q' }),line(2,{ quantity:String(qty),plant:'P' })]).rows.map(r=>r.route),['RFQ','SPOT_PO']);
  p.rules[p.rules.length-1].outcome.route='PLANT_REVIEW';
  p.route_registry.PLANT_REVIEW={ decision:'SOURCING_REQUEST',supplier_strategy:'none',suggest_count:0,flags:['plant_review'] };
  assert.equal(processBatch(p,d,[line(1,{ quantity:String(qty),plant:'Q' })]).rows[0].route,'PLANT_REVIEW');
});
test('consolidation anchors to the first requirement and excludes plant/route mismatches', () => {
  const d=master(); d.items.push({ ...d.items[0],item_code:'J' },{ ...d.items[0],item_code:'K' });
  for (const code of ['J','K']) d.po_history.push({ ...d.po_history[0],item_code:code,po_number:`H-${code}` });
  const r=processBatch(policy(),d,[line(1),line(2,{ item_code:'J',created_at:'2026-11-03 10:00' }),line(3,{ item_code:'K',created_at:'2026-11-03 10:01' }),line(4,{ plant:'Q' }),line(5,{ quantity:String(policy().parameters.spot_limit_inr),urgency:'Emergency',need_by_date:'2026-12-20' })]);
  assert.equal(r.rows[0].po_id,r.rows[1].po_id); assert.notEqual(r.rows[0].po_id,r.rows[2].po_id);
  assert.notEqual(r.rows[0].po_id,r.rows[3].po_id); assert.notEqual(r.rows[0].po_id,r.rows[4].po_id);
});
test('as-of cutoffs retain later rows, replay is deterministic, and inputs stay untouched', () => {
  const p=policy(),d=master(), rows=[line(),line(2,{ created_at:'2026-11-03 10:00' })], before=structuredClone({p,d,rows});
  const a=processBatch(p,d,rows,{ as_of_date:'2026-11-02' });
  assert.equal(a.rows[1].route,'NOT_PROCESSED'); assert.deepEqual(a,processBatch(p,d,rows,{ as_of_date:'2026-11-02' }));
  assert.deepEqual({p,d,rows},before); assert.ok(Number.isNaN(instant('2026-11-02 25:00')));
});
test('ranking excludes nonactive suppliers, records factors, and supports contract-only history', () => {
  const d=master(); d.contracts=[contract({ supplier_id:'B',end_date:'2026-01-02' })];
  const ranks=rankSuppliers(d.items[0],'2026-11-02',d,policy());
  assert.equal(ranks.length,2); assert.ok(ranks.every(r=>r.supplier_id!=='X'));
  const b=ranks.find(r=>r.supplier_id==='B')!; assert.equal(b.reference_price,'10'); assert.equal(b.factors.contract,1);
  assert.ok(b.reference_source.includes('contract')); assert.equal(Object.keys(b.contributions).length,5);
});
test('nested all/any/not, in, between, eq/ne and numeric operators are deterministic', () => {
  const p=policy();
  assert.equal(testCondition({ all:[{ any:[{ fact:'plant',operator:'in',value:['P','Q'] }] },{ not:{ fact:'item_type',operator:'eq',value:'Capex' } },{ fact:'requirement_value_inr',operator:'between',value:[1,3] },{ fact:'plant',operator:'ne',value:'Z' }] },{ plant:'P',item_type:'Material',requirement_value_inr:2 },p),true);
});

test('history windows include the lower boundary and exclude same-day/future purchases',()=>{
  const p=policy(),d=master(),asof='2026-11-02';
  const dateBefore=(days:number)=>new Date(Date.parse(`${asof}T00:00:00Z`)-days*86400000).toISOString().slice(0,10);
  d.po_history[0].po_date=dateBefore(p.parameters.eligibility_history_days);
  assert.equal(processBatch(p,d,[line()]).rows[0].route,'SPOT_PO');
  d.po_history[0].po_date=dateBefore(p.parameters.eligibility_history_days+1);
  assert.equal(processBatch(p,d,[line()]).rows[0].route,'RFQ');
  d.po_history[0].po_date=dateBefore(p.parameters.preferred_history_days);
  assert.equal(rankSuppliers(d.items[0],asof,d,p).length,1);
  d.po_history[0].po_date=dateBefore(p.parameters.preferred_history_days+1);
  assert.equal(rankSuppliers(d.items[0],asof,d,p).length,0);
  d.po_history[0].po_date=asof;
  assert.equal(processBatch(p,d,[line()]).rows[0].route,'RFQ');
});
test('contract wins before Emergency and decimal rounding never promotes a value below a limit',()=>{
  const p=policy(),d=master();d.contracts=[contract()];
  assert.equal(processBatch(p,d,[line(1,{urgency:'Emergency'})]).rows[0].route,'CONTRACT_PO');
  d.contracts=[];d.po_history[0].unit_price='0.1';
  const qty=new Decimal(p.parameters.spot_limit_inr).minus('0.01').div('0.1').toString();
  assert.equal(processBatch(p,d,[line(1,{quantity:qty})]).rows[0].route,'SPOT_PO');
});
