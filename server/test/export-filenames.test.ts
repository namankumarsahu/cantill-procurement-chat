import {test} from 'node:test';import assert from 'node:assert/strict';
import {stringify} from 'csv-stringify/sync';
import {withApp} from './policy-fixture.js';
import {line} from '../../engine/test/fixtures.js';
import {exportColumns} from '../../engine/src/process.js';
import {prColumns} from '../src/csv.js';
import {exportFilename} from '../src/export-filename.js';
test('export prefix is validated and environment defaults do not alter CSV data',()=>{
 const old=process.env.EXPORT_FILENAME_PREFIX;
 try{delete process.env.EXPORT_FILENAME_PREFIX;assert.equal(exportFilename(undefined,'run1','legacy.csv'),'legacy.csv');process.env.EXPORT_FILENAME_PREFIX='my_name';assert.equal(exportFilename(undefined,'preferred','legacy.csv'),'my_name__preferred.csv');assert.equal(exportFilename('buyer-2','run2','legacy.csv'),'buyer-2__run2.csv');for(const value of ['','../x','bad\r\nheader','name.csv','x'.repeat(61)])assert.throws(()=>exportFilename(value,'run1','legacy.csv'));}
 finally{if(old===undefined)delete process.env.EXPORT_FILENAME_PREFIX;else process.env.EXPORT_FILENAME_PREFIX=old;}
});
test('one-click run1, run2 and preferred downloads have exact filenames and original headers',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 await withApp(undefined,async(url)=>{
  const form=new FormData();form.set('file',new Blob([stringify([line()],{header:true,columns:[...prColumns]})]),'batch.csv');const response=await fetch(url+'/api/process-batch',{method:'POST',body:form});assert.equal(response.status,200);const run=await response.json();let csv='';
  for(const label of ['run1','run2']){const r=await fetch(url+run.export_url+`?prefix=yourname&run=${label}`);assert.equal(r.status,200);assert.equal(r.headers.get('content-disposition')?.replaceAll('"',''),`attachment; filename=yourname__${label}.csv`);const body=await r.text();assert.equal(body.split('\r\n')[0],exportColumns.join(','));if(csv)assert.equal(body,csv);csv=body;}
  const suppliers=await fetch(url+'/api/preferred-suppliers/export?as_of_date=2026-11-02&prefix=yourname');assert.equal(suppliers.status,200);assert.equal(suppliers.headers.get('content-disposition')?.replaceAll('"',''),'attachment; filename=yourname__preferred.csv');assert.equal((await suppliers.text()).split('\r\n')[0],'item_code,rank,supplier_id,reference_price');
  assert.equal((await fetch(url+run.export_url+'?prefix=..%2Fbad&run=run1')).status,400);assert.equal((await fetch(url+run.export_url+'?prefix=valid&run=bad')).status,400);
  assert.equal((await fetch(url+'/api/preferred-suppliers/export?as_of_date=2026-11-02&prefix=..%2Fbad')).status,400);
  for(const path of ['/api/admin/import-master','/api/admin/policies/5.0/approve'])assert.equal((await fetch(url+path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
 });
});
