import type {Express,Request} from 'express';
import type pg from 'pg';
import {z} from 'zod';
import {actor,adminOnly} from './auth.js';
import {transaction} from './db.js';
import {buyerView,overrideRequirement,approveRequirement} from './buyer.js';
import {loadMasterData} from './repository.js';
function buyer(req:Request){const role=req.get('x-role');if(!['buyer','procurement'].includes(role??''))throw new Error('Choose buyer or procurement role');return{who:actor(req),role:role!};}
export function registerBuyerAPI(app:Express,pool:pg.Pool,token?:string){
 app.get('/api/buyer/runs',async(_req,res)=>res.json((await pool.query('SELECT r.id,r.policy_version,r.as_of_date::text,r.updated_at,b.filename FROM processing_runs r JOIN batches b ON b.id=r.batch_id WHERE r.is_current ORDER BY r.updated_at DESC,r.id DESC')).rows));
 app.get('/api/buyer/runs/:id',async(req,res)=>{const id=z.uuid().parse(req.params.id),run=(await pool.query('SELECT * FROM processing_runs WHERE id=$1 AND is_current',[id])).rows[0];if(!run)throw new Error('Current run not found');res.json({...await buyerView(pool,run),run_id:id,master:(await loadMasterData(pool)).data,policy:run.policy_snapshot});});
 for(const action of ['approve','override']as const)app.post(`/api/buyer/runs/:id/requirements/:group/${action}`,adminOnly(token),async(req,res)=>{
  const {who,role}=buyer(req),id=z.uuid().parse(req.params.id),group=z.string().parse(req.params.group);
  const result=await transaction(pool,async client=>{await client.query("SELECT pg_advisory_xact_lock(hashtext('corvo_current_batch'))");return action==='approve'?approveRequirement(client,id,group,who,role):overrideRequirement(client,id,group,req.body,who,role);});res.json(result);
 });
 app.get('/api/audit',async(req,res)=>{const q=z.object({limit:z.coerce.number().int().min(1).max(200).default(50),before_id:z.coerce.number().int().positive().optional(),action:z.string().optional()}).parse(req.query);res.json((await pool.query('SELECT * FROM audit_events WHERE ($1::bigint IS NULL OR id<$1) AND ($2::text IS NULL OR action=$2) ORDER BY id DESC LIMIT $3',[q.before_id??null,q.action??null,q.limit])).rows);});
}
