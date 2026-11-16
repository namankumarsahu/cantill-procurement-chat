import {test} from 'node:test';
import assert from 'node:assert/strict';
import { decisionsCSV } from '../src/export.js';
import { exportColumns,type ExportRow } from '../../engine/src/process.js';
import { readCSV } from '../src/csv.js';
test('CSV preserves column order, delimiters, quotes and multiline reasons, and escapes formulas',()=>{
  const row=Object.fromEntries(exportColumns.map(c=>[c,''])) as ExportRow;
  Object.assign(row,{pr_no:'=DANGEROUS()',pr_line:'1',route:'NOT_PROCESSED',reason:'A "quoted", reason\nwith another line',suggested_supplier_ids:'A;B'});
  const csv=decisionsCSV([row]);
  assert.equal(csv.split('\r\n')[0],exportColumns.join(','));
  const [parsed]=readCSV(csv,[...exportColumns]);
  assert.equal(parsed.pr_no,"'=DANGEROUS()");assert.equal(parsed.reason,row.reason);assert.equal(parsed.suggested_supplier_ids,'A;B');
});

test('CSV rounds only group values half-up to whole rupees and leaves internal values untouched',()=>{
  const amounts=['32546.60','220255.60','100.49','100.50','100.00',''];
  const rows=amounts.map(amount=>({ ...Object.fromEntries(exportColumns.map(c=>[c,''])),group_value_inr:amount,unit_price:'7.06' } as ExportRow));
  const before=structuredClone(rows);
  const parsed=readCSV(decisionsCSV(rows),[...exportColumns]);
  assert.deepEqual(parsed.map(r=>r.group_value_inr),['32547','220256','100','101','100','']);
  assert.ok(parsed.every(r=>r.unit_price==='7.06'));
  assert.deepEqual(rows,before);
});
