import { createPool } from './db.js';
import { loadEnv, migrate } from './migrate.js';
import { ensureSeedPolicy } from './repository.js';
import { createApp } from './app.js';

loadEnv();
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_TOKEN) throw new Error('ADMIN_TOKEN is required in production');
const pool = createPool();
await migrate(pool); await ensureSeedPolicy(pool);
const port = Number(process.env.PORT || 3000);
const host = process.env.ADMIN_TOKEN ? '0.0.0.0' : '127.0.0.1';
const server = createApp(pool).listen(port, host, () => console.log(`Corvo API: http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => { void pool.end(); }));
