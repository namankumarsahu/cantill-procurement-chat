import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import type pg from 'pg';
import { inspectKit, readKitZip } from './import-kit.js';
import { saveImport } from './repository.js';
import { actor,adminOnly } from './auth.js';
import {registerPolicyAPI} from './policy-api.js';
import {registerChatAPI} from './chat-api.js';
import {registerBuyerAPI} from './buyer-api.js';
import type {IntakeParser} from './intake.js';
import type {DraftParser} from './llm.js';
import { registerSupplierAPI } from './supplier-api.js';
import { registerBatchAPI } from './batch-api.js';

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 } });
export function createApp(pool: pg.Pool, adminToken = process.env.ADMIN_TOKEN, options: {policyParser?:DraftParser;intakeParser?:IntakeParser} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/health', async (_req, res) => { await pool.query('SELECT 1'); res.json({ status: 'ok' }); });
  app.get('/api/status', async (_req, res) => {
    const latest = await pool.query('SELECT id,counts,warnings,snapshot_date::text,created_at FROM imports ORDER BY created_at DESC,id DESC LIMIT 1');
    const policies = await pool.query('SELECT version,effective_date::text,status FROM policy_versions ORDER BY effective_date DESC');
    res.json({ latest_import: latest.rows[0] ?? null, policies: policies.rows });
  });
  app.post('/api/admin/import-master', adminOnly(adminToken), upload.single('file'), async (req, res) => {
    const actingUser = actor(req);
    if (!req.file) throw new Error('Upload the kit ZIP as multipart field file');
    const kit = await inspectKit(readKitZip(req.file.buffer), req.body.snapshot_date || undefined);
    if (req.body.confirm_fingerprint !== kit.fingerprint) {
      res.json({ preview: true, fingerprint: kit.fingerprint, snapshot_date: kit.snapshot_date, warnings: kit.warnings, contracts: kit.data.contracts, counts: { items: kit.data.items.length, suppliers: kit.data.suppliers.length, po_history: kit.data.po_history.length, contracts: kit.data.contracts.length, pr_lines: kit.batch.length } });
      return;
    }
    res.status(201).json(await saveImport(pool, kit, actingUser));
  });
  registerBatchAPI(app,pool,upload);
  registerChatAPI(app,pool,options.intakeParser);
  registerBuyerAPI(app,pool,adminToken);
  registerSupplierAPI(app,pool);
  registerPolicyAPI(app,pool,upload,adminToken,options.policyParser);
  app.use(express.static(fileURLToPath(new URL('../../web/dist', import.meta.url))));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof multer.MulterError) { res.status(413).json({ error: error.message }); return; }
    if (error instanceof ZodError) { res.status(400).json({ error: 'Validation failed', issues: error.issues }); return; }
    const dbError = error && typeof error === 'object' && 'severity' in error;
    res.status(dbError ? 500 : 400).json({ error: dbError ? 'Database operation failed' : error instanceof Error ? error.message : 'Request failed' });
  });
  return app;
}
