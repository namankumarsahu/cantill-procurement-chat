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
