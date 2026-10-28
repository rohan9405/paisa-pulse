import type {FinanceDB} from '@/data/db';
import {uid} from '@/data/db';
import {smsBridge} from '@/data/providers/sms';
import {identifyMessage,matchesAcceptedRule,mappingAccount,type Identified} from './simpleSms';
import {currentBuiltInRules} from '@/data/migrate';
import {generateDemoData} from '@/data/providers/demo';
import {smsToCandidate,type RawSms} from '@/lib/sms';
import {toISTKey} from '@/lib/dates';
import {categorize} from '@/lib/categorize';
import type {SmsFormatRule,Transaction} from '@/lib/types';
export function acceptedCandidate(sms:RawSms,rules:SmsFormatRule[]){
 const candidate=identifyMessage(sms.body,sms.address);
 return candidate.ok&&rules.some(r=>r&&typeof r.pattern==='string'&&matchesAcceptedRule(r,candidate))?candidate:null;
}
export async function applyAcceptedFormat(db:FinanceDB,result:Identified,today:string){
 const profile=await db.profile.get('me');if(!profile)throw new Error('Complete tracking setup first.');
 const bridge=smsBridge();const messages:RawSms[]=[];
 if(db.name.endsWith('-demo')){
  // Demo examples remain isolated from real inbox access.
  const {recoveryInbox}=await import('./simpleSms');
  messages.push(...recoveryInbox.map(m=>({id:m.id,address:m.sender,body:m.body,date:Date.now()})));
 }else{
  if(!bridge?.hasPermission())throw new Error('Enable Bank SMS access before applying a format.');
  let cursor=Date.parse(`${profile.trackingStart}T00:00:00+05:30`)-1;
  for(;;){const page=JSON.parse(bridge.list(cursor,500)) as {messages:RawSms[];until:number;more:boolean};messages.push(...page.messages);if(!page.more||page.until<=cursor)break;cursor=page.until;}
 }
 const rule:SmsFormatRule={id:uid('format-'),bank:result.bank,sender:result.sender,pattern:result.pattern,kind:result.kind,direction:result.direction,createdAt:Date.now()};
 let added=0;await db.transaction('rw',db.txns,db.accounts,db.profile,db.connections,db.rules,async()=>{
  const existing=await db.txns.toArray();const dismissed=new Set((await db.connections.get('sms'))?.dismissed??[]);const rules=await db.rules.toArray();const seen=new Set(existing.map(t=>`${t.accountId}|${t.direction}|${t.source.externalRef??t.source.raw}`));
  for(const sms of messages){const c=identifyMessage(sms.body,sms.address);if(!matchesAcceptedRule(rule,c)||!c.ok)continue;
   const date=toISTKey(sms.date);if(date<profile.trackingStart||date>today)continue;
   const fp=`sms|${sms.date}|${c.direction}|${c.amountPaise}`;if(dismissed.has(fp)||dismissed.has(`${fp}|${c.accountId}|${sms.id}`))continue;
   const key=`${c.accountId}|${c.direction}|${c.reference??c.body}`;
   if(seen.has(key)||existing.some(t=>t.source.providerId==='sms'&&t.source.raw===sms.body&&t.date===date))continue;
   seen.add(key);const now=Date.now();if(!await db.accounts.get(c.accountId))await db.accounts.put(mappingAccount(c));
   const classified=categorize(`${c.merchant} ${sms.body}`,rules,undefined,{merchant:c.merchant,direction:c.direction});
   const txn:Transaction={id:uid('t-'),date,accountId:c.accountId,direction:c.direction,occurredAt:sms.date,amountPaise:c.amountPaise,merchant:c.merchant,kind:c.direction==='in'?'income':'expense',category:c.direction==='in'?'Income':classified?.category??'Other',method:c.method,fingerprint:`sms|${sms.date}|${c.direction}|${c.amountPaise}|${c.accountId}|${sms.id}`,source:{providerId:db.name.endsWith('-demo')?'demo':'sms',sender:sms.address,externalRef:c.reference,raw:sms.body,importedAt:now},createdAt:now,updatedAt:now};await db.txns.add(txn);added++;
  }
  const latest=await db.profile.get('me');const saved=latest?.acceptedSmsRules??[];
  if(!saved.some(r=>r.bank===rule.bank&&r.pattern===rule.pattern&&r.direction===rule.direction))await db.profile.update('me',{acceptedSmsRules:[...saved,rule]});
 });return added;
}
/** Redact financial identifiers before the user explicitly requests support. */
export function redactTemplateSample(sample:string){return sample.replace(/\b\d{6,}\b/g,'123456789012').replace(/\b[\w.+-]+@[\w.-]+\b/g,'recipient@bank').replace(/((?:rs\.?|inr|₹)\s*)[\d,]+(?:\.\d{1,2})?/gi,(_,prefix:string)=>prefix+'123.45');}
