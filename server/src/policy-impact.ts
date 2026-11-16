import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {processBatch,type BatchResult} from '../../engine/src/process.js';
import type {Policy,PRLine} from '../../engine/src/index.js';
import {loadMasterData} from './repository.js';
import {stableJSON} from './policy-hash.js';
import {sha256} from './import-kit.js';
export const latestRun=async(client:pg.PoolClient)=> (await client.query('SELECT id,batch_id,import_id,as_of_date::text,policy_snapshot,result FROM processing_runs WHERE is_current ORDER BY updated_at DESC,id DESC LIMIT 1 FOR SHARE')).rows[0];
export const runHash=(run:unknown)=>sha256(stableJSON(run));
export function compareImpact(before:BatchResult,after:BatchResult){
 const fields=['resolved_item_code','route','decision','supplier_id','unit_price','group_value_inr','suggested_supplier_ids'] as const;
 const membership=(r:BatchResult)=>{
  const groups=new Map(r.requirements.map(q=>[q.group_id,q.lines.map(l=>l.source_row).sort((a,b)=>a-b).join(',')]));
  const pos=new Map(r.purchase_orders.map(po=>[po.po_id,r.requirements.filter(q=>po.group_ids.includes(q.group_id)).flatMap(q=>q.lines.map(l=>l.source_row)).sort((a,b)=>a-b).join(',')]));
  return{groups,pos};
 };
 const oldMembers=membership(before),newMembers=membership(after);
 if(before.rows.length!==after.rows.length)throw new Error('Preview lost input rows');
 const transitions=new Map<string,{old_route:string;new_route:string;count:number}>();let changed_rows=0,route_changed_rows=0;
 for(const [i,row]of before.rows.entries())if(fields.some(k=>row[k]!==after.rows[i][k])||oldMembers.groups.get(row.group_id)!==newMembers.groups.get(after.rows[i].group_id)||oldMembers.pos.get(row.po_id)!==newMembers.pos.get(after.rows[i].po_id)){
  changed_rows++;if(row.route!==after.rows[i].route)route_changed_rows++;
  const key=JSON.stringify([row.route,after.rows[i].route]),group=transitions.get(key)??{old_route:row.route,new_route:after.rows[i].route,count:0};group.count++;transitions.set(key,group);
 }
 return{total_rows:before.rows.length,changed_rows,route_changed_rows,unchanged_rows:before.rows.length-changed_rows,transitions:[...transitions.values()].sort((a,b)=>a.old_route.localeCompare(b.old_route)||a.new_route.localeCompare(b.new_route))};
}
export async function previewImpact(client:pg.PoolClient,draft:Policy,review_hash:string,actor:string){
 await client.query("SELECT pg_advisory_xact_lock(hashtext('corvo_current_batch'))");
 const run=await latestRun(client);let summary:Record<string,unknown>;
 if(!run)summary={available:false,reason:'No current batch exists. Process a batch to see routing impact before approval.'};
 else{
  const {data}=await loadMasterData(client,run.import_id);
  const lines=(await client.query('SELECT raw FROM pr_lines WHERE batch_id=$1 ORDER BY source_row',[run.batch_id])).rows.map(r=>r.raw) as PRLine[];
  const as_of_date=[run.as_of_date,draft.effective_date].sort().at(-1)!;
  const before=processBatch(run.policy_snapshot,data,lines,{as_of_date});
  const after=processBatch(draft,data,lines,{as_of_date,preview_draft:true});
  summary={available:true,run_id:run.id,batch_id:run.batch_id,baseline_policy:before.policy_version,draft_policy:draft.version,as_of_date,original_as_of_date:run.as_of_date,...compareImpact(before,after)};
 }
 const preview_id=randomUUID();await client.query('INSERT INTO policy_impact_previews(id,policy_version,review_hash,run_id,run_hash,summary,actor) VALUES($1,$2,$3,$4,$5,$6,$7)',[preview_id,draft.version,review_hash,run?.id??null,run?runHash(run):null,summary,actor]);
 await client.query('INSERT INTO audit_events(actor,action,after) VALUES($1,$2,$3)',[actor,'POLICY_IMPACT_PREVIEW',{version:draft.version,preview_id,summary}]);
 return{preview_id,...summary};
}
export async function requireReviewedImpact(client:pg.PoolClient,version:string,review_hash:string,preview_id:string,allow_no_batch=false):Promise<void>{
 await client.query("SELECT pg_advisory_xact_lock(hashtext('corvo_current_batch'))");
 const preview=(await client.query('SELECT * FROM policy_impact_previews WHERE id=$1 AND policy_version=$2',[preview_id,version])).rows[0];
 if(!preview||preview.review_hash!==review_hash)throw new Error('Preview impact for the current draft before approval');
 const run=await latestRun(client);
 if(!run&&!allow_no_batch)throw new Error('Explicitly acknowledge that no batch impact is available before approval');
 if((run?.id??null)!==preview.run_id||(run?runHash(run):null)!==preview.run_hash)throw new Error('The current batch changed. Refresh the impact preview before approval');
}
