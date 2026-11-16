import type {Express,Request} from 'express';
import type multer from 'multer';
import type pg from 'pg';
import {z} from 'zod';
import {actor,adminOnly} from './auth.js';
import {transaction} from './db.js';
import {loadMasterData} from './repository.js';
import {businessDate} from '../../engine/src/dates.js';
import {extractPDF,sha256,type SourceDocument} from './import-kit.js';
import {confirmContract,createContractDraft,loadDocuments,reconcileContracts,safeDocumentName,type ContractParser} from './contracts.js';
function buyer(req:Request){const role=req.get('x-role');if(!['buyer','procurement'].includes(role??''))throw new Error('Choose buyer or procurement role');return{who:actor(req),role:role!};}
export function registerContractAPI(app:Express,pool:pg.Pool,upload:multer.Multer,token?:string,parser?:ContractParser){
 app.get('/api/contracts',async(req,res)=>{
  const asOf=z.iso.date().parse(req.query.as_of_date??businessDate(Date.now())),master=await loadMasterData(pool),documents=await loadDocuments(pool,master.import_id);
  const allocations=(await pool.query('SELECT contract_id,sum(amount)::text amount FROM contract_allocations GROUP BY contract_id')).rows;
  res.json({import_id:master.import_id,as_of_date:asOf,...reconcileContracts(master.data,documents,asOf),allocations,master:{items:master.data.items,suppliers:master.data.suppliers},drafts:(await pool.query('SELECT id,fields,method,actor,created_at FROM contract_drafts WHERE confirmed_import_id IS NULL AND base_import_id=$1 ORDER BY created_at DESC',[master.import_id])).rows});
 });
 app.get('/api/contracts/documents/:sha',async(req,res)=>{const sha=z.string().regex(/^[a-f0-9]{64}$/).parse(req.params.sha),master=await loadMasterData(pool),doc=(await loadDocuments(pool,master.import_id)).find(d=>d.sha256===sha);if(!doc)throw new Error('PDF not found');res.type('application/pdf').set('Content-Disposition','inline').send(doc.bytes);});
 app.post('/api/contracts/drafts',adminOnly(token),upload.single('file'),async(req,res)=>{
  const {who,role}=buyer(req),body=z.object({source_sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),contract_id:z.string().optional()}).parse(req.body??{});let document:SourceDocument|undefined;
  if(req.file){if(req.file.buffer.subarray(0,5).toString()!=='%PDF-')throw new Error('Upload a PDF document');const hash=sha256(req.file.buffer);let text='';try{text=await extractPDF(req.file.buffer);}catch{/* Scanned/unreadable PDFs remain available for manual transcription. */}document={filename:safeDocumentName(req.file.originalname,hash),sha256:hash,bytes:req.file.buffer,text};}
  else if(body.source_sha256){const master=await loadMasterData(pool);document=(await loadDocuments(pool,master.import_id)).find(d=>d.sha256===body.source_sha256);if(!document)throw new Error('PDF not found');}
  res.status(201).json(await createContractDraft(pool,who,{document,contract_id:body.contract_id,parser,role}));
 });
 app.get('/api/contracts/drafts/:id',async(req,res)=>{const id=z.uuid().parse(req.params.id),d=(await pool.query('SELECT id,base_import_id,fields,method,notes,filename AS source_filename,source_text,confirmed_import_id FROM contract_drafts WHERE id=$1',[id])).rows[0];if(!d)throw new Error('Draft not found');res.json(d);});
 app.post('/api/contracts/drafts/:id/confirm',adminOnly(token),async(req,res)=>{const {who,role}=buyer(req),id=z.uuid().parse(req.params.id);res.json(await transaction(pool,c=>confirmContract(c,id,req.body,who,role)));});
}
