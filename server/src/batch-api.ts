import type { Express } from 'express';
import type pg from 'pg';
import type multer from 'multer';
import { z } from 'zod';
import { transaction } from './db.js';
import { parsePRCSV } from './csv.js';
import { decisionsCSV } from './export.js';
import { batchAsOf, processBatch, type BatchResult } from '../../engine/src/process.js';
import {buyerView} from './buyer.js';
import {processLines} from './process-lines.js';
import {exportPrefix,exportFilename} from './export-filename.js';

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
      return processLines(client,lines,{...options,as_of_date},actor,req.file!.originalname);
    });
    const current=(await pool.query('SELECT * FROM processing_runs WHERE id=$1',[saved.run_id])).rows[0];res.json({...saved,...await buyerView(pool,current)});
  });
  app.get('/api/runs/:id', async (req,res) => {
    const id = z.uuid().parse(req.params.id);
    const result = await pool.query('SELECT id,as_of_date::text,policy_version,import_id,is_current,policy_snapshot,result FROM processing_runs WHERE id=$1',[id]);
    if (!result.rowCount) { res.status(404).json({ error: 'Run not found' }); return; }
    res.json({...result.rows[0],result:await buyerView(pool,result.rows[0])});
  });
  app.get('/api/runs/:id/export', async (req,res) => {
    const id = z.uuid().parse(req.params.id);
    const naming=z.strictObject({prefix:exportPrefix.optional(),run:z.enum(['run1','run2']).optional()}).parse(req.query);
    const result = await pool.query('SELECT * FROM processing_runs WHERE id=$1',[id]);
    if (!result.rowCount) { res.status(404).json({ error: 'Run not found' }); return; }
    res.type('text/csv').attachment(exportFilename(naming.prefix,naming.run??'decisions',`decisions-${id}.csv`)).send(decisionsCSV((await buyerView(pool,result.rows[0])).rows));
  });
}
