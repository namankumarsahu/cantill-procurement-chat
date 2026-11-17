import React, { useEffect, useState } from 'react';

interface Preview { preview?: boolean; fingerprint?: string; snapshot_date?: string; warnings?: string[]; counts?: Record<string, number>; contracts?: unknown[]; import_id?: string; reused?: boolean }
export function ImportData({actor,token}:{actor:string;token:string}) {
  const [file, setFile] = useState<File>(), [snapshot, setSnapshot] = useState('');
  const [result, setResult] = useState<Preview>(), [status, setStatus] = useState<unknown>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [resetPreview,setResetPreview]=useState<unknown>(),[resetConfirmed,setResetConfirmed]=useState(false);
  async function resetDemo(confirm:boolean){setBusy(true);setError('');try{const response=await fetch('/api/admin/reset-demo',{method:'POST',headers:{'content-type':'application/json','x-actor':actor,authorization:`Bearer ${token}`},body:JSON.stringify({confirm_reset:confirm,clear_test_history:true})});const data=await response.json();if(!response.ok)throw Error(data.error);setResetPreview(data);setResetConfirmed(false);await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const refresh = () => fetch('/api/status').then(r => r.json()).then(setStatus).catch(() => setError('Cannot connect to the API.'));
  useEffect(() => { void refresh(); }, []);
  async function importKit(event: React.FormEvent) {
    event.preventDefault(); if (!file) return;
    setBusy(true); setError('');
    try {
      const body = new FormData(); body.set('file', file);
      if (snapshot) body.set('snapshot_date', snapshot);
      if (result?.preview && result.fingerprint) body.set('confirm_fingerprint', result.fingerprint);
      const response = await fetch('/api/admin/import-master', { method: 'POST', headers: { 'x-actor': actor, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Import failed');
      setResult(data); if (!data.preview) await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed'); }
    finally { setBusy(false); }
  }
  return <>
    <section><h2>Import master data</h2><p>Preview the kit, reconcile signed contracts, and confirm the extracted terms before saving a new snapshot.</p>
      <form onSubmit={importKit}>
        <label>Task kit ZIP<input required type="file" accept=".zip" onChange={e => { setFile(e.target.files?.[0]); setResult(undefined); }} /></label>
        <label>Register snapshot date <span>(optional when kit README supplies it)</span><input type="date" value={snapshot} onChange={e => { setSnapshot(e.target.value); setResult(undefined); }} /></label>
        {result?.counts && <dl>{Object.entries(result.counts).map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{value}</dd></div>)}</dl>}
        {result?.warnings?.map(w => <p className="warning" key={w}>{w}</p>)}
        {result?.preview && <details open><summary>Review extracted contract terms</summary><pre>{JSON.stringify(result.contracts, null, 2)}</pre></details>}
        {error && <p role="alert" className="error">{error}</p>}
        {result?.import_id && <p role="status">{result.reused ? 'This snapshot was already imported.' : 'Import saved.'} Snapshot: {result.import_id}</p>}
        <button disabled={busy || !file}>{busy ? 'Reading kit…' : result?.preview ? 'Confirm and import' : 'Preview import'}</button>
      </form>
    </section>
    <section><h2>Current data</h2><pre>{JSON.stringify(status, null, 2) || 'Loading…'}</pre></section>
    <section><details><summary>Reset disposable demo</summary><p>Deletes amendments/drafts, batch results, raw PRs, chats, approvals/orders and test audit history. Keeps imported masters and contract opening balances. Requires admin token and ALLOW_DEMO_RESET=true on the server.</p><button className="secondary" disabled={busy||!token} onClick={()=>resetDemo(false)}>Preview full demo reset</button>{resetPreview!==undefined&&<pre>{JSON.stringify(resetPreview,null,2)}</pre>}{(resetPreview as {dry_run?:boolean})?.dry_run&&<><label><input type="checkbox" checked={resetConfirmed} onChange={e=>setResetConfirmed(e.target.checked)}/>I understand this permanently clears the demo test data.</label><button disabled={busy||!token||!resetConfirmed} onClick={()=>resetDemo(true)}>Confirm full demo reset</button></>}{error&&<p className="error" role="alert">{error}</p>}</details></section>
  </>;
}
