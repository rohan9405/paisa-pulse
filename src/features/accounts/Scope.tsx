"use client";
import {createContext,useContext,useState,useRef,useEffect,type ReactNode} from 'react';
import {useAppData} from '@/data/store';
import {accountLabel} from './logic';
type ScopeValue={selectedIds:string[]|null;setSelectedIds:(ids:string[]|null)=>void;accountId:string;setAccountId:(id:string)=>void;includesAccount:(id?:string)=>boolean};
const Scope=createContext<ScopeValue>({selectedIds:null,setSelectedIds:()=>{},accountId:'all',setAccountId:()=>{},includesAccount:()=>true});
export const useScope=()=>useContext(Scope);
export function ScopeProvider({children}:{children:ReactNode}){
 const [selectedIds,setSelectedIds]=useState<string[]|null>(null);
 const accountId=selectedIds===null?'all':selectedIds.length===1?selectedIds[0]:'multiple';
 const includesAccount=(id?:string)=>selectedIds===null||selectedIds.includes(id??'unknown');
 return <Scope.Provider value={{selectedIds,setSelectedIds,accountId,setAccountId:id=>setSelectedIds(id==='all'?null:[id]),includesAccount}}>{children}</Scope.Provider>;
}
export function AccountPicker(){
 const {selectedIds,setSelectedIds}=useScope();const data=useAppData();const [open,setOpen]=useState(false);const ref=useRef<HTMLDivElement>(null);
 const options=[...(data?.accounts??[]).map(a=>({id:a.id,label:accountLabel(a.id)})),...((data?.txns.some(t=>!t.accountId))?[{id:'unknown',label:'Account unknown'}]:[])];
 const all=selectedIds===null||options.every(a=>selectedIds.includes(a.id));
 const label=all?'All accounts':selectedIds.length===1?accountLabel(selectedIds[0]):`${selectedIds.length} accounts`;
 useEffect(()=>{const close=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false)};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)};document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape)}},[]);
 function toggle(id:string){const current=selectedIds??options.map(a=>a.id);const next=current.includes(id)?current.filter(x=>x!==id):[...current,id];setSelectedIds(next.length===options.length?null:next);}
 return <div ref={ref} className="relative" data-preserve-case><button aria-label="Account filter" aria-expanded={open} aria-haspopup="dialog" onClick={()=>setOpen(!open)} className="btn-ghost min-h-10 max-w-[210px] gap-2 rounded-full px-3 text-xs"><span className="truncate">{label}</span><span aria-hidden="true">⌄</span></button>{open&&<div role="dialog" aria-label="Select accounts" className="absolute right-0 top-full z-50 mt-2 w-[min(300px,calc(100vw-32px))] rounded-2xl border border-white/10 bg-ink-900 p-2 shadow-2xl"><label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm"><input type="checkbox" checked={all} onChange={()=>setSelectedIds(null)}/>All accounts</label><div className="my-1 border-t border-white/10"/>{options.map(a=><label key={a.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm hover:bg-white/5"><input type="checkbox" checked={selectedIds===null||selectedIds.includes(a.id)} onChange={()=>toggle(a.id)}/>{a.label}</label>)}</div>}</div>;
}
