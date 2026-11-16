import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {migrate} from '../src/migrate.js';
import {ensureSeedPolicy,saveImport} from '../src/repository.js';
import {master} from '../../engine/test/fixtures.js';
import type {IntakeParser} from '../src/intake.js';
import type {ContractParser} from '../src/contracts.js';
import type {DraftParser} from '../src/llm.js';
export async function withApp(parser:DraftParser|undefined,work:(url:string,pool:pg.Pool)=>Promise<void>,options:{intakeParser?:IntakeParser;contractParser?:ContractParser}={}){
 const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL}),schema=`test_${randomUUID().replaceAll('-','')}`;await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});let server:ReturnType<ReturnType<typeof createApp>['listen']>|undefined;
 try{await migrate(pool);await ensureSeedPolicy(pool);const data=master();data.plants.push({plant:'CHK1',name:'Chakan'});await saveImport(pool,{data,batch:[],documents:[],warnings:[],fingerprint:'workflow-fixture',snapshot_date:'2026-01-01'},'test');
 server=createApp(pool,'test',{policyParser:parser,...options}).listen(0,'127.0.0.1');await new Promise<void>(r=>server!.once('listening',r));await work(`http://127.0.0.1:${(server.address()as{port:number}).port}`,pool);
 }finally{if(server)await new Promise<void>(r=>server!.close(()=>r()));await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
