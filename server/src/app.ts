import express from 'express';
import multer from 'multer';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import type pg from 'pg';
import { inspectKit, readKitZip } from './import-kit.js';
import { saveImport } from './repository.js';

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 } });
export function actor(req: express.Request): string {
  const value = req.get('x-actor')?.trim();
  if (!value || value.length > 100) throw new Error('Supply x-actor (1–100 characters)');
  return value;
}
export function createApp(pool: pg.Pool, adminToken = process.env.ADMIN_TOKEN) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/health', async (_req, res) => { await pool.query('SELECT 1'); res.json({ status: 'ok' }); });
  app.get('/api/status', async (_req, res) => {
    const latest = await pool.query('SELECT id,counts,warnings,snapshot_date::text,created_at FROM imports ORDER BY created_at DESC,id DESC LIMIT 1');
    const policies = await pool.query('SELECT version,effective_date::text,status FROM policy_versions ORDER BY effective_date DESC');
    res.json({ latest_import: latest.rows[0] ?? null, policies: policies.rows });
  });
  app.post('/api/admin/import-master', (req, res, next) => {
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
    if (adminToken) {
      const supplied = Buffer.from(req.get('authorization')?.replace(/^Bearer /, '') ?? '');
      const expected = Buffer.from(adminToken);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.status(401).json({ error: 'Valid admin token required' }); return; }
    } else if (!loopback) { res.status(403).json({ error: 'Configure ADMIN_TOKEN for remote imports' }); return; }
    next();
  }, upload.single('file'), async (req, res) => {
    const actingUser = actor(req);
    if (!req.file) throw new Error('Upload the kit ZIP as multipart field file');
    const kit = await inspectKit(readKitZip(req.file.buffer), req.body.snapshot_date || undefined);
    if (req.body.confirm_fingerprint !== kit.fingerprint) {
      res.json({ preview: true, fingerprint: kit.fingerprint, snapshot_date: kit.snapshot_date, warnings: kit.warnings, contracts: kit.data.contracts, counts: { items: kit.data.items.length, suppliers: kit.data.suppliers.length, po_history: kit.data.po_history.length, contracts: kit.data.contracts.length, pr_lines: kit.batch.length } });
      return;
    }
    res.status(201).json(await saveImport(pool, kit, actingUser));
  });
  app.use(express.static(fileURLToPath(new URL('../../web/dist', import.meta.url))));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof multer.MulterError) { res.status(413).json({ error: error.message }); return; }
    if (error instanceof ZodError) { res.status(400).json({ error: 'Validation failed', issues: error.issues }); return; }
    const dbError = error && typeof error === 'object' && 'severity' in error;
    res.status(dbError ? 500 : 400).json({ error: dbError ? 'Database operation failed' : error instanceof Error ? error.message : 'Request failed' });
  });
  return app;
}
