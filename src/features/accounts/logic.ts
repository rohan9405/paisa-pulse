import type { Account, Transaction } from '@/lib/types';
import { diffDays } from '@/lib/dates';
export const policy = Object.freeze({staleAfterHours:48,transferWindowHours:48,alwaysReviewCustomMatches:true,autoReprocessHistory:false,maxSampleCharacters:2000,maxTemplateCharacters:600});
export function accountLabel(id?:string) {
 if(!id) return 'Account unknown';
 const [bank,kind,...digits]=id.split('-');
 return `${bank} ${kind==='card'?'credit card':'bank'} ··${digits.join('-')}`;
}
export function balanceState(a: Account, now=Date.now()) {
 if(a.balanceKnown===false || !a.asOf) return {label:'Unknown',stale:false};
 return {label:a.balanceSource==='manual'?'User-entered snapshot':'Last SMS reported',stale:now-a.asOf>policy.staleAfterHours*3600000};
}
export function accountFlows(txns:Transaction[]) {
 txns=txns.filter(t=>!t.accountingPending);
 const sum=(f:(t:Transaction)=>boolean)=>txns.filter(f).reduce((s,t)=>s+t.amountPaise,0);
 const refunded=new Map<string,number>();
 for(const t of txns) if((t.kind==='refund'||t.kind==='settlement')&&t.refundOf) refunded.set(t.refundOf,(refunded.get(t.refundOf)??0)+t.amountPaise);
 return {income:sum(t=>t.kind==='income'),spend:txns.filter(t=>t.kind==='expense'||t.kind==='commitment').reduce((s,t)=>s+Math.max(0,t.amountPaise-(refunded.get(t.id)??0)),0),transferIn:sum(t=>t.kind==='transfer'&&t.direction==='in'),transferOut:sum(t=>t.kind==='transfer'&&t.direction==='out')};
}
export function transferCandidates(txns:Transaction[],accounts:Account[]) {
 const owned=new Set(accounts.filter(a=>a.ownerConfirmed).map(a=>a.id));
 const outs=txns.filter(t=>t.direction==='out'&&t.kind==='expense'&&!t.transferGroupId&&t.transferStatus!=='rejected'&&t.accountId);
 const ins=txns.filter(t=>t.direction==='in'&&t.kind==='income'&&!t.transferGroupId&&t.transferStatus!=='rejected'&&t.accountId);
 return outs.flatMap(out=>ins.filter(inc=>inc.accountId!==out.accountId&&inc.amountPaise===out.amountPaise&&(out.occurredAt&&inc.occurredAt?Math.abs(out.occurredAt-inc.occurredAt)<=policy.transferWindowHours*3600000:Math.abs(diffDays(out.date,inc.date))<=2)).map(inc=>{
  const owners=owned.has(out.accountId!)&&owned.has(inc.accountId!);
  const references=!!out.source.externalRef&&out.source.externalRef===inc.source.externalRef;
  const strong=owners&&references;
  return {out,inc,strong,canConfirm:owners,reason:!owners?'Confirm ownership of both accounts first':strong?'Both accounts confirmed yours; amount and reference match':'Same amount within two days; references differ or are missing. This may be unrelated.'};
 })).sort((a,b)=>Number(b.strong)-Number(a.strong));
}
export function validateTransferPair(out:Transaction,inc:Transaction,accounts:Account[],txns:Transaction[]) {
 if(out.id===inc.id||!out.accountId||out.accountId===inc.accountId||out.direction!=='out'||inc.direction!=='in'||out.amountPaise!==inc.amountPaise||Math.abs(diffDays(out.date,inc.date))>2) throw new Error('The two transaction sides do not match.');
 if([out,inc].some(t=>!accounts.find(a=>a.id===t.accountId)?.ownerConfirmed)) throw new Error('Confirm both accounts belong to you first.');
 if([out,inc].some(t=>t.transferGroupId||t.userEdited)) throw new Error('This payment is already linked or edited.');
 if(txns.some(t=>t.refundOf===out.id||t.refundOf===inc.id)) throw new Error('A linked refund prevents transfer matching.');
}
export const SAMPLE='HDFC Bank A/c XX4821: INR 749.00 settled at BOOKSTORE. Ref 628899990001.';
export const TEMPLATE='HDFC Bank A/c XX{account}: INR {amount} settled at {merchant}. Ref {reference}.';
export interface LocalTemplate {id:string;sender:string;pattern:string;direction:'in'|'out';enabled:boolean;createdAt:number}
const BLOCKED=/\botp\b|one[ -]?time|verification code|\b(declined|failed|unsuccessful|pending|processing|rejected|requested)\b|will be|to be debited|scheduled|\bdue\b|statement|offer|eligible|apply now|mandate|autopay|asba|\bipo\b|blocked|hold|released|cancelled/i;
const senderCore=(s:string)=>s.toUpperCase().replace(/^[A-Z]{2}-/,'').replace(/-[A-Z]$/,'');
const supported:Record<string,string>={HDFCBK:'HDFC',HDFC:'HDFC',ICICIT:'ICICI',ICICIB:'ICICI',AXISBK:'Axis',SBIUPI:'SBI'};
export function inspectTemplate(rule:LocalTemplate,body:string,sender:string,accounts:Account[]) {
 const fail=(error:string)=>({ok:false as const,error});
 if(body.length>policy.maxSampleCharacters||rule.pattern.length>policy.maxTemplateCharacters) return fail('Message or template exceeds the allowed length.');
 if(BLOCKED.test(body)) return fail('Protected exclusion: OTP, failed/pending payment, reminder, offer, mandate or fund hold. A custom rule cannot override this.');
 if (/\b(balance|limit|outstanding)\b/i.test(body) && !/\b(debited|credited|spent|paid|received|settled|withdrawn|deducted|charged|purchase)\b/i.test(body)) return fail("Balance-only alerts are not transactions.");
 const beforeAmount=rule.pattern.split("{amount}")[0];
 if(/(?:bal(?:ance)?|limit|outstanding|amount due).{0,25}$/i.test(beforeAmount)) return fail("The amount field appears to be a balance, limit or amount due, not a transaction amount.");
 const core=senderCore(sender), bank=supported[core];
 if(!bank||core!==senderCore(rule.sender)) return fail('Sender is unknown or does not match this rule. A pasted sender is self-reported, not verified.');
 const tokens=[...rule.pattern.matchAll(/\{(\w+)\}/g)].map(m=>m[1]);
 if(!['amount','account','merchant'].every(t=>tokens.includes(t))||new Set(tokens).size!==tokens.length||tokens.some(t=>!['amount','account','merchant','reference'].includes(t))) return fail('Use exactly one {amount}, {account}, {merchant}; optional {reference}.');
 if(rule.pattern.replace(/\{\w+\}/g,'').replace(/\s/g,'').length<20) return fail('Template is too broad. Keep the bank name and stable message wording.');
 const parts=rule.pattern.split(/(\{\w+\})/);
 const patterns:Record<string,string>={amount:'([0-9]{1,3}(?:,[0-9]{2,3})*(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)',account:'([0-9]{3,6})',merchant:'([^\\n]{1,80}?)',reference:'([0-9]{6,24})'};
 const re=new RegExp('^'+parts.map(s=>s.startsWith('{')?patterns[s.slice(1,-1)]:s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('')+'$','i');
 const match=re.exec(body.trim());
 if(!match) return fail('Message does not match this exact format.');
 const fields=Object.fromEntries(tokens.map((token,i)=>[token,match[i+1]]));
 const [whole,frac='']=fields.amount.replace(/,/g,'').split('.');
 const amountPaise=Number(whole)*100+Number(frac.padEnd(2,'0'));
 if(!Number.isSafeInteger(amountPaise)||amountPaise<=0) return fail('Transaction amount must be a positive, valid paise value.');
 const matching=accounts.filter(a=>a.bank===bank&&a.last4===fields.account);
 if(matching.length!==1) return fail('Account digits do not identify one known bank account/card. Resolve the account first.');
 return {ok:true as const,accountId:matching[0].id,amountPaise,merchant:fields.merchant,reference:fields.reference,direction:rule.direction};
}
export function namespacedReference(t:Pick<Transaction,'accountId'|'direction'|'source'>) {return `${t.accountId??'unknown'}|${t.direction??'unknown'}|${t.source.externalRef??''}`;}
