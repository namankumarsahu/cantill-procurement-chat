import {test} from 'node:test';
import assert from 'node:assert/strict';
import {master,policy,contract} from '../../engine/test/fixtures.js';
import {preferredSupplierLists} from '../../engine/src/ranking.js';
import {preferredCSV,preferredColumns} from '../src/supplier-api.js';
import {readCSV} from '../src/csv.js';
test('dated lists exclude future contracts and nonactive suppliers and explain reference prices',()=>{
 const d=master(),p=policy();d.contracts=[contract({supplier_id:'B',start_date:'2026-11-03'}),contract({contract_id:'X',supplier_id:'X'})];
 const before=preferredSupplierLists(d,'2026-11-02',p)[0];assert.deepEqual(before.suppliers.map(s=>s.supplier_id),['A']);
 const after=preferredSupplierLists(d,'2026-11-03',p)[0];assert.equal(after.suppliers.length,2);
 const b=after.suppliers.find(s=>s.supplier_id==='B')!;assert.equal(b.reference_price,'10');assert.match(b.reference_source,/contract/);assert.equal(Object.keys(b.contributions).length,5);
});
test('ranking responds to configured weights and CSV exports only top three with exact columns',()=>{
 const d=master(),p=policy();
 for(const id of ['B','C','D']){if(!d.suppliers.some(s=>s.supplier_id===id))d.suppliers.push({...d.suppliers[0],supplier_id:id});d.po_history.push({...d.po_history[0],po_number:id,supplier_id:id});}
 assert.equal(preferredSupplierLists(d,'2026-11-02',p)[0].suppliers[0].supplier_id,'B');
 p.ranking.weights.on_time=.2;p.ranking.weights.quality=0;
 const lists=preferredSupplierLists(d,'2026-11-02',p);assert.equal(lists[0].suppliers[0].supplier_id,'A');
 const csv=preferredCSV(lists);assert.equal(csv.split('\r\n')[0],preferredColumns.join(','));assert.equal(readCSV(csv,preferredColumns).length,3);
});
