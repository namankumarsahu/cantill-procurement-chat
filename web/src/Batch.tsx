import React,{useEffect,useState} from 'react';
import {requestJSON} from './api';
interface Result{run_id:string;batch_id:string;replaced:boolean;policy_version:string;as_of_date:string;rows:{pr_no:string;pr_line:string;route:string;group_value_inr:string;reason:string}[];export_url:string}
export function Batch({actor}:{actor:string}){
 const [file,setFile]=useState<File>(),[date,setDate]=useState(''),[version,setVersion]=useState(''),[versions,setVersions]=useState<string[]>([]),[result,setResult]=useState<Result>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{void requestJSON('/api/policies').then(d=>setVersions(d.versions.filter((v:{approved_at:unknown})=>v.approved_at).map((v:{version:string})=>v.version))).catch(e=>setError(e.message));},[]);
 async function run(e:React.FormEvent){e.preventDefault();if(!file)return;setBusy(true);setError('');try{const body=new FormData();body.set('file',file);if(date)body.set('as_of_date',date);if(version)body.set('policy_version',version);setResult(await requestJSON('/api/process-batch',{method:'POST',headers:{'x-actor':actor},body}));}catch(e){setError(e instanceof Error?e.message:'Batch failed');}finally{setBusy(false);}}
 return <section><h2>Process a batch</h2><p>Reprocessing identical CSV content replaces its current decisions and PO proposals. Previous results stay in the audit history. Download a baseline export before running an amendment.</p><form onSubmit={run}>
 <label>PR CSV<input required type="file" accept=".csv" onChange={e=>setFile(e.target.files?.[0])}/></label>
 <label>As of date (blank uses latest input creation date)<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
 <label>Policy version<select value={version} onChange={e=>setVersion(e.target.value)}><option value="">Automatic for as-of date</option>{versions.map(v=><option key={v}>{v}</option>)}</select></label>
 <button disabled={busy||!file}>{busy?'Processing...':'Process batch'}</button></form>
 {error&&<p role="alert" className="error">{error}</p>}{result&&<><p role="status">{result.replaced?'Replaced existing results':'Processed new batch'}: {result.rows.length} rows, policy {result.policy_version}, as of {result.as_of_date}. <a href={result.export_url}>Download CSV</a></p>
 <dl>{[...new Set(result.rows.map(r=>r.route))].sort().map(route=><div key={route}><dt>{route}</dt><dd>{result.rows.filter(r=>r.route===route).length}</dd></div>)}</dl>
 <details><summary>Decision rows and reasons</summary><div className="table-scroll"><table><thead><tr><th>PR / line</th><th>Route</th><th>Value INR (exact)</th><th>Reason</th></tr></thead><tbody>{result.rows.map((r,i)=><tr key={i}><td>{r.pr_no}/{r.pr_line}</td><td>{r.route}</td><td>{r.group_value_inr}</td><td>{r.reason}</td></tr>)}</tbody></table></div></details></>}
 </section>;
}
