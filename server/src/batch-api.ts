import type { Express } from 'express';
import type pg from 'pg';
import type multer from 'multer';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { transaction } from './db.js';
import { parsePRCSV } from './csv.js';
import { loadMasterData } from './repository.js';
import { decisionsCSV } from './export.js';
import { batchAsOf, processBatch, type BatchResult } from '../../engine/src/process.js';
import { validatePolicy } from '../../engine/src/policy.js';

const optionsSchema = z.strictObject({ as_of_date: z.iso.date().optional(), policy_version: z.string().min(1).optional(), import_id: z.uuid().optional() });
export function registerBatchAPI(app: Express, pool: pg.Pool, upload: multer.Multer): void {
  app.post('/api/process-batch', upload.single('file'), async (req,res) => {
    if (!req.file) throw new Error('Upload PR batch CSV as multipart field file');
    const parsed: unknown = req.body.params ? JSON.parse(req.body.params) : Object.fromEntries(['as_of_date','policy_version','import_id'].filter(k => req.body[k] !== undefined).map(k => [k,req.body[k]]));
    const options = optionsSchema.parse(parsed), lines = parsePRCSV(req.file.buffer.toString('utf8'));
    if (!lines.length) throw new Error('PR batch has no data rows');
    if (lines.length > 10000) throw new Error('Batch exceeds 10000 rows');
    const as_of_date = batchAsOf(lines,options.as_of_date), actor = req.get('x-actor')?.trim() || 'batch-api';
    if (actor.length > 100) throw new Error('x-actor exceeds 100 characters');
    const saved = await transaction(pool, async client => {
      const master = await loadMasterData(client, options.import_id);
      const policies = options.policy_version
        ? await client.query("SELECT document FROM policy_versions WHERE version=$1 AND status <> 'draft' AND approved_at IS NOT NULL AND effective_date <= $2",[options.policy_version,as_of_date])
        : await client.query("SELECT document FROM policy_versions WHERE status <> 'draft' AND approved_at IS NOT NULL AND effective_date <= $1 ORDER BY effective_date DESC,approved_at DESC,version DESC LIMIT 1",[as_of_date]);
      if (!policies.rowCount) throw new Error('No approved policy effective on the requested as-of date');
      const policy = validatePolicy(policies.rows[0].document), result = processBatch(policy,master.data,lines,{ as_of_date });
      const run_id = randomUUID(), batch_id = randomUUID();
      await client.query('INSERT INTO batches(id,import_id,filename,actor) VALUES($1,$2,$3,$4)',[batch_id,master.import_id,req.file!.originalname,actor]);
      await client.query('INSERT INTO pr_lines(batch_id,source_row,raw) SELECT $1,(r->>\'source_row\')::integer,r FROM jsonb_array_elements($2::jsonb) r',[batch_id,JSON.stringify(lines)]);
      await client.query('INSERT INTO processing_runs(id,batch_id,import_id,policy_version,as_of_date,policy_snapshot,result,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[run_id,batch_id,master.import_id,policy.version,as_of_date,policy,result,actor]);
      await client.query('INSERT INTO audit_events(actor,action,after) VALUES($1,$2,$3)',[actor,'PROCESS_BATCH',{ run_id, batch_id, import_id: master.import_id, policy_version: policy.version, input_rows: lines.length }]);
      return { run_id, ...result, export_url: `/api/runs/${run_id}/export` };
    },'ISOLATION LEVEL REPEATABLE READ');
    res.json(saved);
  });
  app.get('/api/runs/:id', async (req,res) => {
    const id = z.uuid().parse(req.params.id);
    const result = await pool.query('SELECT id,as_of_date::text,policy_version,import_id,result FROM processing_runs WHERE id=$1',[id]);
    if (!result.rowCount) { res.status(404).json({ error: 'Run not found' }); return; }
    res.json(result.rows[0]);
  });
  app.get('/api/runs/:id/export', async (req,res) => {
    const id = z.uuid().parse(req.params.id);
    const result = await pool.query('SELECT result FROM processing_runs WHERE id=$1',[id]);
    if (!result.rowCount) { res.status(404).json({ error: 'Run not found' }); return; }
    res.type('text/csv').attachment(`decisions-${id}.csv`).send(decisionsCSV((result.rows[0].result as BatchResult).rows));
  });
}
