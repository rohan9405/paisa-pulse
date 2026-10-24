import { expenseEntries } from "./budget";
import { addDays, addMonths, diffDays, dueDateInMonth, eachDay, endOfMonth, monthKey, startOfMonth, startOfWeek } from "./dates";
import type { DateKey, Transaction } from "./types";

export type MoneyFlow = "spent" | "income";
export interface AnalyticsEntry { id: string; date: DateKey; amountPaise: number; label: string; merchant: string }

/** Every figure is a snapshot as of the selected date. Later income, payments
 * and refunds cannot leak into a historical day or its cumulative totals.
 */
export function dailyAnalytics(txns: Transaction[], trackingStart: DateKey, asOf: DateKey, flow: MoneyFlow) {
  const entries: AnalyticsEntry[] = flow === "spent"
    ? expenseEntries(txns, trackingStart, asOf).map((t) => ({ id: t.txnId, date: t.date, amountPaise: t.amountPaise, label: t.category, merchant: t.merchant }))
    : txns.filter((t) => t.kind === "income" && t.date >= trackingStart && t.date <= asOf).map((t) => ({ id: t.id, date: t.date, amountPaise: t.amountPaise, label: t.tag || "Other income", merchant: t.merchant }));
  const sum = (from: DateKey, to: DateKey) => entries.reduce((total, t) => total + (t.date >= from && t.date <= to ? t.amountPaise : 0), 0);
  const monthStart = startOfMonth(asOf);
  const lastMonthStart = `${addMonths(monthKey(asOf), -1)}-01`;
  const lastMonthTo = dueDateInMonth(monthKey(lastMonthStart), Number(asOf.slice(8)));
  const usualFrom = [trackingStart, addDays(asOf, -28)].sort().at(-1)!;
  const usualDays = Math.max(0, diffDays(usualFrom, asOf));
  const dayEntries = entries.filter((t) => t.date === asOf);
  const groups = new Map<string, number>();
  for (const e of dayEntries) groups.set(e.label, (groups.get(e.label) ?? 0) + e.amountPaise);
  const breakdown = [...groups].map(([label, amountPaise]) => ({ label, amountPaise })).sort((a, b) => b.amountPaise - a.amountPaise || a.label.localeCompare(b.label));
  const weekStart = startOfWeek(asOf);
  const week = eachDay(weekStart, addDays(weekStart, 6)).map((date) => ({ date, amountPaise: date <= asOf ? sum(date, date) : 0, future: date > asOf, untracked: date < trackingStart }));
  const trendStart = addDays(asOf, -6);
  const trend7 = eachDay(trendStart, asOf).map(date => ({ date, amountPaise: sum(date, date), future: false, untracked: date < trackingStart }));
  return {
    rolling28DailyAvgPaise: trackingStart <= addDays(asOf, -28) ? Math.round(sum(addDays(asOf, -28), addDays(asOf, -1)) / 28) : null,
    rolling7DailyAvgPaise: trackingStart <= trendStart ? Math.round(sum(trendStart, asOf) / 7) : null,
    trend7,
    asOf, flow, dayPaise: sum(asOf, asOf), weekPaise: sum(weekStart, asOf), monthPaise: sum(monthStart, asOf),
    usualPaise: usualDays ? Math.round(sum(usualFrom, addDays(asOf, -1)) / usualDays) : null,
    lastMonthPaise: trackingStart <= lastMonthStart ? sum(lastMonthStart, lastMonthTo) : null,
    lastWeekPaise: trackingStart <= addDays(weekStart, -7) ? sum(addDays(weekStart, -7), addDays(asOf, -7)) : null,
    lastWeekTo: addDays(asOf, -7),
    lastMonthDailyAvgPaise: trackingStart <= lastMonthStart ? Math.round(sum(lastMonthStart, endOfMonth(lastMonthStart)) / (diffDays(lastMonthStart, endOfMonth(lastMonthStart)) + 1)) : null,
    lastWeekDailyAvgPaise: trackingStart <= addDays(weekStart, -7) ? Math.round(sum(addDays(weekStart, -7), addDays(weekStart, -1)) / 7) : null,
    lastMonthTo, breakdown, dayEntries, week,
  };
}

/** Always 42 slots: picking a day or browsing February cannot resize the calendar. */
export function calendarSlots(month: string): (DateKey | null)[] {
  const first = `${month}-01`;
  const blanks = diffDays(startOfWeek(first), first);
  const dates: (DateKey | null)[] = [...Array(blanks).fill(null), ...eachDay(first, endOfMonth(first))];
  return [...dates, ...Array(42 - dates.length).fill(null)];
}
