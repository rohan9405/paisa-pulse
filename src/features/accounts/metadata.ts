import {parseBankSms,bankSenders} from '@/lib/sms';
import type {Account,Transaction} from '@/lib/types';
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function accountKey(a:Pick<Account,'bank'|'kind'|'last4'>){return `${a.bank}-${a.kind}-${a.last4}`;}
/** Recover identity only; never reclassify an existing payment during an upgrade. */
export function recoverAccountMetadata(t:Transaction,known:Account[]):Partial<Transaction>{
 const raw=t.source.raw??'';const sender=t.source.sender;
 const parsed=sender?parseBankSms({address:sender,body:raw}):null;
 const direction=t.direction??parsed?.direction??t.fingerprint?.match(/^sms\|\d+\|(in|out)\|/)?.[1] as 'in'|'out'|undefined;
 const digits=parsed?.account??raw.match(/\b(?:a\/c|acc|acct|account|card)(?:\s*(?:no\.?|number|ending(?:\s*with)?))?[\s:.*x]*(\d{3,6})\b/i)?.[1];
 const banks=[...new Set(bankSenders().map(b=>b.bank))].filter(bank=>new RegExp(`\\b${escape(bank)}\\b`,'i').test(raw));
 const bank=parsed?.bank??(banks.length===1?banks[0]:undefined);
 const kind=parsed?(parsed.isCard?'card':'account'):/\bcard\b/i.test(raw)&&!/\b(a\/c|acc|acct|account)\b/i.test(raw)?'card':'account';
 const match=bank&&digits?known.find(a=>a.bank===bank&&a.kind===kind&&a.last4===digits):undefined;
 const identified=match?.id??(bank&&digits?`${bank}-${kind}-${digits}`:undefined);
 return {direction:direction??(['income','refund','settlement'].includes(t.kind)?'in':t.kind==='transfer'?undefined:'out'),...(!t.accountMappingEdited&&!t.accountId&&identified?{accountId:identified}:{}),occurredAt:t.occurredAt??(t.source.providerId==='sms'?Number(t.fingerprint?.split('|')[1])||undefined:undefined)};
}
