import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../src/migrate.js';
import { ensureSeedPolicy, loadMasterData, saveImport } from '../src/repository.js';
import { createApp } from '../src/app.js';
import type { KitImport } from '../src/import-kit.js';

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
      assert.equal((await fetch(`${url}/api/admin/import-master`, { method: 'POST' })).status, 401);
    } finally { await new Promise<void>((resolve,reject) => server.close(e => e ? reject(e) : resolve())); }
  } finally {
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
