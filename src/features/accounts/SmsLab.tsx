"use client";
import {useState} from 'react';
import {useStore,useAppData} from '@/data/store';
import {formatINR} from '@/lib/money';
import {identifyMessage,type Identification} from './simpleSms';
import {applyAcceptedFormat,redactTemplateSample} from './recovery';
import {uid} from '@/data/db';
export default function SmsRecovery(){
 const {db,today}=useStore();const data=useAppData();
 const [sample,setSample]=useState('');const [result,setResult]=useState<Identification|null>(null);const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);
 const requests=data?.profile?.templateRequests??[];
 async function accept(){if(!db||!result?.ok||busy)return;setBusy(true);try{const count=await applyAcceptedFormat(db,result,today);setNotice(`${count} message${count===1?'':'s'} added. Rule saved.`);setResult(null);setSample('');}catch(e){setNotice(e instanceof Error?e.message:'Could not apply this format.');}finally{setBusy(false)}}
 async function request(){if(!db||busy)return;setBusy(true);try{const request={id:uid('request-'),sample:redactTemplateSample(sample),bank:sample.match(/\b(HDFC|ICICI|SBI|Axis|Kotak)\b/i)?.[1],status:'queued' as const,createdAt:Date.now()};await db.transaction('rw',db.profile,async()=>{const profile=await db.profile.get('me');if(!profile)throw new Error('Complete tracking setup first.');await db.profile.update('me',{templateRequests:[request,...(profile.templateRequests??[])].slice(0,100)});});setNotice('Request saved on this phone. Support submission is not connected yet.');setResult(null);setSample('');}catch{setNotice('Could not save the request. Try again.');}finally{setBusy(false)}}
 return <div className="space-y-4" data-preserve-case><textarea aria-label="Sample SMS" className="input min-h-32 py-3 text-sm" placeholder="Paste a sample SMS" value={sample} maxLength={2000} onChange={e=>{setSample(e.target.value);setResult(null);setNotice('')}}/><button className="btn-primary" disabled={!sample.trim()||busy} onClick={()=>{setNotice('');setResult(identifyMessage(sample))}}>Submit</button>
 {result?.ok&&<div className="rounded-2xl border border-white/10 p-4"><dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">{[['Sender',result.sender??'Not included'],['Bank',result.bank],['Account / card',`${result.kind==='card'?'Card':'Account'} ··${result.accountNumber}`],['Amount',formatINR(result.amountPaise)],['Direction',result.direction==='out'?'Money out':'Money in'],['Merchant',result.merchant]].map(([label,value])=><div key={label} className="contents"><dt className="text-ink-400">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl><button className="btn-primary mt-5 w-full text-xs" disabled={busy} onClick={accept}>Accept & apply to matching messages</button></div>}
 {result&&!result.ok&&<div className="rounded-2xl border border-white/10 p-4"><p className="text-sm">{result.reason}</p>{!result.protected&&<button className="btn-ghost mt-3" disabled={busy} onClick={request}>Save template request</button>}</div>}
 {notice&&<p className="text-sm text-lime" role="status">{notice}</p>}
 {requests.length>0&&<details className="border-t border-white/10 pt-3"><summary className="cursor-pointer text-sm">Template requests · {requests.length}</summary><div className="mt-3 space-y-2">{requests.map(r=><div key={r.id} className="flex justify-between gap-3 text-xs"><span>{new Date(r.createdAt).toLocaleDateString('en-IN')}{r.bank?` · ${r.bank}`:''}</span><span className="text-ink-400">{r.status==='sent'?'Sent':'Saved on device'}</span></div>)}</div></details>}
 </div>;
}
