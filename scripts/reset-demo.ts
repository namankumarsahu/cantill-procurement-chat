import {createPool} from '../server/src/db.js';
import {loadEnv,migrate} from '../server/src/migrate.js';
import {resetDemo} from '../server/src/reset-demo.js';
loadEnv();const pool=createPool();
try{await migrate(pool);const confirm=process.argv.includes('--confirm-reset');console.log(JSON.stringify(await resetDemo(pool,confirm,process.env.SEED_ACTOR??'demo-reset'),null,2));if(!confirm)console.log('Preview only. Run npm run reset:demo -- --confirm-reset to delete listed policies and all runs.');}finally{await pool.end();}
