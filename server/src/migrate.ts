import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { createPool, transaction } from './db.js';

export function loadEnv(): void {
  try { process.loadEnvFile(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
export async function migrate(pool: pg.Pool): Promise<void> {
  await transaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('corvo_migrations'))");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const dir = new URL('../migrations/', import.meta.url);
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) {
      if ((await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount) continue;
      await client.query(await readFile(new URL(name, dir), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnv(); const pool = createPool();
  try { await migrate(pool); console.log('Migrations complete'); } finally { await pool.end(); }
}
