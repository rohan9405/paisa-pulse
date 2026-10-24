import { expenseEntries } from "./budget";
import { addMonths, endOfMonth, monthKey, startOfMonth } from "./dates";
import type { Transaction } from "./types";

export const merchantKey = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");

/** Uses the same net expenses (and historical refund cutoff) as tracking Stats. */
export function merchantBreakdown(txns: Transaction[], from: string, to: string) {
  const groups = new Map<string, { key: string; name: string; amountPaise: number; count: number; category: string }>();
  for (const t of expenseEntries(txns, from, to)) {
    const key = merchantKey(t.merchant || "Unknown merchant");
    const row = groups.get(key) ?? { key, name: t.merchant || "Unknown merchant", amountPaise: 0, count: 0, category: t.category };
    row.amountPaise += t.amountPaise;
    row.count++;
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.amountPaise - a.amountPaise || a.name.localeCompare(b.name));
}

export function merchantMonthlyHistory(txns: Transaction[], key: string, end: string, trackingStart: string) {
  return Array.from({ length: 12 }, (_, i) => {
    const month = addMonths(monthKey(end), i - 11);
    const from = startOfMonth(`${month}-01`);
    const to = endOfMonth(from) < end ? endOfMonth(from) : end;
    const row = merchantBreakdown(txns, from, to).find(r => r.key === key);
    return { month, amountPaise: row?.amountPaise ?? 0, count: row?.count ?? 0, tracked: to >= trackingStart, partial: from < trackingStart || to < endOfMonth(from) };
  });
}

/** Require recorded expense history in at least three distinct calendar months. */
export function hasMerchantMonthlyHistory(txns: Transaction[], trackingStart: string, end: string): boolean {
  return new Set(expenseEntries(txns, trackingStart, end).map(t => monthKey(t.date))).size >= 3;
}
