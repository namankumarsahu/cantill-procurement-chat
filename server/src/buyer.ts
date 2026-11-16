import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {z} from 'zod';
import {consolidatePOs,type BatchResult,type Requirement} from '../../engine/src/process.js';
import {resolveOperand,type Policy} from '../../engine/src/policy.js';
import {suggestSuppliers} from '../../engine/src/ranking.js';
import {loadMasterData} from './repository.js';
import {stableJSON} from './policy-hash.js';
import {sha256} from './import-kit.js';
export async function buyerView(client:pg.Pool|pg.PoolClient,run:{id:string;result:BatchResult;policy_snapshot:Policy}){
 const decisions=(await client.query('SELECT * FROM buyer_decisions WHERE run_id=$1',[run.id])).rows;
 const documents=(await client.query('SELECT * FROM procurement_documents WHERE run_id=$1 ORDER BY created_at,document_no',[run.id])).rows;
 if(!decisions.length)return{...run.result,decisions,documents};
 const effective=structuredClone(run.result),byGroup=new Map(decisions.map(a=>[a.group_id,a]));
 effective.requirements=effective.requirements.map(req=>structuredClone(byGroup.get(req.group_id)?.effective??req));
 const pending=effective.requirements.filter(r=>!byGroup.get(r.group_id)?.document_id);effective.purchase_orders=consolidatePOs(pending,run.policy_snapshot);
 for(const req of effective.requirements){const doc=documents.find(d=>d.id===byGroup.get(req.group_id)?.document_id);if(doc)req.po_id=req.decision==='PO'?doc.document_no:'';}
 const requirements=new Map(effective.requirements.map(r=>[r.group_id,r]));
 effective.rows=effective.rows.map(row=>{const r=requirements.get(row.group_id);return r?{...row,po_id:r.po_id,decision:r.decision,route:r.route,supplier_id:r.supplier_id,unit_price:r.unit_price,group_value_inr:r.group_value_inr,suggested_supplier_ids:r.suggested_supplier_ids.join(';'),reason:r.reason}:row;});
 return{...effective,decisions,documents};
}
export const overrideSchema=z.strictObject({route:z.string().min(1),supplier_id:z.string().optional(),unit_price:z.string().optional(),suggested_supplier_ids:z.array(z.string()).optional(),comment:z.string().trim().min(1).max(2000)});
export async function overrideRequirement(client:pg.PoolClient,runId:string,groupId:string,input:unknown,who:string,role:string){
 const body=overrideSchema.parse(input),run=(await client.query('SELECT * FROM processing_runs WHERE id=$1 AND is_current FOR UPDATE',[runId])).rows[0];if(!run)throw new Error('Current run not found');
 const view=await buyerView(client,run),old=view.requirements.find(r=>r.group_id===groupId);if(!old)throw new Error('Requirement not found');
 if(view.decisions.some(a=>a.group_id===groupId&&a.document_id))throw new Error('Approved documents cannot be overridden');
 const policy=run.policy_snapshot as Policy,outcome=policy.route_registry[body.route];if(!outcome)throw new Error('Choose a route registered in this policy');
 const {data}=await loadMasterData(client),active=new Set(data.suppliers.filter(s=>s.status==='Active').map(s=>s.supplier_id));
 const changed:Requirement={...old,route:body.route,decision:outcome.decision,supplier_id:'',unit_price:'',contract_id:null,suggested_supplier_ids:[],flags:[...outcome.flags,'buyer_override'],po_id:'',reason:`${old.reason} Buyer override by ${who}: ${body.comment}`};
 if(outcome.decision==='PO'){
  if(old.resolved_item_code==='NEW')throw new Error('NEW items must remain in sourcing until registered as a master item');
  if(!body.supplier_id||!active.has(body.supplier_id))throw new Error('A PO needs a currently Active supplier');
  if(!body.unit_price||!/^\d+(\.\d+)?$/.test(body.unit_price)||!new Decimal(body.unit_price).gt(0))throw new Error('PO unit price must be positive');
  changed.supplier_id=body.supplier_id;changed.unit_price=new Decimal(body.unit_price).toString();
  if(outcome.supplier_strategy==='selected_contract'){
   const contract=data.contracts.find(c=>c.contract_id===old.contract_id),line=contract?.lines.find(l=>l.item_code===old.resolved_item_code);
   if(!contract||!line||contract.supplier_id!==body.supplier_id||!new Decimal(line.rate).eq(changed.unit_price)||contract.start_date>old.requirement_date||contract.end_date<old.requirement_date)throw new Error('Contract overrides must retain applicable signed contract terms');changed.contract_id=contract.contract_id;
  }
 }else{
  if(old.resolved_item_code==='NEW'){if(body.suggested_supplier_ids?.length)throw new Error('NEW items cannot have supplier suggestions');}
  else{const item=data.items.find(i=>i.item_code===old.resolved_item_code);const count=Number(resolveOperand(policy,outcome.suggest_count));changed.suggested_supplier_ids=body.suggested_supplier_ids??(item?suggestSuppliers(item,old.rankings.filter(r=>active.has(r.supplier_id)),count,data,policy):[]);if(new Set(changed.suggested_supplier_ids).size!==changed.suggested_supplier_ids.length||changed.suggested_supplier_ids.some(id=>!active.has(id)))throw new Error('Suggestions must be unique currently Active suppliers');}
 }
 const original=(run.result as BatchResult).requirements.find(r=>r.group_id===groupId)!;
 await client.query(`INSERT INTO buyer_decisions(run_id,group_id,original,effective,comment,actor) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(run_id,group_id) DO UPDATE SET effective=EXCLUDED.effective,comment=EXCLUDED.comment,actor=EXCLUDED.actor,updated_at=now()`,[runId,groupId,original,changed,body.comment,who]);
 await client.query('INSERT INTO audit_events(actor,role,action,before,after) VALUES($1,$2,$3,$4,$5)',[who,role,'REQUIREMENT_OVERRIDDEN',old,changed]);return buyerView(client,run);
}
export async function approveRequirement(client:pg.PoolClient,runId:string,groupId:string,who:string,role:string){
 const run=(await client.query('SELECT * FROM processing_runs WHERE id=$1 AND is_current FOR UPDATE',[runId])).rows[0];if(!run)throw new Error('Current run not found');
 const existing=(await client.query('SELECT document_id FROM buyer_decisions WHERE run_id=$1 AND group_id=$2',[runId,groupId])).rows[0];
 if(existing?.document_id)return{document:(await client.query('SELECT * FROM procurement_documents WHERE id=$1',[existing.document_id])).rows[0],reused:true};
 const view=await buyerView(client,run),selected=view.requirements.find(r=>r.group_id===groupId);if(!selected)throw new Error('Requirement not found');
 const groupIds=selected.decision==='PO'?view.purchase_orders.find(p=>p.po_id===selected.po_id)!.group_ids:[groupId];
 const requirements=view.requirements.filter(r=>groupIds.includes(r.group_id)),master=await loadMasterData(client),data=master.data;
 for(const req of requirements){if(req.supplier_id&&!data.suppliers.some(s=>s.supplier_id===req.supplier_id&&s.status==='Active'))throw new Error('Supplier is no longer Active');for(const id of req.suggested_supplier_ids)if(!data.suppliers.some(s=>s.supplier_id===id&&s.status==='Active'))throw new Error('Suggested supplier is no longer Active; override the suggestions first');}
 const allocations=new Map<string,Decimal>();
 for(const req of requirements.filter(r=>r.contract_id)){
  const contract=data.contracts.find(c=>c.contract_id===req.contract_id),line=contract?.lines.find(l=>l.item_code===req.resolved_item_code);
  if(!contract||!line||contract.supplier_id!==req.supplier_id||contract.start_date>req.requirement_date||contract.end_date<req.requirement_date||!new Decimal(line.rate).eq(req.unit_price))throw new Error('Contract terms changed; review or override the unapproved requirement');
  const value=new Decimal(req.quantity).times(req.unit_price).toDecimalPlaces(2,Decimal.ROUND_HALF_UP);allocations.set(contract.contract_id,(allocations.get(contract.contract_id)??new Decimal(0)).plus(value));
 }
 for(const [contractId,value]of allocations){const c=data.contracts.find(c=>c.contract_id===contractId)!;const prior=(await client.query('SELECT COALESCE(sum(amount),0)::text amount FROM contract_allocations WHERE contract_id=$1',[contractId])).rows[0].amount;if(new Decimal(c.consumed_value).plus(prior).plus(value).gt(c.value_cap))throw new Error(`Contract ${contractId} ceiling changed or is exhausted. Override unapproved lines to sourcing.`);}
 const id=randomUUID(),n=(await client.query("SELECT nextval('procurement_document_sequence') n")).rows[0].n,kind=selected.decision==='PO'?'PO':['RFQ','RFP'].includes(selected.route)?selected.route:'SOURCING_REQUEST',number=`${kind}-${String(n).padStart(6,'0')}`;
 const key=sha256(stableJSON({runId,groupIds:[...groupIds].sort(),route:selected.route,supplier:selected.supplier_id,plant:selected.plant}));
 await client.query('INSERT INTO procurement_documents(id,document_no,request_key,run_id,import_id,policy_version,kind,route,supplier_id,plant,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,number,key,runId,run.import_id,run.policy_version,kind,selected.route,selected.supplier_id||null,selected.plant,who]);
 for(const req of requirements){await client.query('INSERT INTO procurement_document_lines(document_id,group_id,snapshot) VALUES($1,$2,$3)',[id,req.group_id,req]);const original=(run.result as BatchResult).requirements.find(r=>r.group_id===req.group_id)!;await client.query(`INSERT INTO buyer_decisions(run_id,group_id,original,effective,document_id,actor) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(run_id,group_id) DO UPDATE SET effective=EXCLUDED.effective,document_id=EXCLUDED.document_id,actor=EXCLUDED.actor,updated_at=now()`,[runId,req.group_id,original,req,id,who]);}
 for(const [contractId,value]of allocations)await client.query('INSERT INTO contract_allocations(document_id,contract_id,amount) VALUES($1,$2,$3)',[id,contractId,value.toFixed(2)]);
 const document=(await client.query('SELECT * FROM procurement_documents WHERE id=$1',[id])).rows[0];
 await client.query('INSERT INTO audit_events(actor,role,action,before,after) VALUES($1,$2,$3,$4,$5)',[who,role,'PROCUREMENT_DOCUMENT_CREATED',{requirements},document]);return{document,reused:false};
}
