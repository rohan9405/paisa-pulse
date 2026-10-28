import {describe,it,expect} from 'vitest';
import {statsSpending} from '@/lib/statsSpending';
import {txn} from './helpers';

describe('Stats spending scope',()=>{
 const rows=[
  txn({id:'e',date:'2026-10-01',amountPaise:10000}),
  txn({id:'i',date:'2026-10-01',amountPaise:30000,kind:'investment',category:'Investments'}),
  txn({date:'2026-10-02',amountPaise:5000,kind:'refund',refundOf:'i'}),
  txn({date:'2026-10-01',amountPaise:90000,kind:'transfer'}),
  txn({date:'2026-10-01',amountPaise:90000,accountingPending:true}),
  txn({date:'2026-09-01',amountPaise:20000}),
  txn({date:'2026-09-02',amountPaise:40000,kind:'investment',category:'Investments'}),
  txn({date:'2026-10-03',amountPaise:99000}),
 ];
 it('defaults to expenses and includes zero days in the monthly average',()=>{
  const r=statsSpending(rows,'2026-09-01','2026-10-01','2026-10-02',false);
  expect(r.series.map(d=>d.daySpent)).toEqual([100,0]);
  expect(r.series.at(-1)).toMatchObject({Spent:100,'Last month':200});
  expect(r.spendingAverage).toBe(50);
 });
 it('stacks investments, nets known refunds, and scopes the comparison and average consistently',()=>{
  const r=statsSpending(rows,'2026-09-01','2026-10-01','2026-10-02',true);
  expect(r.series[0]).toMatchObject({dayExpenses:100,dayInvestments:250,daySpent:350,Spent:350});
  expect(r.series.at(-1)?.['Last month']).toBe(600);
  expect(r.spendingAverage).toBe(175);
  expect(statsSpending(rows,'2026-09-01','2026-10-01','2026-10-01',true).series[0].Spent).toBe(400);
 });
 it('does not invent history and clamps shorter comparison months',()=>{
  const r=statsSpending([txn({date:'2026-02-28',amountPaise:12300})],'2026-02-01','2026-03-30','2026-03-31',true);
  expect(r.series.map(d=>d['Last month'])).toEqual([123,123]);
  expect(statsSpending(rows,'2026-10-01','2026-10-01','2026-10-02',true).series[0]['Last month']).toBeNull();
 });
});
