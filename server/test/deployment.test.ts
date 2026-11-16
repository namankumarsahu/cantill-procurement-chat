import {test} from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import {createApp} from '../src/app.js';
import {withApp} from './policy-fixture.js';
test('health returns 503 without leaking database details',async()=>{
 const app=createApp({query:async()=>{throw Error('private connection string');}}as unknown as pg.Pool,'test'),server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{const response=await fetch(`http://127.0.0.1:${(server.address()as{port:number}).port}/api/health`);assert.equal(response.status,503);assert.deepEqual(await response.json(),{status:'unavailable'});}finally{await new Promise<void>(r=>server.close(()=>r()));}
});
test('remote reset requires a token, explicit enablement and confirmation; dry run preserves data',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const old=process.env.ALLOW_DEMO_RESET,oldMode=process.env.NODE_ENV;delete process.env.ALLOW_DEMO_RESET;process.env.NODE_ENV='production';
 try{await withApp(undefined,async(url,pool)=>{
  const headers={'content-type':'application/json','x-actor':'deployment-check'};
  async function reset(body:unknown,token?:string){const response=await fetch(url+'/api/admin/reset-demo',{method:'POST',headers:{...headers,...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});return{status:response.status,data:await response.json()};}
  assert.equal((await reset({})).status,401);assert.equal((await reset({},'wrong')).status,401);assert.equal((await reset({},'test')).status,403);
  process.env.ALLOW_DEMO_RESET='true';assert.equal((await reset({})).status,401);
  const preview=await reset({},'test');assert.equal(preview.status,200);assert.equal(preview.data.dry_run,true);assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='DEMO_RESET'")).rows[0].n,0);
  assert.equal((await reset({confirm_reset:'yes'},'test')).status,400);
  assert.equal((await reset({confirm_reset:true},'test')).data.dry_run,false);
  assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE actor='deployment-check' AND action='DEMO_RESET'")).rows[0].n,1);
 });}finally{if(old===undefined)delete process.env.ALLOW_DEMO_RESET;else process.env.ALLOW_DEMO_RESET=old;if(oldMode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldMode;}
});
