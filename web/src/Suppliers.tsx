import React,{useState} from 'react';
interface Supplier {supplier_id:string;name:string;rank:number;score:number;reference_price:string;reference_source:string;po_count:number;latest_po_date:string|null;factors:Record<string,number>;contributions:Record<string,number>}
interface List {as_of_date:string;policy_version:string;import_id:string;weights:Record<string,number>;items:{item_code:string;description:string;suppliers:Supplier[]}[]}
export function Suppliers(){
 const [date,setDate]=useState(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
 const [result,setResult]=useState<List>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[filter,setFilter]=useState('');
 async function load(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{const r=await fetch(`/api/preferred-suppliers?as_of_date=${date}`);const data=await r.json();if(!r.ok)throw new Error(data.error);setResult(data);}catch(e){setError(e instanceof Error?e.message:'Request failed');}finally{setBusy(false);}}
 return <section><h2>Preferred suppliers</h2><p>See who qualifies on a chosen date, their reference price, and why they rank here.</p>
 <form onSubmit={load}><label>As of date<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label><button disabled={busy}>{busy?'Loading...':'Calculate preferred lists'}</button></form>
 {error&&<p role="alert" className="error">{error}</p>}
 {result&&<><p>Policy {result.policy_version} - as of {result.as_of_date}. <a href={`/api/preferred-suppliers/export?as_of_date=${result.as_of_date}&policy_version=${encodeURIComponent(result.policy_version)}&import_id=${result.import_id}`}>Download top 3 per item (CSV)</a></p>
 <p>Weights: {Object.entries(result.weights).map(([k,v])=>`${k.replaceAll('_',' ')} ${Math.round(v*100)}%`).join(' / ')}</p>
 <label>Find an item<input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Item code or description"/></label>
 {result.items.filter(i=>`${i.item_code} ${i.description}`.toLowerCase().includes(filter.toLowerCase())).map(item=><details key={item.item_code}><summary>{item.item_code} - {item.description} - {item.suppliers.length} eligible suppliers</summary>
 {!item.suppliers.length&&<p>No Active supplier has eligible item purchase or contract history.</p>}
 {item.suppliers.map(s=><article key={s.supplier_id}><h3>#{s.rank} {s.name} ({s.supplier_id}) - {(s.score*100).toFixed(2)}/100</h3><p>Reference INR {s.reference_price} from {s.reference_source}. {s.po_count} qualifying POs; latest {s.latest_po_date??'none'}.</p>
 <div className="table-scroll"><table><thead><tr><th>Factor</th><th>Normalized</th><th>Weight</th><th>Points / 100</th></tr></thead><tbody>{Object.entries(s.factors).map(([k,v])=><tr key={k}><td>{k.replaceAll('_',' ')}</td><td>{v.toFixed(3)}</td><td>{Math.round(result.weights[k]*100)}%</td><td>{(s.contributions[k]*100).toFixed(2)}</td></tr>)}</tbody></table></div></article>)}
 </details>)}</>}
 </section>;
}
