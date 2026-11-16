import React,{useEffect,useState} from 'react';
import {requestJSON} from './api';
import {createRoot} from 'react-dom/client';
import {ImportData} from './ImportData';
import {Suppliers} from './Suppliers';
import {Policies} from './Policies';
import {Batch} from './Batch';
import {Chat} from './Chat';
import {Buyer} from './Buyer';
import {Audit} from './Audit';
import {Contracts} from './Contracts';
import './style.css';
function App(){
 const [screen,setScreen]=useState('chat'),[actor,setActor]=useState('Procurement Demo'),[token,setToken]=useState(''),[role,setRole]=useState('requester');
 const [prefix,setPrefix]=useState(()=>{try{return localStorage.getItem('corvo_export_prefix')??'';}catch{return '';}});
 useEffect(()=>{requestJSON('/api/status').then(s=>setPrefix(p=>p||s.export_filename_prefix)).catch(()=>setPrefix(p=>p||'yourname'));},[]);
 function changePrefix(value:string){setPrefix(value);try{localStorage.setItem('corvo_export_prefix',value);}catch{}}
 return <main><header><span className="eyebrow">CORVO ENGINEERING</span><h1>Procurement workspace</h1><p>Policy-driven purchasing, with a reason behind every decision.</p></header>
 <label>Working as<select value={role} onChange={e=>setRole(e.target.value)}><option value="requester">Requester</option><option value="buyer">Buyer</option><option value="procurement">Procurement</option></select></label>
 <label>Export filename prefix<input value={prefix} maxLength={60} onChange={e=>changePrefix(e.target.value)} placeholder="yourname"/><span>Letters, digits, underscores or hyphens. Example: {prefix||'yourname'}__run1.csv</span></label>
 <details><summary>Acting user and admin access</summary><label>Acting user<input value={actor} maxLength={100} onChange={e=>setActor(e.target.value)}/></label><label>Admin token (required for remote changes)<input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)}/></label></details>
 <nav aria-label="Workspace">{[['chat','Request an item'],['batch','Upload batch'],['buyer','Buyer workspace'],['contracts','Contracts'],['suppliers','Preferred suppliers'],['policies','Policy updates'],['audit','Audit log'],['imports','Import data']].map(([id,label])=><button className="secondary" aria-pressed={screen===id} key={id} onClick={()=>setScreen(id)}>{label}</button>)}</nav>
 {screen==='chat'?<Chat key={actor+role} actor={actor} role={role}/>:screen==='contracts'?<Contracts actor={actor} role={role} token={token}/>:screen==='buyer'?<Buyer actor={actor} role={role} token={token}/>:screen==='audit'?<Audit/>:screen==='batch'?<Batch actor={actor} prefix={prefix}/>:screen==='suppliers'?<Suppliers prefix={prefix}/>:screen==='policies'?<Policies actor={actor} token={token}/>:<ImportData actor={actor} token={token}/>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);

