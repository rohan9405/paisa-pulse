/**
 * What the Today and Briefing screens summarise: month pace and projection,
 * this week's days, the month calendar, your usual spend and one insight.
 * Pure functions over the ledger and transactions.
 */
import { type Ledger, categoryBreakdown } from "./budget";
import { type DateKey, addDays, daysInMonth, diffDays, eachDay, endOfMonth, parseKey, startOfMonth, startOfWeek } from "./dates";
import type { BudgetPlan, Transaction } from "./types";

export interface MonthPace {
  /** Spent this month so far, today included. */
  spentPaise: number;
  /** Allowance this month so far, today included. */
  allocatedPaise: number;
  dayOfMonth: number;
  daysInMonth: number;
  onTrack: boolean | null;
  /**
   * Expected allowance minus expected spend at month end, at the pace of the
   * completed days (positive = under). Null until there are 3 completed days.
   */
  projectedDeltaPaise: number | null;
}

export function monthPace(ledger: Ledger, today: DateKey): MonthPace {
  const { y, m, d } = parseKey(today);
  const dim = daysInMonth(y, m);
  const rows = ledger.days.filter((r) => r.date >= startOfMonth(today) && r.date <= today);
  const done = rows.filter((r) => r.date < today);
  const spent = rows.reduce((s, r) => s + (ledger.hasBudget ? r.hasBudget ? r.spentPaise : 0 : r.everydayPaise), 0);
  const allocated = rows.reduce((s, r) => s + r.allocationPaise, 0);
  let projected: number | null = null;
  if (ledger.hasBudget && ledger.mode === "planned" && rows.every((r) => r.hasBudget) && done.length >= 3) {
    const rate = done.reduce((s, r) => s + r.spentPaise, 0) / done.length;
    const daysLeft = dim - d; // after today
    const expectedSpend = spent + rate * daysLeft;
    const expectedAllowance = allocated + (allocated / rows.length) * daysLeft;
    projected = Math.round(expectedAllowance - expectedSpend);
  }
  return { spentPaise: spent, allocatedPaise: allocated, dayOfMonth: d, daysInMonth: dim, onTrack: ledger.hasBudget ? spent <= allocated : null, projectedDeltaPaise: projected };
}

/** Average daily spend over the last `days` completed days that were tracked (0 if none). */
export function usualDailySpend(ledger: Ledger, today: DateKey, days = 28): number {
  const from = addDays(today, -days);
  const rows = ledger.days.filter((r) => r.date >= from && r.date < today);
  return rows.length ? Math.round(rows.reduce((s, r) => s + (ledger.hasBudget ? r.hasBudget ? r.spentPaise : 0 : r.everydayPaise), 0) / rows.length) : 0;
}

export interface WeekDay {
  hasBudget: boolean;
  date: DateKey;
  spentPaise: number;
  allocationPaise: number;
  future: boolean;
  /** Not tracked yet (before tracking start). */
  untracked: boolean;
}

/** Monday to Sunday of the week containing `today`. */
export function weekDays(ledger: Ledger, today: DateKey): WeekDay[] {
  const start = startOfWeek(today);
  return eachDay(start, addDays(start, 6)).map((date) => {
    const row = ledger.days.find((r) => r.date === date);
    return { date, hasBudget: row?.hasBudget ?? false, spentPaise: ledger.hasBudget ? row?.spentPaise ?? 0 : row?.everydayPaise ?? 0, allocationPaise: row?.allocationPaise ?? 0, future: date > today, untracked: !row && date <= today };
  });
}

export type CalendarState = "under" | "over" | "nospend" | "spent" | "today" | "future" | "untracked";

export interface CalendarDay {
  hasBudget: boolean;
  date: DateKey;
  state: CalendarState;
  spentPaise: number;
}

/** Days of the month containing `day`, with blanks before the 1st so rows start on Monday. */
export function monthCalendar(ledger: Ledger, day: DateKey): { blanks: number; days: CalendarDay[] } {
  const first = startOfMonth(day);
  const blanks = diffDays(startOfWeek(first), first);
  const days = eachDay(first, endOfMonth(day)).map((date): CalendarDay => {
    const row = ledger.days.find((r) => r.date === date);
    if (date > ledger.today) return { date, hasBudget: row?.hasBudget ?? false, state: "future", spentPaise: 0 };
    if (!row) return { date, hasBudget: false, state: "untracked", spentPaise: 0 };
    if (date === ledger.today) return { date, hasBudget: row?.hasBudget ?? false, state: "today", spentPaise: row.spentPaise };
    if (row.spentPaise === 0 && (row.hasBudget || row.setAsidePaise === 0)) return { date, hasBudget: row?.hasBudget ?? false, state: "nospend", spentPaise: 0 };
    if (!row.hasBudget) return { date, hasBudget: row?.hasBudget ?? false, state: "spent", spentPaise: row.spentPaise };
    return { date, hasBudget: row?.hasBudget ?? false, state: row.underBudget ? "under" : "over", spentPaise: row.spentPaise };
  });
  return { blanks, days };
}

/** Tomorrow's base allowance (in actual mode, assuming nothing else is set aside before then). */
export function tomorrowAllocation(ledger: Ledger): number {
  return ledger.nextAllocationPaise;
}

export interface Insight {
  text: string;
  tone: "warn" | "good";
}

const MIN_DIFF = 300_00; // ₹300: smaller swings aren't worth a nudge

/**
 * One nudge comparing the last 7 days with the 4 weeks before: the category that
 * rose the most, or, failing that, a note if overall spending is well below usual.
 */
export function weeklyInsight(txns: Transaction[], plans: BudgetPlan[], today: DateKey): Insight | null {
  // Everyday spending only: rent day shouldn't read as "Bills up 900%".
  const week = categoryBreakdown(txns, plans, addDays(today, -6), today, { exclude: ["Bills"] });
  const before = categoryBreakdown(txns, plans, addDays(today, -34), addDays(today, -7), { exclude: ["Bills"] });
  if (!before.length) return null;
  const usual = new Map(before.map((c) => [c.category, c.amountPaise / 4]));

  let best: { category: string; pct: number; diff: number } | null = null;
  for (const c of week) {
    const u = usual.get(c.category) ?? 0;
    const diff = c.amountPaise - u;
    if (u < 100_00 || diff < MIN_DIFF || c.amountPaise < u * 1.25) continue;
    if (!best || diff > best.diff) best = { category: c.category, pct: Math.round((diff / u) * 100), diff };
  }
  if (best) return { text: `${best.category} is ${best.pct}% above your usual this week`, tone: "warn" };

  const weekTotal = week.reduce((s, c) => s + c.amountPaise, 0);
  const usualTotal = before.reduce((s, c) => s + c.amountPaise, 0) / 4;
  if (usualTotal > 0 && usualTotal - weekTotal >= MIN_DIFF && weekTotal <= usualTotal * 0.85) {
    return { text: `This week's spending is ${Math.round((1 - weekTotal / usualTotal) * 100)}% below your usual`, tone: "good" };
  }
  return null;
}
