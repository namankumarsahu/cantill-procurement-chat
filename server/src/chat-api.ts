import type {Express,Request} from 'express';
import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {actor} from './auth.js';
import {transaction} from './db.js';
import {loadMasterData} from './repository.js';
import {selectPolicy} from './policy-selection.js';
import {processLines} from './process-lines.js';
import {businessDate} from '../../engine/src/dates.js';
import {emptyIntake,intakeTurn,assessIntake,type IntakeState,type IntakeParser} from './intake.js';
function requester(req:Request){if(req.get('x-role')!=='requester')throw new Error('Choose the requester role for chat intake');return actor(req);}
export function registerChatAPI(app:Express,pool:pg.Pool,parser?:IntakeParser){
 app.post('/api/chat/sessions',async(req,res)=>{
  const who=requester(req),date=businessDate(Date.now()),master=await loadMasterData(pool),policy=await selectPolicy(pool,date),id=randomUUID();
  const messages=[{role:'assistant',text:'What do you need? Include the item, quantity, plant, need-by date and Normal/Emergency urgency when known.'}];
  await pool.query('INSERT INTO chat_sessions(id,actor,import_id,policy_snapshot,state,messages) VALUES($1,$2,$3,$4,$5,$6)',[id,who,master.import_id,policy,emptyIntake(),JSON.stringify(messages)]);res.status(201).json({id,messages,state:emptyIntake()});
 });
 app.post('/api/chat/sessions/:id/messages',async(req,res)=>{
  const who=requester(req),id=z.uuid().parse(req.params.id),{text}=z.object({text:z.string().trim().min(1).max(4000)}).parse(req.body),date=businessDate(Date.now());
  const stored=(await pool.query('SELECT * FROM chat_sessions WHERE id=$1 AND actor=$2',[id,who])).rows[0];if(!stored)throw new Error('Chat session not found for this acting user');
  const master=await loadMasterData(pool,stored.import_id),old=stored.state as IntakeState;
  const confirmation=/^(confirm|yes|yes,? confirm)$/i.test(text);
  const turn=!confirmation?await intakeTurn(text,old,master.data,stored.policy_snapshot,date,parser):undefined;
  const result=await transaction(pool,async client=>{
   const session=(await client.query('SELECT * FROM chat_sessions WHERE id=$1 AND actor=$2 FOR UPDATE',[id,who])).rows[0];
   if(session.created_pr_no)return{id,messages:session.messages,state:session.state,pr_no:session.created_pr_no,run_id:session.run_id};
   if(session.revision!==stored.revision)throw new Error('Conversation changed. Retry the message after refreshing.');
   let state: IntakeState=turn?.state??structuredClone(old),question=turn?.question??'',candidates=turn?.candidates??[],pr_no:string|undefined,run_id:string|undefined;
   let policy=session.policy_snapshot;
   if(confirmation){
    const current=await selectPolicy(client,date);const assessed=assessIntake(state,master.data,current,date);question=assessed.question;
    if(current.version!==policy.version){policy=current;state.stage=assessed.ready?'confirmation':'collecting';question='The policy changed during intake. '+question;}
    else if(state.stage==='confirmation'&&assessed.ready){
     const n=(await client.query("SELECT nextval('chat_pr_sequence') n")).rows[0].n;pr_no=`PR-CHAT-${String(n).padStart(6,'0')}`;
     const f=state.fields,line={source_row:2,pr_no,pr_line:'1',created_at:new Date().toISOString(),requester:who,department:'Chat intake',plant:f.plant!,item_code:assessed.item?.item_code??'',description:assessed.item?.description??f.description!,quantity:f.quantity!,uom:assessed.item?.uom??f.uom!,estimated_unit_price:f.estimated_unit_price??'',need_by_date:f.need_by_date!,urgency:f.urgency!};
     const processed=await processLines(client,[line],{as_of_date:date,policy_version:current.version,import_id:master.import_id},who,`${pr_no}.csv`);run_id=processed.run_id;state.stage='created';question=`Created ${pr_no}. It is in the buyer workspace with route ${processed.rows[0].route}; no order has been placed yet.`;
     await client.query('INSERT INTO audit_events(actor,role,action,before,after) VALUES($1,$2,$3,$4,$5)',[who,'requester','PR_CREATED',session.state,{line,run_id}]);
    }
   }
   if(!question)question=assessIntake(state,master.data,policy,date).question;
   const messages=[...session.messages,{role:'user',text},{role:'assistant',text:question}];
   await client.query('UPDATE chat_sessions SET state=$1,messages=$2,revision=revision+1,policy_snapshot=$3,created_pr_no=COALESCE($4,created_pr_no),run_id=COALESCE($5,run_id),updated_at=now() WHERE id=$6',[state,JSON.stringify(messages),policy,pr_no??null,run_id??null,id]);
   return{id,state,messages,candidates,degraded:turn?.degraded??false,pr_no,run_id};
  });res.json(result);
 });
}
