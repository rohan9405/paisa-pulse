import { spendingEntries } from './budget';
import { addMonths, eachDay, endOfMonth, formatDay, monthKey, startOfMonth } from './dates';
import type { DateKey, Transaction } from './types';

/** Actual payments, independent of budget allocation. Refunds are known only through the snapshot end. */
export function statsSpending(txns: Transaction[], trackingStart: DateKey, from: DateKey, to: DateKey, includeInvestments: boolean) {
  const first = from > trackingStart ? from : trackingStart;
  const previousStart = `${addMonths(monthKey(from), -1)}-01`;
  const scanFrom = [first, startOfMonth(to), previousStart].sort()[0];
  const daily = new Map<DateKey, { expenses: number; investments: number }>();
  for (const entry of spendingEntries(txns, scanFrom > trackingStart ? scanFrom : trackingStart, to)) {
    const totals = daily.get(entry.date) ?? { expenses: 0, investments: 0 };
    totals[entry.investment ? 'investments' : 'expenses'] += entry.amountPaise;
    daily.set(entry.date, totals);
  }
  const total = (date: DateKey) => {const d=daily.get(date);return (d?.expenses??0)+(includeInvestments?(d?.investments??0):0);};
  const previous = new Map<DateKey, number>();
  for (const date of eachDay(first, to)) {
    const start = `${addMonths(monthKey(date), -1)}-01`;
    if (start < trackingStart || previous.has(start)) continue;
    let cumulative=0;
    for (const d of eachDay(start,endOfMonth(start))) { cumulative+=total(d);previous.set(d,cumulative); }
  }
  let cumulative=0;
  const series=eachDay(first,to).map(date=>{
    const d=daily.get(date)??{expenses:0,investments:0};
    cumulative+=total(date);
    const start=`${addMonths(monthKey(date),-1)}-01`;
    const previousDate=`${start.slice(0,8)}${String(Math.min(Number(date.slice(8)),Number(endOfMonth(start).slice(8)))).padStart(2,'0')}`;
    return {label:formatDay(date),date,Spent:cumulative/100,'Last month':start<trackingStart?null:(previous.get(previousDate)??0)/100,dayExpenses:d.expenses/100,dayInvestments:includeInvestments?d.investments/100:0,daySpent:total(date)/100};
  });
  const averageFrom=[startOfMonth(to),trackingStart].sort().at(-1)!;
  const days=eachDay(averageFrom,to);
  const spendingAverage=days.reduce((sum,date)=>sum+total(date),0)/Math.max(1,days.length)/100;
  return {series,spendingAverage};
}
