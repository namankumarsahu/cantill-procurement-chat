import type {Express} from 'express';
import type pg from 'pg';
import {z} from 'zod';
import {stringify} from 'csv-stringify/sync';
import {loadMasterData} from './repository.js';
import {selectPolicy} from './policy-selection.js';
import {transaction} from './db.js';
import {preferredSupplierLists} from '../../engine/src/ranking.js';
export const preferredColumns=['item_code','rank','supplier_id','reference_price'];
export function preferredCSV(items:ReturnType<typeof preferredSupplierLists>):string{
  return stringify(items.flatMap(item=>item.suppliers.slice(0,3).map(s=>({item_code:item.item_code,rank:s.rank,supplier_id:s.supplier_id,reference_price:s.reference_price}))),{header:true,columns:preferredColumns,escape_formulas:true,record_delimiter:'\r\n'});
}
const query=z.strictObject({as_of_date:z.iso.date(),policy_version:z.string().optional(),import_id:z.uuid().optional(),item_code:z.string().optional()});
export function registerSupplierAPI(app:Express,pool:pg.Pool):void{
  const handler:import('express').RequestHandler=async(req,res)=>{
    const q=query.parse(req.query);
    const result=await transaction(pool,async client=>{
      const master=await loadMasterData(client,q.import_id),policy=await selectPolicy(client,q.as_of_date,q.policy_version);
      if(q.item_code&&!master.data.items.some(i=>i.item_code===q.item_code)) throw new Error('Unknown item code');
      const items=preferredSupplierLists(master.data,q.as_of_date,policy).filter(i=>!q.item_code||i.item_code===q.item_code);
      return {as_of_date:q.as_of_date,policy_version:policy.version,import_id:master.import_id,weights:policy.ranking.weights,items};
    },'ISOLATION LEVEL REPEATABLE READ');
    if(req.path.endsWith('/export')) res.type('text/csv').attachment(`preferred-suppliers-${q.as_of_date}.csv`).send(preferredCSV(result.items));
    else res.json(result);
  };
  app.get('/api/preferred-suppliers',handler);app.get('/api/preferred-suppliers/export',handler);
}
