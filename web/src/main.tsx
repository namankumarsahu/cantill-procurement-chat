import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ImportData} from './ImportData';
import {Suppliers} from './Suppliers';
import {Policies} from './Policies';
import {Batch} from './Batch';
import './style.css';
function App(){
 const [screen,setScreen]=useState('batch'),[actor,setActor]=useState('Procurement Demo'),[token,setToken]=useState('');
 return <main><header><span className="eyebrow">CORVO ENGINEERING</span><h1>Procurement workspace</h1><p>Policy-driven purchasing, with a reason behind every decision.</p></header>
 <details><summary>Acting user and admin access</summary><label>Acting user<input value={actor} maxLength={100} onChange={e=>setActor(e.target.value)}/></label><label>Admin token (required for remote changes)<input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)}/></label></details>
 <nav aria-label="Workspace">{[['batch','Process batch'],['suppliers','Preferred suppliers'],['policies','Policy updates'],['imports','Import data']].map(([id,label])=><button className="secondary" aria-pressed={screen===id} key={id} onClick={()=>setScreen(id)}>{label}</button>)}</nav>
 {screen==='batch'?<Batch actor={actor}/>:screen==='suppliers'?<Suppliers/>:screen==='policies'?<Policies actor={actor} token={token}/>:<ImportData actor={actor} token={token}/>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
