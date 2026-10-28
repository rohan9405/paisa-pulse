import { expenseEntries } from "./budget";
import { addDays, addMonths, diffDays, eachDay, endOfMonth, monthKey, startOfWeek } from "./dates";
import type { Transaction } from "./types";

export function spendHeatmap(txns: Transaction[], trackingStart: string, today: string, endMonth = monthKey(today), includeInvestments = false) {
  const from = `${addMonths(endMonth, -11)}-01`;
  const to = endOfMonth(`${endMonth}-01`);
  const cutoff = to < today ? to : today;
  const values = new Map<string, number>();
  for (const entry of expenseEntries(txns, from > trackingStart ? from : trackingStart, cutoff, { includeInvestments })) {
    values.set(entry.date, (values.get(entry.date) ?? 0) + entry.amountPaise);
  }
  // One scale for the whole displayed year. Quantiles keep a large rent day
  // from flattening every ordinary spending day into the palest shade.
  const positive = [...values.values()].filter(v => v > 0).sort((a, b) => a - b);
  const thresholds = [0.25, 0.5, 0.75].map(q => positive[Math.floor((positive.length - 1) * q)] ?? 0);
  const gridStart = startOfWeek(from);
  const gridEnd = addDays(startOfWeek(to), 6);
  const days = eachDay(gridStart, gridEnd).map(date => {
    const outside = date < from || date > to;
    const state = outside ? "outside" : date > today ? "future" : date < trackingStart ? "untracked" : "tracked";
    const amountPaise = state === "tracked" ? values.get(date) ?? 0 : null;
    const level = amountPaise === null || amountPaise === 0 ? 0 : 1 + thresholds.filter(t => amountPaise > t).length;
    return { date, state, amountPaise, level };
  });
  const months = Array.from({ length: 12 }, (_, i) => {
    const month = addMonths(monthKey(from), i);
    return { month, column: Math.floor(diffDays(gridStart, `${month}-01`) / 7) + 1 };
  });
  return { from, to, days, months, weeks: days.length / 7 };
}
