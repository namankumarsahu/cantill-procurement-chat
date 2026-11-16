import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import type {PRLine} from '../../engine/src/types.js';
import {processBatch} from '../../engine/src/process.js';
import {loadMasterData} from './repository.js';
import {selectPolicy} from './policy-selection.js';
import {stableJSON} from './policy-hash.js';
export async function processLines(client:pg.PoolClient,lines:PRLine[],options:{as_of_date:string;policy_version?:string;import_id?:string},actor:string,filename:string){
 const as_of_date=options.as_of_date;
      const hash=(await client.query("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') hash",[JSON.stringify(lines)])).rows[0].hash as string;
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`corvo_batch:${hash}`]);
      await client.query("SELECT pg_advisory_xact_lock(hashtext('corvo_current_batch'))");
      const master=await loadMasterData(client,options.import_id);
      const policy=await selectPolicy(client,as_of_date,options.policy_version),result=processBatch(policy,master.data,lines,{as_of_date});
      const oldBatch=await client.query('SELECT id FROM batches WHERE content_hash=$1 FOR UPDATE',[hash]);
      const batch_id=oldBatch.rows[0]?.id??randomUUID();
      if(!oldBatch.rowCount){
        await client.query('INSERT INTO batches(id,import_id,filename,actor,content_hash) VALUES($1,$2,$3,$4,$5)',[batch_id,master.import_id,filename,actor,hash]);
        await client.query('INSERT INTO pr_lines(batch_id,source_row,raw) SELECT $1,(r->>\'source_row\')::integer,r FROM jsonb_array_elements($2::jsonb) r',[batch_id,JSON.stringify(lines)]);
      }
      const previous=await client.query('SELECT id,policy_version,as_of_date::text,policy_snapshot,result,actor FROM processing_runs WHERE batch_id=$1 AND is_current FOR UPDATE',[batch_id]);
      const run_id=previous.rows[0]?.id??randomUUID();
      const hasApproved=previous.rowCount&&(await client.query('SELECT 1 FROM procurement_documents WHERE run_id=$1 LIMIT 1',[run_id])).rowCount;
      if(hasApproved){if(stableJSON(previous.rows[0].result)!==stableJSON(result))throw new Error('This batch has approved documents. Create a new PR or override an unapproved requirement; approved orders cannot be replaced.');return{run_id,batch_id,replaced:false,...result,export_url:`/api/runs/${run_id}/export`};}
      const clearedOverrides=(await client.query('DELETE FROM buyer_decisions WHERE run_id=$1 AND document_id IS NULL RETURNING *',[run_id])).rows;
      await client.query(`INSERT INTO processing_runs(id,batch_id,import_id,policy_version,as_of_date,policy_snapshot,result,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(batch_id) WHERE is_current DO UPDATE SET import_id=EXCLUDED.import_id,policy_version=EXCLUDED.policy_version,as_of_date=EXCLUDED.as_of_date,policy_snapshot=EXCLUDED.policy_snapshot,result=EXCLUDED.result,actor=EXCLUDED.actor,updated_at=now()`,[run_id,batch_id,master.import_id,policy.version,as_of_date,policy,result,actor]);
      await client.query('INSERT INTO audit_events(actor,action,before,after) VALUES($1,$2,$3,$4)',[actor,previous.rowCount?'REPROCESS_BATCH':'PROCESS_BATCH',previous.rowCount?{...previous.rows[0],cleared_overrides:clearedOverrides}:null,{run_id,batch_id,import_id:master.import_id,policy_version:policy.version,result}]);
      return{run_id,batch_id,replaced:!!previous.rowCount,...result,export_url:`/api/runs/${run_id}/export`};
}
