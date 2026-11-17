import {test} from 'node:test';
import assert from 'node:assert/strict';
import { decisionsCSV } from '../src/export.js';
import { exportColumns,type ExportRow } from '../../engine/src/process.js';
import { readCSV } from '../src/csv.js';
test('CSV preserves column order, delimiters, quotes and multiline reasons, and escapes formulas',()=>{
  const row=Object.fromEntries(exportColumns.map(c=>[c,''])) as ExportRow;
  Object.assign(row,{pr_no:'=DANGEROUS()',pr_line:'1',route:'RFQ',reason:'A "quoted", reason\nwith another line',suggested_supplier_ids:'A;B'});
  const csv=decisionsCSV([row]);
  assert.equal(csv.split('\r\n')[0],exportColumns.join(','));
  const [parsed]=readCSV(csv,[...exportColumns]);
  assert.equal(parsed.pr_no,"'=DANGEROUS()");assert.equal(parsed.reason,row.reason);assert.equal(parsed.suggested_supplier_ids,'A;B');
});

test('NOT_PROCESSED exports clear purchasing fields while preserving known identity and reasons, including saved legacy rows',()=>{
 const empty=Object.fromEntries(exportColumns.map(c=>[c,''])) as ExportRow;
 const rows=[
  {...empty,pr_no:'KNOWN',pr_line:'1',resolved_item_code:'I',route:'NOT_PROCESSED',decision:'SOURCING_REQUEST',supplier_id:'A',unit_price:'12.50',po_id:'PO-OLD',suggested_supplier_ids:'A;B',policy_version:'5.0',reason:'Quantity must be a positive number'},
  {...empty,pr_no:'UNKNOWN',pr_line:'1',route:'NOT_PROCESSED',decision:'SOURCING_REQUEST',policy_version:'5.0',reason:'Unknown explicit item code: missing'},
  {...empty,pr_no:'VALID',pr_line:'1',resolved_item_code:'I',route:'SPOT_PO',decision:'PO',supplier_id:'A',unit_price:'12.50',po_id:'PO-0001',policy_version:'5.0',reason:'Valid purchase'},
 ];
 const before=structuredClone(rows),parsed=readCSV(decisionsCSV(rows),[...exportColumns]);
 for(const [i,row]of parsed.slice(0,2).entries()){
  for(const field of ['decision','supplier_id','unit_price','po_id','suggested_supplier_ids'])assert.equal(row[field],'');
  for(const field of ['pr_no','pr_line','resolved_item_code','route','policy_version','reason'])assert.equal(row[field],rows[i][field as keyof ExportRow]);
 }
 assert.deepEqual(parsed[2],rows[2]);assert.deepEqual(rows,before);
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
