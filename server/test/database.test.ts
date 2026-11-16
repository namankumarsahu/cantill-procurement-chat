import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../src/migrate.js';
import { ensureSeedPolicy, loadMasterData, saveImport } from '../src/repository.js';
import { createApp } from '../src/app.js';
import type { KitImport } from '../src/import-kit.js';
import { stringify } from 'csv-stringify/sync';
import { prColumns,readCSV } from '../src/csv.js';
import { exportColumns } from '../../engine/src/process.js';
import { line } from '../../engine/test/fixtures.js';
import { loadSeedPolicy } from '../src/repository.js';

test('PostgreSQL migration, atomic/idempotent import, round trip, and admin protection', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  const kit: KitImport = {
    fingerprint: 'synthetic-fixture', snapshot_date: '2026-01-01', batch: [], documents: [{ filename: 'synthetic.pdf', sha256: 'synthetic-hash', bytes: Buffer.from('fixture'), text: 'Synthetic source' }], warnings: [],
    data: { items: [{ item_code: 'I', description: 'Synthetic part', category: 'Parts', item_type: 'Material', uom: 'NOS', standard_price: '10.25' }],
      suppliers: [{ supplier_id: 'S', name: 'Synthetic supplier', city: 'Test', categories: ['Parts'], status: 'Active', on_time_pct: 90, quality_rating: 4 }],
      plants: [{ plant: 'P', name: 'Synthetic plant' }], po_history: [], contracts: [] },
  };
  try {
    await migrate(pool); await migrate(pool); await ensureSeedPolicy(pool); await ensureSeedPolicy(pool);
    const first = await saveImport(pool, kit, 'test');
    const second = await saveImport(pool, kit, 'test');
    assert.equal(first.import_id, second.import_id); assert.equal(second.reused, true);
    assert.deepEqual((await loadMasterData(pool)).data, kit.data);
    const broken = structuredClone(kit); broken.fingerprint = 'broken'; broken.data.po_history.push({ po_number: 'bad', supplier_id: 'missing', item_code: 'I', quantity: '1', uom: 'NOS', unit_price: '10', po_date: '2026-01-02', plant: 'P', delivered_on_time: true });
    await assert.rejects(saveImport(pool, broken, 'test'));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM imports')).rows[0].n, 1);
    const server = createApp(pool, 'test-token').listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as { port: number };
    try {
      const url = `http://127.0.0.1:${address.port}`;
      assert.equal((await fetch(`${url}/api/health`)).status, 200);
      const suppliersResponse=await fetch(`${url}/api/preferred-suppliers?as_of_date=2026-11-02`);
      assert.equal(suppliersResponse.status,200);const suppliers=await suppliersResponse.json();assert.equal(suppliers.items.length,1);assert.deepEqual(suppliers.items[0].suppliers,[]);
      const supplierExport=await fetch(`${url}/api/preferred-suppliers/export?as_of_date=2026-11-02`);assert.equal(supplierExport.status,200);assert.equal((await supplierExport.text()).trim(),'item_code,rank,supplier_id,reference_price');
      assert.equal((await fetch(`${url}/api/preferred-suppliers?as_of_date=bad`)).status,400);

      assert.equal((await fetch(`${url}/api/admin/import-master`, { method: 'POST' })).status, 401);
      const scheduled=await loadSeedPolicy(); scheduled.version='future-approved'; scheduled.effective_date='2027-01-01';
      await pool.query('INSERT INTO policy_versions(version,effective_date,status,document,created_by,approved_by,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[scheduled.version,scheduled.effective_date,scheduled.status,scheduled,scheduled.created_by,scheduled.approved_by,scheduled.approved_at]);
      const body=new FormData();
      const csv=stringify([line(1,{quantity:'2'}),line(2,{quantity:'0'})],{header:true,columns:[...prColumns]});
      body.set('file',new Blob([csv],{type:'text/csv'}),'synthetic.csv');
      body.set('params',JSON.stringify({as_of_date:'2026-11-02',policy_version:'5.0',import_id:first.import_id}));
      const processed=await fetch(`${url}/api/process-batch`,{method:'POST',headers:{'x-actor':'buyer-test'},body});
      const run=await processed.json();
      assert.equal(processed.status,200,JSON.stringify(run));
      assert.equal(run.rows.length,2); assert.equal(run.rows[0].group_value_inr,'20.50');
      assert.equal(run.rows[1].route,'NOT_PROCESSED'); assert.ok(run.rows[1].reason);
      assert.equal(run.policy_version,'5.0');
      const exported=await fetch(`${url}${run.export_url}`);
      assert.equal(exported.status,200); assert.match(exported.headers.get('content-type')!,/text\/csv/);
      const text=await exported.text(); assert.equal(text.split('\r\n')[0],exportColumns.join(','));
      const roundTrip=readCSV(text,[...exportColumns]); assert.equal(roundTrip.length,2);
      assert.equal(roundTrip[0].group_value_inr,'21');
      assert.equal(run.rows[0].group_value_inr,'20.50');
      const {group_value_inr: csvValue,...csvFields}=roundTrip[0];
      const {group_value_inr: apiValue,...apiFields}=run.rows[0];
      assert.deepEqual(csvFields,apiFields);
      assert.deepEqual(roundTrip[1],run.rows[1]);
      assert.equal((await fetch(`${url}/api/runs/${run.run_id}`)).status,200);
      assert.equal((await pool.query('SELECT count(*)::int n FROM processing_runs')).rows[0].n,1);
      assert.equal((await pool.query('SELECT count(*)::int n FROM pr_lines')).rows[0].n,2);
      const replay=new FormData(); replay.set('file',new Blob([csv]),'replay.csv'); replay.set('as_of_date','2026-11-02');
      const replayResponse=await fetch(`${url}/api/process-batch`,{method:'POST',body:replay});
      const replayRun=await replayResponse.json(); assert.equal(replayResponse.status,200,JSON.stringify(replayRun));
      assert.equal(replayRun.policy_version,'5.0'); assert.deepEqual(replayRun.rows,run.rows);assert.equal(replayRun.run_id,run.run_id);assert.equal(replayRun.batch_id,run.batch_id);assert.equal(replayRun.replaced,true);
      const future=new FormData();future.set('file',new Blob([csv]),'future.csv');future.set('policy_version','future-approved');future.set('as_of_date','2026-11-02');
      assert.equal((await fetch(`${url}/api/process-batch`,{method:'POST',body:future})).status,400);

      const bad=new FormData(); bad.set('file',new Blob(['wrong\nvalue']),'bad.csv');
      assert.equal((await fetch(`${url}/api/process-batch`,{method:'POST',body:bad})).status,400);
      const draft=new FormData(); draft.set('file',new Blob([csv]),'synthetic.csv'); draft.set('params','{"policy_version":"not-approved"}');
      assert.equal((await fetch(`${url}/api/process-batch`,{method:'POST',body:draft})).status,400);
      assert.equal((await pool.query('SELECT count(*)::int n FROM processing_runs')).rows[0].n,1);

    } finally { await new Promise<void>((resolve,reject) => server.close(e => e ? reject(e) : resolve())); }
  } finally {
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
