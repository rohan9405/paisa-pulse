import {parseBankSms,bankForSender} from '@/lib/sms';
import type {Account,Transaction} from '@/lib/types';
import {parseAmountToPaise} from '@/lib/money';
export const RECOVERY_SAMPLE='HDFC Bank A/c XX4821: INR 749.00 settled at BOOKSTORE. Ref 628899990001.';
export const recoveryInbox=[
 {id:'recovery-1',sender:'VM-HDFCBK-S',body:RECOVERY_SAMPLE},
 {id:'recovery-2',sender:'VM-HDFCBK-S',body:'HDFC Bank A/c XX4821: INR 1,249.50 settled at LOCAL SHOP. Ref 628899990002.'},
 {id:'recovery-3',sender:'VM-HDFCBK-S',body:'HDFC Bank A/c XX4821: INR 99.00 settled at COFFEE BAR. Ref 628899990003.'},
 {id:'recovery-failed',sender:'VM-HDFCBK-S',body:'HDFC Bank A/c XX4821: INR 749.00 settled at BOOKSTORE. Ref 628899990004. Payment failed.'},
 {id:'recovery-otp',sender:'VM-HDFCBK-S',body:'OTP 123456. HDFC Bank A/c XX4821: INR 749.00 settled at BOOKSTORE. Ref 628899990005.'},
];
const bankIds=[['HDFC','HDFCBK'],['ICICI','ICICIT'],['SBI','SBIUPI'],['Axis','AXISBK'],['Kotak','KOTAKB']] as const;
export type Identified={ok:true;sender?:string;bank:string;accountId:string;accountNumber:string;kind:'account'|'card';direction:'in'|'out';amountPaise:number;merchant:string;reference?:string;method:Transaction['method'];pattern:string;body:string;date?:string};
export type Identification=Identified|{ok:false;reason:string;protected:boolean};
const forbidden=/\botp\b|one[ -]?time|verification code|\b(declined|failed|unsuccessful|pending|processing|rejected|requested)\b|will be|to be debited|scheduled|\bdue\b|statement|offer|eligible|apply now|mandate|autopay|asba|\bipo\b|blocked|hold|released|cancelled/i;
export function identifyMessage(sample:string,inboxSender?:string):Identification{
 const fail=(reason:string,protectedMessage=false):Identification=>({ok:false,reason,protected:protectedMessage});
 if(!sample.trim()||sample.length>2000)return fail('Enter a message (up to 2,000 characters).');
 const header=sample.match(/^\s*Sender:\s*([^\r\n]+)\r?\n/i)??sample.match(/^\s*((?:[A-Z]{2}-)?[A-Z]{3,8}(?:-[A-Z])?)\s*\n/i);
 const sender=inboxSender??header?.[1];const body=(header?sample.slice(header[0].length):sample).replace(/\s+/g,' ').trim();
 if(forbidden.test(body))return fail('This message is not a completed transaction.',true);
 if(sender&&!bankForSender(sender))return fail('Sender not recognised.');
 const bodyBanks=bankIds.filter(([bank])=>new RegExp(`\\b${bank}\\b`,'i').test(body));
 const bank=sender?bankForSender(sender):bodyBanks.length===1?bodyBanks[0][0]:null;
 if(!bank)return fail('Bank not identified.');
 const senderCore=bankIds.find(([b])=>b===bank)?.[1];if(!senderCore)return fail('Bank not supported.');
 // The preview recognises this additional settled-purchase format automatically.
 const normalized=body.replace(/\bsettled at\b/i,'paid to').replace(/\bcharged at\b/i,'spent at');
 const parsed=parseBankSms({address:sender??`VM-${senderCore}`,body:normalized});
 if(!parsed?.account||parsed.cardBillPayment)return fail(parsed?.cardBillPayment?'Card payment needs a separate ownership check.':'Transaction details not identified.');
 const amount=[...body.matchAll(/(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi)].find(m=>parseAmountToPaise(m[1])===parsed.amountPaise&&!/bal(?:ance)?|limit|outstanding/i.test(body.slice(Math.max(0,m.index!-24),m.index)));
 const account=body.match(/\b(?:a\/c|acc|acct|account|card)(?:\s*(?:no\.?|number|ending(?:\s*with)?))?[\s:.*x]*(\d{3,6})\b/i);
 const merchant=body.match(parsed.direction==='in'?/\bfrom\s+([^.;]+?)(?=\s+(?:on|ref|avl|bal|using|via)\b|[.;]|$)/i:/\b(?:at|to)\s+([^.;]+?)(?=\s+(?:on|ref|avl|bal|using|via)\b|[.;]|$)/i);
 if(!amount||!account||!merchant)return fail('Transaction details not identified.');
 const ref=body.match(/\b(?:ref(?:erence)?|refno|rrn|txn\s*(?:id|no))\s*[.:#-]*\s*(\d{6,24})/i);
 const replacements=[{start:amount.index!+amount[0].indexOf(amount[1]),value:amount[1],token:'{amount}'},{start:account.index!+account[0].lastIndexOf(account[1]),value:account[1],token:'{account}'},{start:merchant.index!+merchant[0].indexOf(merchant[1]),value:merchant[1],token:'{merchant}'},...(ref?[{start:ref.index!+ref[0].lastIndexOf(ref[1]),value:ref[1],token:'{reference}'}]:[])].sort((a,b)=>b.start-a.start);
 let pattern=body;for(const r of replacements)pattern=pattern.slice(0,r.start)+r.token+pattern.slice(r.start+r.value.length);
 pattern=pattern.replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g,'{date}').replace(/\b\d{1,2}[- ][A-Za-z]{3}[- ]\d{2,4}\b/g,'{date}').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g,'{time}');
 return {ok:true,sender,bank,accountId:`${bank}-${parsed.isCard?'card':'account'}-${parsed.account}`,accountNumber:parsed.account,kind:parsed.isCard?'card':'account',direction:parsed.direction,amountPaise:parsed.amountPaise,merchant:parsed.counterparty??merchant[1],reference:ref?.[1]??parsed.reference,method:parsed.method,pattern,body};
}
export function matchesAcceptedRule(rule:Pick<Identified,'bank'|'kind'|'direction'|'pattern'|'sender'>,candidate:Identification):candidate is Identified{return candidate.ok&&candidate.bank===rule.bank&&candidate.kind===rule.kind&&candidate.direction===rule.direction&&candidate.pattern.toLowerCase()===rule.pattern.toLowerCase()&&(!rule.sender||!candidate.sender||bankForSender(rule.sender)===bankForSender(candidate.sender));}
export function mappingAccount(r:Identified):Account{return{id:r.accountId,bank:r.bank,last4:r.accountNumber,kind:r.kind,ownerConfirmed:false,balanceKnown:false,balancePaise:0,asOf:0};}
