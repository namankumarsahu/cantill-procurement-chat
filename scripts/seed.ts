import { createPool } from '../server/src/db.js';
import { loadEnv, migrate } from '../server/src/migrate.js';
import { readKitDirectory, inspectKit } from '../server/src/import-kit.js';
import { ensureSeedPolicy, saveImport } from '../server/src/repository.js';

loadEnv();
const root = process.argv[2];
if (!root) throw new Error('Usage: npm run seed -- ./kit_data [--snapshot-date=YYYY-MM-DD]');
const date = process.argv.find(a => a.startsWith('--snapshot-date='))?.split('=')[1];
const kit = await inspectKit(await readKitDirectory(root), date);
const pool = createPool();
try {
  await migrate(pool); await ensureSeedPolicy(pool);
  console.log(JSON.stringify(await saveImport(pool, kit, process.env.SEED_ACTOR || 'seed-cli'), null, 2));
} finally { await pool.end(); }
