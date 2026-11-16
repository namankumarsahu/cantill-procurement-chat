import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

interface Preview { preview?: boolean; fingerprint?: string; snapshot_date?: string; warnings?: string[]; counts?: Record<string, number>; contracts?: unknown[]; import_id?: string; reused?: boolean }
function App() {
  const [actor, setActor] = useState('Procurement Demo'), [token, setToken] = useState('');
  const [file, setFile] = useState<File>(), [snapshot, setSnapshot] = useState('');
  const [result, setResult] = useState<Preview>(), [status, setStatus] = useState<unknown>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
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
  return <main>
    <header><span className="eyebrow">CORVO ENGINEERING</span><h1>Procurement workspace</h1><p>Import your source data, then review deterministic purchasing decisions.</p></header>
    <section><h2>Import master data</h2><p>Preview the kit, reconcile signed contracts, and confirm the extracted terms before saving a new snapshot.</p>
      <form onSubmit={importKit}>
        <label>Acting user<input required maxLength={100} value={actor} onChange={e => setActor(e.target.value)} /></label>
        <label>Admin token <span>(required for remote access)</span><input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label>
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
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
