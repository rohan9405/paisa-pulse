"use client";
import {useState} from 'react';
import Link from 'next/link';
import {useAppData,useStore} from '@/data/store';
import {formatINR,parseAmountToPaise} from '@/lib/money';
import {accountLabel,balanceState,accountFlows} from './logic';
import {useScope} from './Scope';
import {TxnRow} from '@/components/TxnRow';
import {TxnEditor} from '@/components/TxnEditor';
import type {Account,Transaction} from '@/lib/types';
const stamp=(n:number)=>n?new Date(n).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'No snapshot';
export function BalanceOverview({compact=false}:{compact?:boolean}){
 const data=useAppData();const {includesAccount}=useScope();const [visible,setVisible]=useState(false);
 const accounts=(data?.accounts??[]).filter(a=>includesAccount(a.id)).slice().sort((a,b)=>Number(a.kind==='card')-Number(b.kind==='card'));
 return <section className="my-4" aria-label="Account balances" data-preserve-case>
 <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Balances</h2><button type="button" aria-label={visible?'Hide balances':'Show balances'} aria-pressed={visible} onClick={()=>setVisible(!visible)} className="grid h-9 w-9 place-items-center rounded-full text-ink-400 hover:bg-white/5"><svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{!visible&&<path d="m3 3 18 18"/>}</svg></button></div>
 <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{accounts.map(a=><div key={a.id} className="rounded-2xl border border-white/[0.06] bg-ink-850 px-3 py-2.5" data-testid="balance-chip"><div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate text-xs font-medium">{a.bank} {a.kind==='card'?'card':'bank'} xx{a.last4}</span><span className="num shrink-0 text-sm font-semibold" data-testid="balance-value">{a.balanceKnown===false?'—':visible?formatINR(a.balancePaise):'••••'}</span></div><p className="mt-1 truncate text-[10px] text-ink-400">{a.asOf?`${a.balanceSource==='manual'?'Last updated':'Last SMS'} · ${stamp(a.asOf)}`:'No SMS yet'}</p></div>)}</div>
 {accounts.length===0&&<p className="text-xs text-ink-400">No balance available.</p>}</section>;
}

export default function Accounts(){
 const rawData=useAppData(); const {db}=useStore();const {accountId,setAccountId,includesAccount}=useScope();
 const data=rawData?{...rawData,accounts:rawData.accounts.filter(a=>includesAccount(a.id)),txns:rawData.txns.filter(t=>includesAccount(t.accountId))}:undefined;
 const [edit,setEdit]=useState<Account|null>(null);const [alias,setAlias]=useState('');const [owner,setOwner]=useState(false);const [amount,setAmount]=useState('');const [error,setError]=useState('');const [estimate,setEstimate]=useState(false);const [editingTxn,setEditingTxn]=useState<Transaction|null>(null);
 const selected=data?.accounts.find(a=>a.id===accountId); const txns=data?.txns.filter(t=>selected?t.accountId===selected.id:true)??[];
 const flow=accountFlows(txns);
 const after=selected?txns.filter(t=>!t.accountingPending&&(t.occurredAt??0)>selected.asOf):[];
 const delta=after.reduce((n,t)=>n+(t.direction==='in'?t.amountPaise:t.direction==='out'?-t.amountPaise:0),0);
 const open=(a:Account)=>{setEdit(a);setAlias(a.alias??'');setOwner(!!a.ownerConfirmed);setAmount('');setError('');};
 async function save(){if(!edit||!db)return;const value=amount.trim()?parseAmountToPaise(amount):null;if(amount.trim()&&(value===null||value<0)){setError('Enter a non-negative rupee balance with up to two decimals.');return;}await db.accounts.put({...edit,alias:alias.trim().slice(0,50),ownerConfirmed:owner,...(value!==null?{balancePaise:value,asOf:Date.now(),balanceSource:'manual' as const,balanceKnown:true}:{})});setEdit(null);}
 return <div className="mx-auto max-w-3xl" data-preserve-case><h1 className="text-[28px] font-bold">Accounts</h1><BalanceOverview/>
 <section id="account-details" className="card scroll-mt-20 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Account details & activity</h2></div>
 {selected&&<><div className="mt-4 flex flex-wrap gap-2"><button className="btn-ghost text-xs" onClick={()=>open(selected)}>Edit ownership / snapshot</button><Link href="/transactions" className="btn-ghost text-xs">Open filtered Activity →</Link></div>{selected.kind==='account'&&selected.balanceKnown!==false&&<><button className="mt-3 text-xs text-lime underline" onClick={()=>setEstimate(!estimate)}>{estimate?'Hide':'Show'} estimate from recorded activity</button>{estimate&&<div className="mt-3 rounded-xl border border-amber/30 p-3 text-sm"><p className="font-semibold">Estimated from known messages: {formatINR(selected.balancePaise+delta)}</p></div>}</>}</>}
 <div className="my-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{[['Income',flow.income],['Net spending',flow.spend],['Transfers in',flow.transferIn],['Transfers out',flow.transferOut]].map(([k,v])=><div key={k} className="rounded-xl bg-white/[0.035] p-3"><p className="text-xs text-ink-400">{k}</p><p className="num mt-1 text-lg">{formatINR(Number(v))}</p></div>)}</div>
 {txns.slice().sort((a,b)=>b.createdAt-a.createdAt).map(t=><TxnRow key={t.id} t={t} onClick={()=>setEditingTxn(t)}/>)}
 </section>
 {edit&&<section role="dialog" aria-label="Edit account" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><div className="card w-full max-w-lg space-y-4 p-5"><h2 className="font-semibold">{accountLabel(edit.id)}</h2><label className="block text-xs">Account nickname<input className="input mt-2" value={alias} maxLength={50} onChange={e=>setAlias(e.target.value)}/></label><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={owner} onChange={e=>setOwner(e.target.checked)}/>I confirm this account / card belongs to me</label><label className="block text-xs">Optional new {edit.kind==='card'?'available-credit':'balance'} snapshot (₹)<input className="input mt-2" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Leave blank to keep the reported snapshot"/></label><p className="text-xs text-ink-400">A value entered here is labelled User-entered snapshot, timestamped now. It does not create income or an expense.</p>{error&&<p className="text-xs text-coral" role="alert">{error}</p>}<div className="flex gap-2"><button className="btn-primary" onClick={save}>Save account</button><button className="btn-ghost" onClick={()=>setEdit(null)}>Cancel</button></div></div></section>}
 <TxnEditor txn={editingTxn} onClose={()=>setEditingTxn(null)}/></div>
}
