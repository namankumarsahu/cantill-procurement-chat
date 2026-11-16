import {useState} from 'react';
import {requestJSON,actingHeaders} from './api';
export function Chat({actor,role}:{actor:string;role:string}){
 const [session,setSession]=useState<any>(),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function send(message?:string){setBusy(true);setError('');try{
  const headers={...actingHeaders(actor,''),'x-role':role,'content-type':'application/json'};
  const s=session??await requestJSON('/api/chat/sessions',{method:'POST',headers});
  setSession(await requestJSON(`/api/chat/sessions/${s.id}/messages`,{method:'POST',headers,body:JSON.stringify({text:message??text})}));setText('');
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section><h2>Request an item</h2><p>Tell us what you need. We’ll clarify the specification before creating a PR.</p>
 {role!=='requester'?<p className="warning">Choose the Requester role above to create a request.</p>:<>
 <div aria-live="polite">{session?.messages.map((m:any,i:number)=><article key={i}><strong>{m.role==='user'?actor:'Procurement assistant'}</strong><p>{m.text}</p></article>)}</div>
 {session?.degraded&&<p className="warning">Using local matching and field parsing. You can continue without an LLM.</p>}
 {session?.candidates?.map((c:any)=><button className="secondary" disabled={busy} key={c.item_code} onClick={()=>send(c.item_code)}>{c.item_code} — {c.description}</button>)}
 {session?.pr_no?<p role="status">{session.pr_no} is ready in the buyer workspace. <button className="secondary" onClick={()=>setSession(undefined)}>Start another request</button></p>:<form onSubmit={e=>{e.preventDefault();void send();}}>
 <label>Your request or reply<textarea value={text} onChange={e=>setText(e.target.value)} rows={3} placeholder="Need 100 hex bolts M10x40 for CHK1 by 2026-11-24, Normal"/></label>
 {session?.state.stage==='confirmation'&&!text.trim()?<button type="button" disabled={busy} onClick={()=>send('confirm')}>Confirm and create PR</button>:<button disabled={busy||!text.trim()}>{busy?'Checking…':'Send message'}</button>}
 </form>}</>}{error&&<p className="error" role="alert">{error}</p>}</section>;
}
