import React,{useEffect,useState} from 'react';
import {requestJSON,today,actingHeaders} from './api';
interface Version{version:string;effective_date:string;lifecycle:string;approved_at:string|null}
interface Review{draft:Record<string,unknown>;base_version:string;review_hash:string;changes:{subject:string;before:string;after:string}[];rule_restatements:{rule_id:string;text:string}[];feedback_history:string[]}
interface Impact{preview_id:string;available:boolean;reason?:string;baseline_policy?:string;as_of_date?:string;original_as_of_date?:string;total_rows?:number;changed_rows?:number;route_changed_rows?:number;transitions?:{old_route:string;new_route:string;count:number}[]}
export function Policies({actor,token}:{actor:string;token:string}){
 const [versions,setVersions]=useState<Version[]>([]),[base,setBase]=useState(''),[version,setVersion]=useState(''),[date,setDate]=useState(today());
 const [mode,setMode]=useState('text'),[text,setText]=useState(''),[file,setFile]=useState<File>(),[editor,setEditor]=useState('');
 const [review,setReview]=useState<Review>(),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [impact,setImpact]=useState<Impact>(),[impactLoading,setImpactLoading]=useState(false),[feedback,setFeedback]=useState(''),[acknowledgeEmpty,setAcknowledgeEmpty]=useState(false),[previewRefresh,setPreviewRefresh]=useState(0);
 const [capabilities,setCapabilities]=useState<{llm_configured:boolean;fact_sources:Record<string,string>}>();
 async function load(preferCurrent=false){const [list,caps]=await Promise.all([requestJSON(`/api/policies?as_of_date=${date}`),requestJSON('/api/policy-capabilities')]);setVersions(list.versions);setCapabilities(caps);if((!base||preferCurrent)&&list.active_version)await chooseBase(list.active_version);}
 useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
 useEffect(()=>{
  setImpact(undefined);setAcknowledgeEmpty(false);if(!review||dirty)return;
  let cancelled=false;setImpactLoading(true);
  void requestJSON(`/api/admin/policies/${encodeURIComponent(String(review.draft.version))}/impact`,{method:'POST',headers:{...actingHeaders(actor,token),'content-type':'application/json'},body:JSON.stringify({review_hash:review.review_hash})}).then(data=>{if(!cancelled)setImpact(data);}).catch(e=>{if(!cancelled)setError(`Impact preview failed: ${e.message}`);}).finally(()=>{if(!cancelled)setImpactLoading(false);});
  return()=>{cancelled=true;};
 },[review?.review_hash,dirty,actor,token,previewRefresh]);
 async function regenerate(){if(!review)return;setBusy(true);setError('');try{
  const data=await requestJSON(`/api/admin/policies/${encodeURIComponent(String(review.draft.version))}/regenerate`,{method:'POST',headers:{...actingHeaders(actor,token),'content-type':'application/json'},body:JSON.stringify({feedback,review_hash:review.review_hash})});
  setReview(data);setEditor(JSON.stringify(data.draft,null,2));setDirty(false);setFeedback('');setNotice('Regenerated with your feedback. Review the new diff, restatements, and impact before approving.');
 }catch(e){setError(e instanceof Error?e.message:'Regeneration failed');}finally{setBusy(false);}}
 async function chooseBase(value:string){setBase(value);const data=await requestJSON(`/api/policies/${encodeURIComponent(value)}`);setEditor(JSON.stringify(data.draft,null,2));}
 async function create(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');setNotice('');try{
  const form=new FormData();form.set('version',version);form.set('effective_date',date);if(base)form.set('base_version',base);if(text)form.set('text',text);
  if(mode==='file'){if(!file)throw new Error('Choose a policy document');form.set('file',file);}
  if(mode==='json'){JSON.parse(editor);form.set('policy_json',editor);}
  const data=await requestJSON('/api/admin/policies/drafts',{method:'POST',headers:actingHeaders(actor,token),body:form});setReview(data);setEditor(JSON.stringify(data.draft,null,2));setDirty(false);await load();setNotice('Assistant: Draft created. Review the changes below; the active policy has not changed.');
 }catch(e){setError(e instanceof Error?e.message:'Draft failed');}finally{setBusy(false);}}
 async function reviewOrApprove(){if(!review)return;setBusy(true);setError('');try{
  if(dirty){const data=await requestJSON(`/api/admin/policies/${encodeURIComponent(String(review.draft.version))}`,{method:'PUT',headers:{...actingHeaders(actor,token),'content-type':'application/json'},body:JSON.stringify({policy_json:JSON.parse(editor),review_hash:review.review_hash})});setReview(data);setEditor(JSON.stringify(data.draft,null,2));setDirty(false);setNotice('Edits validated. Review the updated diff before approval.');}
  else{const data=await requestJSON(`/api/admin/policies/${encodeURIComponent(String(review.draft.version))}/approve`,{method:'POST',headers:{...actingHeaders(actor,token),'content-type':'application/json'},body:JSON.stringify({review_hash:review.review_hash,preview_id:impact?.preview_id,allow_no_batch:acknowledgeEmpty})});setNotice(`Approved ${data.policy.version}, effective ${data.policy.effective_date} (${data.lifecycle}).`);setReview(undefined);setVersion('');setText('');setFile(undefined);await load(true);}
 }catch(e){setError(e instanceof Error?e.message:'Request failed');}finally{setBusy(false);}}
 return <section><h2>Policy updates</h2><p>Create a draft, review the exact changes, then approve its effective date.</p>
 {notice&&<p role="status" className="warning">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
 {!review?<form onSubmit={create}>
 <label>Base approved policy<select value={base} onChange={e=>void chooseBase(e.target.value).catch(e=>setError(e.message))}>{versions.filter(v=>v.approved_at).map(v=><option key={v.version} value={v.version}>{v.version} - {v.effective_date}</option>)}</select></label>
 <label>New version<input required value={version} onChange={e=>setVersion(e.target.value)} placeholder="e.g. 5.1"/></label>
 <label>Effective from<input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
 <label>Draft input<select value={mode} onChange={e=>setMode(e.target.value)}><option value="text">Describe a change in chat</option><option value="file">Upload PDF or text</option><option value="json">Manual JSON editor</option></select></label>
 {!capabilities?.llm_configured&&mode!=='json'&&<p className="warning">No LLM is configured. Use the manual JSON editor to create a validated draft.</p>}
 {mode==='file'&&<label>Policy or amendment document<input type="file" required accept=".pdf,.txt,.md,.json" onChange={e=>setFile(e.target.files?.[0])}/></label>}
 {mode!=='json'&&<label>{mode==='text'?'Message to procurement assistant':'Instructions or context (optional)'}<textarea required={mode==='text'} rows={5} value={text} onChange={e=>setText(e.target.value)} placeholder="For CHK1, lower the normal spot limit and route the excess to RFQ. Preserve emergency and contract precedence."/></label>}
 {mode==='json'&&<label>Policy JSON<textarea required rows={18} spellCheck={false} value={editor} onChange={e=>setEditor(e.target.value)}/></label>}
 <button disabled={busy}>{busy?'Validating draft...':'Create draft for review'}</button>
 </form>:<>
 <h3>Review {String(review.draft.version)} against {review.base_version}</h3>
 <div className="table-scroll"><table><thead><tr><th>Change</th><th>Before</th><th>After</th></tr></thead><tbody>{review.changes.map((c,i)=><tr key={i}><th>{c.subject}</th><td>{c.before}</td><td>{c.after}</td></tr>)}</tbody></table></div>
 <h3>Rule restatements from the model</h3>
 {review.rule_restatements.length?<ul>{review.rule_restatements.map(r=><li key={r.rule_id}><strong>{r.rule_id}:</strong> {r.text}</li>)}</ul>:<p>No new model-created rule restatements. For manual edits, the validated rule diff above is authoritative.</p>}
 <h3>Impact on the current batch</h3>
 {dirty?<p>Validate your edits to calculate a fresh impact preview.</p>:impactLoading?<p role="status">Re-running the current batch under this draft...</p>:impact?.available?<>
 <p>Comparing current result policy {impact.baseline_policy} with this draft, as of {impact.as_of_date}. {impact.as_of_date!==impact.original_as_of_date&&`Both policies are evaluated on the draft-effective date to keep the comparison fair (saved run date: ${impact.original_as_of_date}).`}</p>
 <p role="status"><strong>{impact.changed_rows} of {impact.total_rows} rows change; {impact.route_changed_rows} change route.</strong></p>
 {impact.changed_rows===0&&<p className="warning">No decision changes. If you expected the amendment to affect this batch, check the scope and fallback rules before approving.</p>}
 <div className="table-scroll"><table><thead><tr><th>Old route</th><th>New route</th><th>Changed rows</th></tr></thead><tbody>{impact.transitions?.map((t,i)=><tr key={i}><td>{t.old_route}</td><td>{t.new_route}{t.old_route===t.new_route?' (other decision fields change)':''}</td><td>{t.count}</td></tr>)}</tbody></table></div>
 </>:impact&&!impact.available?<><p className="warning">{impact.reason}</p><label><span><input type="checkbox" checked={acknowledgeEmpty} onChange={e=>setAcknowledgeEmpty(e.target.checked)}/> I acknowledge that no current batch is available to preview.</span></label></>:<p>Impact preview is required before approval. Resolve the error or reopen this draft to retry.</p>}
 <button type="button" className="secondary" disabled={busy||dirty||impactLoading} onClick={()=>setPreviewRefresh(n=>n+1)}>Refresh impact preview</button>
 <details><summary>Regenerate with feedback</summary>
 <label>Feedback for the policy assistant<textarea rows={3} value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="No, the limit applies only to CHK1. Keep other plants unchanged."/></label>
 <button type="button" className="secondary" disabled={busy||dirty||!feedback.trim()} onClick={()=>void regenerate()}>Regenerate with feedback</button>
 {review.feedback_history.length>0&&<ol>{review.feedback_history.map((f,i)=><li key={i}>{f}</li>)}</ol>}
 </details>
 <details><summary>Manual JSON editor</summary><label>Edit draft (requires validation and a fresh review)<textarea rows={20} spellCheck={false} value={editor} onChange={e=>{setEditor(e.target.value);setDirty(true);}}/></label></details>
 <button disabled={busy||(!dirty&&(!impact||impactLoading||(!impact.available&&!acknowledgeEmpty)))} onClick={()=>void reviewOrApprove()}>{busy?'Saving...':dirty?'Validate edits and refresh diff':impact&&!impact.available?'Approve with no batch available':'Approve reviewed draft'}</button>
 <button type="button" className="secondary" onClick={()=>{setReview(undefined);setVersion('');setNotice('Draft remains saved; select it below to resume.');}}>Leave draft</button>
 </>}
 <details><summary>Supported condition facts</summary><p>Add named facts to fact_registry using these safe sources. Need-by uses the earliest date in the group; days until need-by is measured from its first PR creation date. Preferred supplier means the top-ranked eligible Active supplier; contract supplier means the supplier of the usable contract. Their ratings can be unavailable when no supplier exists. Ask for clarification if an amendment does not identify which supplier it means.</p><pre>{JSON.stringify(capabilities?.fact_sources,null,2)}</pre></details>
 <h3>Version history</h3><ul>{versions.map(v=><li key={v.version}>{v.version}: {v.lifecycle}, effective {v.effective_date}{!v.approved_at&&<button className="secondary" onClick={()=>void requestJSON(`/api/policies/${encodeURIComponent(v.version)}`).then(data=>{setReview(data);setEditor(JSON.stringify(data.draft,null,2));setDirty(false);}).catch(e=>setError(e.message))}>Review draft</button>}</li>)}</ul>
 </section>;
}
