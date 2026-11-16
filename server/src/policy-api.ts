import type {Express} from 'express';
import type pg from 'pg';
import type multer from 'multer';
import {z} from 'zod';
import {validatePolicy,policySchema,sourceTypes,type Policy} from '../../engine/src/policy.js';
import {businessDate} from '../../engine/src/dates.js';
import {transaction} from './db.js';
import {actor,adminOnly} from './auth.js';
import {extractPDF,sha256} from './import-kit.js';
import {selectPolicy} from './policy-selection.js';
import {describeDiff} from './policy-diff.js';
import {draftPolicy,configured,type DraftParser} from './llm.js';
import {policyHash,stableJSON} from './policy-hash.js';
import {previewImpact,requireReviewedImpact} from './policy-impact.js';
import {validateRestatements,type RuleRestatement,applyPolicyEdits} from './policy-edits.js';
const metadata=z.object({version:z.string().regex(/^[a-zA-Z0-9._-]+$/).max(80),effective_date:z.iso.date(),base_version:z.string().optional()});
async function review(client:pg.Pool|pg.PoolClient,version:string){
 const result=await client.query('SELECT document,base_version,base_hash,rule_restatements,feedback_history FROM policy_versions WHERE version=$1',[version]);
 if(!result.rowCount)throw new Error('Policy version not found');
 const row=result.rows[0],draft=validatePolicy(row.document);
 if(!row.base_version)throw new Error('This policy is not an amendment draft');
 const baseResult=await client.query('SELECT document FROM policy_versions WHERE version=$1',[row.base_version]);
 const base=validatePolicy(baseResult.rows[0].document);
 const rule_restatements=row.rule_restatements as RuleRestatement[],feedback_history=row.feedback_history as string[];
 return{draft,base_version:base.version,base_hash:row.base_hash,rule_restatements,feedback_history,changes:describeDiff(base,draft),review_hash:sha256(stableJSON({draft,base_hash:policyHash(base),rule_restatements,feedback_history}))};
}
export function registerPolicyAPI(app:Express,pool:pg.Pool,upload:multer.Multer,token?:string,parser:DraftParser=draftPolicy):void{
 const protect=adminOnly(token);
 app.get('/api/policy-capabilities',(_req,res)=>res.json({fact_sources:sourceTypes,operators:['eq','ne','in','gt','gte','lt','lte','between'],condition_groups:['all','any','not'],llm_configured:configured(),schema:z.toJSONSchema(policySchema)}));
 app.get('/api/policies',async(req,res)=>{
  const date=z.iso.date().parse(req.query.as_of_date??businessDate(Date.now()));
  const rows=(await pool.query('SELECT version,effective_date::text,status,approved_by,approved_at,created_by,base_version FROM policy_versions ORDER BY effective_date DESC,approved_at DESC NULLS LAST,version DESC')).rows;
  const active=rows.find(r=>r.approved_at&&r.effective_date<=date);
  res.json({as_of_date:date,active_version:active?.version??null,versions:rows.map(r=>({...r,lifecycle:!r.approved_at?'draft':r.effective_date>date?'scheduled':r.version===active?.version?'active':'superseded'}))});
 });
 app.get('/api/policies/:version',async(req,res)=>{
  const row=await pool.query('SELECT document,base_version FROM policy_versions WHERE version=$1',[req.params.version]);
  if(!row.rowCount){res.status(404).json({error:'Policy version not found'});return;}
  res.json(row.rows[0].base_version?await review(pool,String(req.params.version)):{draft:row.rows[0].document});
 });
 app.post('/api/admin/policies/drafts',protect,upload.single('file'),async(req,res)=>{
  const who=actor(req),meta=metadata.parse(req.body);
  const base=await selectPolicy(pool,meta.effective_date,meta.base_version);
  let source=typeof req.body.text==='string'?req.body.text.trim():'';
  if(req.file){
   const pdf=req.file.buffer.subarray(0,5).toString()==='%PDF-';
   if(!pdf&&!/\.(txt|md|json)$/i.test(req.file.originalname))throw new Error('Upload PDF, UTF-8 text, Markdown or JSON');
   const extracted=pdf?await extractPDF(req.file.buffer):new TextDecoder('utf-8',{fatal:true}).decode(req.file.buffer);
   source=[source,extracted].filter(Boolean).join('\n\n');
  }
  if(!source&&req.body.policy_json)source='Manual JSON amendment';
  if(!source||source.length>100000)throw new Error('Supply policy text of 1-100000 characters');
  let candidate:Policy,notes:RuleRestatement[]=[];
  if(req.body.policy_json)candidate=JSON.parse(req.body.policy_json);
  else{const edits=await parser(source,base,{v5:await selectPolicy(pool,meta.effective_date,'5.0')});candidate=applyPolicyEdits(base,edits);notes=edits.rule_restatements;validateRestatements(base,candidate,notes);}
  const draft=validatePolicy({...candidate,version:meta.version,effective_date:meta.effective_date,status:'draft',created_by:who,approved_by:null,approved_at:null,source_text:source});
  if(!describeDiff(base,draft).some(c=>c.subject!=='Effective date'))throw new Error('No behavioral policy changes to review');
  await transaction(pool,async client=>{
   if((await client.query('SELECT 1 FROM policy_versions WHERE version=$1',[draft.version])).rowCount)throw new Error('Policy version already exists; use a new version');
   await client.query('INSERT INTO policy_versions(version,effective_date,status,document,created_by,base_version,base_hash,source_filename,source_bytes,rule_restatements) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[draft.version,draft.effective_date,'draft',draft,who,base.version,policyHash(base),req.file?.originalname??null,req.file?.buffer??null,JSON.stringify(notes)]);
   await client.query('INSERT INTO audit_events(actor,action,after) VALUES($1,$2,$3)',[who,'POLICY_DRAFT_CREATED',{version:draft.version,base_version:base.version,document:draft}]);
  });res.status(201).json(await review(pool,draft.version));
 });
 app.put('/api/admin/policies/:version',protect,async(req,res)=>{
  const who=actor(req),body=z.object({policy_json:z.unknown(),review_hash:z.string()}).parse(req.body),version=String(req.params.version);
  const result=await transaction(pool,async client=>{
   await client.query('SELECT version FROM policy_versions WHERE version=$1 FOR UPDATE',[version]);
   const old=await review(client,version);if(old.draft.status!=='draft')throw new Error('Approved policies are immutable');
   if(old.review_hash!==body.review_hash)throw new Error('Draft changed; reload and review it again');
   const candidate=typeof body.policy_json==='string'?JSON.parse(body.policy_json):body.policy_json;
   const draft=validatePolicy({...candidate as object,version,effective_date:old.draft.effective_date,status:'draft',created_by:old.draft.created_by,approved_by:null,approved_at:null,source_text:old.draft.source_text});
   await client.query(`UPDATE policy_versions SET document=$1,rule_restatements='[]'::jsonb WHERE version=$2`,[draft,version]);
   await client.query('INSERT INTO audit_events(actor,action,before,after) VALUES($1,$2,$3,$4)',[who,'POLICY_DRAFT_EDITED',old.draft,draft]);return review(client,version);
  });res.json(result);
 });
 app.post('/api/admin/policies/:version/regenerate',protect,async(req,res)=>{
  const who=actor(req),version=String(req.params.version),body=z.object({feedback:z.string().trim().min(1).max(4000),review_hash:z.string()}).parse(req.body);
  const old=await review(pool,version);
  if(old.draft.status!=='draft'||old.review_hash!==body.review_hash)throw new Error('Draft changed or was approved; reload before regenerating');
  const base=await selectPolicy(pool,old.draft.effective_date,old.base_version),history=[...old.feedback_history,body.feedback];
  if(history.join('\n').length>16000)throw new Error('Feedback history is too long; create a fresh draft');
  const edits=await parser(old.draft.source_text,base,{v5:await selectPolicy(pool,old.draft.effective_date,'5.0'),current_draft:old.draft,feedback:history.map((text,i)=>`${i+1}. ${text}`).join('\n')});
  const candidate=applyPolicyEdits(base,edits);validateRestatements(base,candidate,edits.rule_restatements);
  const draft=validatePolicy({...candidate,version,effective_date:old.draft.effective_date,status:'draft',created_by:old.draft.created_by,approved_by:null,approved_at:null,source_text:old.draft.source_text});
  const updated=await transaction(pool,async client=>{
   await client.query('SELECT version FROM policy_versions WHERE version=$1 FOR UPDATE',[version]);const current=await review(client,version);
   if(current.draft.status!=='draft'||current.review_hash!==old.review_hash)throw new Error('Draft changed while regenerating; reload before trying again');
   await client.query('UPDATE policy_versions SET document=$1,rule_restatements=$2,feedback_history=$3 WHERE version=$4',[draft,JSON.stringify(edits.rule_restatements),JSON.stringify(history),version]);
   await client.query('INSERT INTO audit_events(actor,action,before,after) VALUES($1,$2,$3,$4)',[who,'POLICY_DRAFT_REGENERATED',{document:old.draft,feedback_history:old.feedback_history},{document:draft,feedback:body.feedback,rule_restatements:edits.rule_restatements}]);return review(client,version);
  });res.json(updated);
 });
 app.post('/api/admin/policies/:version/impact',protect,async(req,res)=>{
  const who=actor(req),version=String(req.params.version),body=z.object({review_hash:z.string()}).parse(req.body);
  const result=await transaction(pool,async client=>{
   const current=await review(client,version);
   if(current.draft.status!=='draft'||current.review_hash!==body.review_hash)throw new Error('Draft changed; reload before previewing impact');
   return previewImpact(client,current.draft,current.review_hash,who);
  });res.json(result);
 });
 app.post('/api/admin/policies/:version/approve',protect,async(req,res)=>{
  const who=actor(req),body=z.object({review_hash:z.string(),preview_id:z.uuid(),allow_no_batch:z.boolean().optional()}).parse(req.body),version=String(req.params.version);
  const result=await transaction(pool,async client=>{
   await client.query("SELECT pg_advisory_xact_lock(hashtext('corvo_policy_approval'))");
   await client.query('SELECT version FROM policy_versions WHERE version=$1 FOR UPDATE',[version]);
   const current=await review(client,version);
   if(current.draft.status!=='draft')throw new Error('Policy is already approved');
   if(current.review_hash!==body.review_hash)throw new Error('Draft changed; reload the diff before approval');
   const active=await selectPolicy(client,current.draft.effective_date);
   if(active.version!==current.base_version||policyHash(active)!==current.base_hash)throw new Error('The base policy changed. Create a new draft from the current policy and review again.');
   await requireReviewedImpact(client,version,current.review_hash,body.preview_id,body.allow_no_batch??false);
   if(!current.changes.some(c=>c.subject!=='Effective date'))throw new Error('No behavioral changes to approve');
   const approved=validatePolicy({...current.draft,status:'active',approved_by:who,approved_at:new Date().toISOString()});
   const today=businessDate(Date.now());
   await client.query("UPDATE policy_versions SET status='active',document=$1,approved_by=$2,approved_at=$3 WHERE version=$4",[approved,who,approved.approved_at,version]);
   const ready=(await client.query("SELECT version FROM policy_versions WHERE approved_at IS NOT NULL AND effective_date <= $1 ORDER BY effective_date DESC,approved_at DESC,version DESC LIMIT 1",[today])).rows[0]?.version;
   const all=(await client.query('SELECT version,effective_date::text,status,document FROM policy_versions WHERE approved_at IS NOT NULL')).rows;
   for(const old of all){
    const status=old.effective_date>today||old.version===ready?'active':'superseded';
    if(old.status!==status){const after={...old.document,status};await client.query('UPDATE policy_versions SET status=$1,document=$2 WHERE version=$3',[status,after,old.version]);await client.query('INSERT INTO audit_events(actor,action,before,after) VALUES($1,$2,$3,$4)',[who,'POLICY_STATUS_UPDATED',old.document,after]);}
   }
   const final=validatePolicy((await client.query('SELECT document FROM policy_versions WHERE version=$1',[version])).rows[0].document);
   await client.query('INSERT INTO audit_events(actor,action,before,after) VALUES($1,$2,$3,$4)',[who,'POLICY_APPROVED',current.draft,approved]);
   return{policy:final,lifecycle:final.effective_date>today?'scheduled':final.version===ready?'active':'superseded'};
  });res.json(result);
 });
}
