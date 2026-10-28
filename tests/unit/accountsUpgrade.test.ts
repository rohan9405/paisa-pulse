import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import {describe,it,expect} from 'vitest';
import {FinanceDB} from '@/data/db';
import {accountKey} from '@/features/accounts/metadata';
import {resetTracking} from '@/features/accounts/resetTracking';
import {netInHandInRange,expenseEntries} from '@/lib/budget';
import {identifyMessage,matchesAcceptedRule,RECOVERY_SAMPLE,recoveryInbox} from '@/features/accounts/simpleSms';
import {acceptedCandidate,redactTemplateSample} from '@/features/accounts/recovery';
import type {Transaction} from '@/lib/types';
describe('account upgrade safety',()=>{
 it('migrates old keys and adds metadata without changing amounts, edits, classifications or cursor',async()=>{
  const name=`upgrade-${Math.random()}`;const old=new Dexie(name);old.version(4).stores({profile:'id',plans:'id, effectiveFrom',txns:'id, date, kind, category, fingerprint, commitmentId, refundOf, payee',rules:'id, priority',connections:'providerId',imports:'id, importedAt',accounts:'id',recurring:'id, payee, status',holds:'id, reference, status'});await old.open();
  const t:Transaction={id:'old',date:'2026-10-21',amountPaise:25000,kind:'expense',merchant:'My corrected name',category:'Health',method:'upi',userEdited:true,fingerprint:'sms|1792555200000|out|25000',source:{providerId:'sms',raw:'Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY',importedAt:1},createdAt:1,updatedAt:2};
  await old.table('txns').put(t);await old.table('accounts').put({id:'HDFC-1234',bank:'HDFC',last4:'1234',kind:'account',balancePaise:900000,asOf:1});await old.table('connections').put({providerId:'sms',status:'connected',cursor:'12345'});old.close();
  const upgraded=new FinanceDB(name);await upgraded.open();const result=await upgraded.txns.get('old');expect(result).toMatchObject({...t,accountId:'HDFC-account-1234',direction:'out'});expect(await upgraded.accounts.get('HDFC-account-1234')).toMatchObject({balancePaise:900000,ownerConfirmed:false});expect((await upgraded.connections.get('sms'))?.cursor).toBe('12345');await upgraded.delete();
 });
 it('separates a card and bank account with identical digits',()=>expect(accountKey({bank:'HDFC',kind:'card',last4:'1234'})).not.toBe(accountKey({bank:'HDFC',kind:'account',last4:'1234'})));
 it('excludes pending card-bill classifications from raw ledger reporting, including widgets',()=>{
  const t:Transaction={id:'pending',date:'2026-10-21',amountPaise:500000,accountingPending:true,kind:'expense',merchant:'Card bill',category:'Other',method:'upi',source:{providerId:'sms',importedAt:0},createdAt:0,updatedAt:0};expect(expenseEntries([t],t.date,t.date)).toEqual([]);expect(netInHandInRange([t,{...t,id:'pending-in',kind:'income'}],t.date,t.date)).toMatchObject({expensesPaise:0,incomePaise:0});
 });
 it('resets only the selected standard app database',async()=>{const db=new FinanceDB(`other-${Math.random()}`);await expect(resetTracking(db,'personal','2026-10-28')).rejects.toThrow('does not match');});
});
describe('accepted SMS formats',()=>{
 it('shows parsed bank/account without inventing a missing sender',()=>{expect(identifyMessage(RECOVERY_SAMPLE)).toMatchObject({ok:true,bank:'HDFC',accountNumber:'4821',amountPaise:74900,sender:undefined});});
 it('matches changed amounts and merchants but rejects OTP/failed messages',()=>{const r=identifyMessage(RECOVERY_SAMPLE);expect(r.ok).toBe(true);if(!r.ok)return;expect(recoveryInbox.filter(s=>matchesAcceptedRule(r,identifyMessage(s.body,s.sender)))).toHaveLength(3);});
 it('uses a saved rule for future SMS and respects the protected exclusions',()=>{const r=identifyMessage(RECOVERY_SAMPLE);if(!r.ok)throw new Error('fixture');const rule={id:'r',bank:r.bank,sender:r.sender,pattern:r.pattern,kind:r.kind,direction:r.direction,createdAt:0};const sms={id:'future',address:'VM-HDFCBK-S',body:RECOVERY_SAMPLE.replace('749.00','850.00'),date:1};expect(acceptedCandidate(sms,[rule])).toMatchObject({amountPaise:85000});expect(acceptedCandidate({...sms,body:'OTP 123456. '+sms.body},[rule])).toBeNull();});
 it('redacts financial amounts, references and UPI identifiers in a support sample',()=>{const r=redactTemplateSample('INR 987.65 ref 998877665544 to person@upi');expect(r).not.toContain('987.65');expect(r).not.toContain('998877665544');expect(r).not.toContain('person@upi');});
});
