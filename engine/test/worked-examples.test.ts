import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectKit,readKitDirectory } from '../../server/src/import-kit.js';
import { loadSeedPolicy } from '../../server/src/repository.js';
import { processBatch } from '../src/process.js';
import { rankSuppliers } from '../src/ranking.js';
import { workedCases,checkWorked } from './worked-support.js';

const root=resolve(process.env.KIT_DATA_DIR || 'kit_data');
const available=existsSync(resolve(root,'master_data/item_master.csv'));
const setup=available ? Promise.all([inspectKit(await readKitDirectory(root)),loadSeedPolicy()]).then(([kit,p])=>({kit,p,result:processBatch(p,kit.data,kit.batch)})) : undefined;
for (const c of workedCases) test(`Worked example ${c.number}: ${c.name}`,{skip:!available},async()=>{
  const {result}=await setup!; assert.deepEqual(checkWorked(result,c),[]);
});
test('three published preferred-list examples match the configured ranking formula',{skip:!available},async()=>{
  const {kit,p}=await setup!;
  for (const [item,expected] of [['ITM-1048',['S029','S030']],['ITM-1036',['S023','S022','S024']],['ITM-1016',['S009','S010']]] as const) {
    assert.deepEqual(rankSuppliers(kit.data.items.find(i=>i.item_code===item)!,'2026-11-01',kit.data,p).map(r=>r.supplier_id),expected);
  }
});
test('whole batch retains 186 rows and only the two known invalid rows are unprocessed',{skip:!available},async()=>{
  const {kit,p,result}=await setup!;
  assert.equal(result.rows.length,186);
  assert.deepEqual(result.rows.filter(r=>r.route==='NOT_PROCESSED').map(r=>r.pr_no),['PR-26-00172','PR-26-00173']);
  const active=new Set(kit.data.suppliers.filter(s=>s.status==='Active').map(s=>s.supplier_id));
  for (const r of result.rows) { if (r.supplier_id) assert.ok(active.has(r.supplier_id)); for (const id of r.suggested_supplier_ids.split(';').filter(Boolean)) assert.ok(active.has(id)); }
  assert.deepEqual(result,processBatch(p,kit.data,kit.batch));
  assert.ok(result.purchase_orders.every(po=>/^PO-\d{4}$/.test(po.po_id)));
});
