import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { readFile } from 'node:fs/promises';
import { transaction } from './db.js';
import { validatePolicy, type Policy } from '../../engine/src/policy.js';
import type { MasterData, Contract } from '../../engine/src/types.js';
import type { KitImport } from './import-kit.js';

export async function loadSeedPolicy(): Promise<Policy> {
  return validatePolicy(JSON.parse(await readFile(new URL('../policies/v5.0.json', import.meta.url), 'utf8')));
}
export async function ensureSeedPolicy(pool: pg.Pool): Promise<void> {
  const policy = await loadSeedPolicy();
  await pool.query('INSERT INTO policy_versions(version,effective_date,status,document,created_by,approved_by,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(version) DO NOTHING',
    [policy.version, policy.effective_date, policy.status, policy, policy.created_by, policy.approved_by, policy.approved_at]);
}
async function insertRows(client: pg.PoolClient, table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  if (![table, ...keys].every(k => /^[a-z_][a-z0-9_]*$/.test(k))) throw new Error('Unsafe internal SQL identifier');
  for (let offset = 0; offset < rows.length; offset += 500) {
    const chunk = rows.slice(offset, offset + 500);
    const values = chunk.flatMap(row => keys.map(k => row[k]));
    const placeholders = chunk.map((_, i) => `(${keys.map((_, j) => `$${i * keys.length + j + 1}`).join(',')})`).join(',');
    await client.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES ${placeholders}`, values);
  }
}
export async function saveImport(pool: pg.Pool, kit: KitImport, actor: string): Promise<{ import_id: string; reused: boolean; counts: Record<string, number>; warnings: string[]; batch_id?: string }> {
  const counts = { items: kit.data.items.length, suppliers: kit.data.suppliers.length, plants: kit.data.plants.length, po_history: kit.data.po_history.length, contracts: kit.data.contracts.length, contract_lines: kit.data.contracts.reduce((n,c) => n+c.lines.length, 0), documents: kit.documents.length, pr_lines: kit.batch.length };
  return transaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('corvo_import'))");
    const old = await client.query('SELECT id FROM imports WHERE fingerprint=$1', [kit.fingerprint]);
    if (old.rowCount) return { import_id: old.rows[0].id, reused: true, counts, warnings: kit.warnings };
    const import_id = randomUUID();
    await client.query('INSERT INTO imports(id,fingerprint,snapshot_date,actor,counts,warnings) VALUES($1,$2,$3,$4,$5,$6)', [import_id, kit.fingerprint, kit.snapshot_date, actor, counts, JSON.stringify(kit.warnings)]);
    const withImport = (rows: object[]) => rows.map(r => ({ import_id, ...r }));
    await insertRows(client, 'plants', withImport(kit.data.plants));
    await insertRows(client, 'items', withImport(kit.data.items));
    await insertRows(client, 'suppliers', withImport(kit.data.suppliers));
    await insertRows(client, 'po_history', withImport(kit.data.po_history));
    await insertRows(client, 'contracts', withImport(kit.data.contracts.map(({ lines: _, ...c }) => c)));
    await insertRows(client, 'contract_lines', withImport(kit.data.contracts.flatMap(c => c.lines.map(l => ({ contract_id: c.contract_id, ...l })))));
    await insertRows(client, 'source_documents', withImport(kit.documents.map(({ text, ...d }) => ({ ...d, source_text: text }))));
    let batch_id: string | undefined;
    if (kit.batch.length) {
      batch_id = randomUUID();
      await client.query('INSERT INTO batches(id,import_id,filename,actor) VALUES($1,$2,$3,$4)', [batch_id, import_id, 'sample_pr_batch.csv', actor]);
      await insertRows(client, 'pr_lines', kit.batch.map(row => ({ batch_id, source_row: row.source_row, raw: row })));
    }
    await client.query('INSERT INTO audit_events(actor,action,after) VALUES($1,$2,$3)', [actor, 'IMPORT_MASTER_DATA', { import_id, counts, warnings: kit.warnings }]);
    return { import_id, batch_id, reused: false, counts, warnings: kit.warnings };
  });
}
export async function loadMasterData(client: pg.Pool | pg.PoolClient, importId?: string): Promise<{ import_id: string; data: MasterData }> {
  const result = importId ? await client.query('SELECT id FROM imports WHERE id=$1', [importId]) : await client.query('SELECT id FROM imports ORDER BY created_at DESC,id DESC LIMIT 1');
  if (!result.rowCount) throw new Error('Import master data before processing');
  const import_id = result.rows[0].id as string;
  const read = async (table: string) => (await client.query(`SELECT * FROM ${table} WHERE import_id=$1`, [import_id])).rows.map(({ import_id: _, ...row }) => row);
  const items = await read('items'), suppliers = await read('suppliers'), plants = await read('plants'), po_history = await read('po_history'), contracts = await read('contracts'), lines = await read('contract_lines');
  const data = {
    items, suppliers: suppliers.map(s => ({ ...s, on_time_pct: Number(s.on_time_pct), quality_rating: Number(s.quality_rating) })), plants, po_history,
    contracts: contracts.map(c => ({ ...c, lines: lines.filter(l => l.contract_id === c.contract_id).map(({ contract_id: _, ...l }) => l) })) as Contract[],
  } as MasterData;
  return { import_id, data };
}
