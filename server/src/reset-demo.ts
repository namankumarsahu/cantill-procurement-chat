import type pg from 'pg';
import {transaction} from './db.js';
import {loadSeedPolicy} from './repository.js';
export async function resetDemo(pool:pg.Pool,confirm=false,actor='demo-reset'){
 if(process.env.NODE_ENV==='production')throw new Error('Demo reset is disabled in production');
 const seed=await loadSeedPolicy();
 return transaction(pool,async client=>{
  if(confirm){await client.query("SELECT pg_advisory_xact_lock(hashtext('corvo_policy_approval'))");await client.query("SELECT pg_advisory_xact_lock(hashtext('corvo_current_batch'))");await client.query('LOCK TABLE policy_versions,processing_runs,policy_impact_previews IN ACCESS EXCLUSIVE MODE');}
  const policies=(await client.query("SELECT version FROM policy_versions WHERE version <> '5.0' ORDER BY version")).rows.map(r=>r.version as string);
  const runs=Number((await client.query('SELECT count(*) n FROM processing_runs')).rows[0].n);
  if(!confirm)return{dry_run:true,policies_to_delete:policies,runs_to_delete:runs};
  await client.query('DELETE FROM contract_allocations');await client.query('DELETE FROM procurement_document_lines');await client.query('DELETE FROM buyer_decisions');await client.query('DELETE FROM procurement_documents');
  await client.query('DELETE FROM policy_impact_previews');await client.query('DELETE FROM processing_runs');
  await client.query("UPDATE policy_versions SET base_version=NULL WHERE version <> '5.0'");
  await client.query("DELETE FROM policy_versions WHERE version <> '5.0'");
  await client.query(`INSERT INTO policy_versions(version,effective_date,status,document,created_by,approved_by,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7)
   ON CONFLICT(version) DO UPDATE SET effective_date=EXCLUDED.effective_date,status='active',document=EXCLUDED.document,created_by=EXCLUDED.created_by,approved_by=EXCLUDED.approved_by,approved_at=EXCLUDED.approved_at,base_version=NULL,base_hash=NULL,rule_restatements='[]',feedback_history='[]'`,[seed.version,seed.effective_date,'active',seed,seed.created_by,seed.approved_by,seed.approved_at]);
  await client.query('INSERT INTO audit_events(actor,action,before,after) VALUES($1,$2,$3,$4)',[actor,'DEMO_RESET',{policies,runs},{active_policy:'5.0',preserved:'imports, master data, raw batches, audit history'}]);
  return{dry_run:false,deleted_policies:policies,deleted_runs:runs,active_policy:'5.0'};
 });
}
