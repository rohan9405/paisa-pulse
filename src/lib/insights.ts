/**
 * Morning briefing / evening report / gamification — derived, pure data.
 */
import { type CommitmentStatus, type Ledger, discretionaryEntries, everydayEntries, groupSpend, outgoingsInRange } from "./budget";
import { type DateKey, addDays, diffDays, endOfMonth, parseKey, daysInMonth } from "./dates";
import type { BudgetPlan, Transaction } from "./types";

export type Vibe = "thriving" | "steady" | "careful" | "over" | "tracking";

export function vibe(ledger: Ledger): Vibe {
  if (!ledger.hasBudget) return "tracking";
  const { todayRow, availablePaise } = ledger;
  if (availablePaise < 0) return "over";
  const budgetToday = Math.max(1, todayRow.carriedInPaise + todayRow.allocationPaise);
  const ratio = availablePaise / budgetToday;
  if (ratio >= 0.6) return "thriving";
  if (ratio >= 0.25) return "steady";
  return "careful";
}

export const VIBE_COPY: Record<Vibe, { label: string; emoji: string; line: string }> = {
  thriving: { label: "Thriving", emoji: "😎", line: "You're well inside today's budget." },
  steady: { label: "Steady", emoji: "🙂", line: "On track — keep it chill." },
  careful: { label: "Careful", emoji: "😬", line: "Running low for today. Maybe cook tonight?" },
  over: { label: "In the red", emoji: "🫠", line: "You're in a deficit. Future days will pay it back." },
  tracking: { label: "Tracking", emoji: "👀", line: "No budget set — just watching where money goes." },
};

/** Per-day amount needed to clear a deficit by the end of this month. */
export function recoveryPlan(ledger: Ledger, today: DateKey) {
  if (!ledger.hasBudget || ledger.availablePaise >= 0) return null;
  const daysLeft = diffDays(today, endOfMonth(today)); // excluding today
  const deficit = -ledger.availablePaise;
  if (daysLeft <= 0) return { deficitPaise: deficit, daysLeft: 0, perDayCutPaise: deficit };
  return { deficitPaise: deficit, daysLeft, perDayCutPaise: Math.ceil(deficit / daysLeft) };
}

export interface MorningBriefing {
  date: DateKey;
  availablePaise: number;
  allocationPaise: number;
  carriedPaise: number;
  yesterday: { hasBudget: boolean; spentPaise: number; allocationPaise: number; underBudget: boolean } | null;
  billsSoon: CommitmentStatus[];
  overdue: CommitmentStatus[];
  reviewCount: number;
  recovery: ReturnType<typeof recoveryPlan>;
  monthPace: { spentPaise: number; allocatedPaise: number; dayOfMonth: number; daysInMonth: number };
  streak: number;
}

export function morningBriefing(ledger: Ledger, statuses: CommitmentStatus[], txns: Transaction[], today: DateKey): MorningBriefing {
  const yRow = ledger.days.find((d) => d.date === addDays(today, -1));
  const monthStart = today.slice(0, 8) + "01";
  const monthDays = ledger.days.filter((d) => d.date >= monthStart);
  const { y, m, d } = parseKey(today);
  return {
    date: today,
    availablePaise: ledger.todayRow.carriedInPaise + ledger.todayRow.allocationPaise,
    allocationPaise: ledger.todayRow.allocationPaise,
    carriedPaise: ledger.todayRow.carriedInPaise,
    yesterday: yRow ? { hasBudget: yRow.hasBudget, spentPaise: yRow.spentPaise, allocationPaise: yRow.allocationPaise, underBudget: yRow.underBudget } : null,
    billsSoon: statuses.filter((s) => s.state !== "paid" && s.state !== "overdue" && diffDays(today, s.dueDate) <= 7),
    overdue: statuses.filter((s) => s.state === "overdue"),
    reviewCount: txns.filter((t) => t.needsReview).length,
    recovery: recoveryPlan({ ...ledger, availablePaise: ledger.todayRow.carriedInPaise + ledger.todayRow.allocationPaise }, today),
    monthPace: {
      spentPaise: monthDays.reduce((s, r) => s + r.spentPaise, 0),
      allocatedPaise: monthDays.slice(0, -1).reduce((s, r) => s + r.allocationPaise, 0),
      dayOfMonth: d,
      daysInMonth: daysInMonth(y, m),
    },
    streak: ledger.streak,
  };
}

export interface EveningReport {
  hasBudget: boolean;
  date: DateKey;
  spentPaise: number;
  allocationPaise: number;
  closingPaise: number;
  underBudget: boolean;
  byCategory: { category: string; amountPaise: number; count: number }[];
  biggest: { merchant: string; amountPaise: number } | null;
  count: number;
  noSpend: boolean;
  streakIfHeld: number;
}

export function eveningReport(ledger: Ledger, txns: Transaction[], plans: BudgetPlan[], day: DateKey): EveningReport {
  const row = ledger.days.find((d) => d.date === day) ?? ledger.todayRow;
  const entries = row.hasBudget ? discretionaryEntries(txns, plans, ledger.today).filter((e) => e.date === day) : everydayEntries(txns, day, ledger.today).filter((e) => e.date === day);
  const biggest = entries.reduce<{ merchant: string; amountPaise: number } | null>(
    (b, e) => (!b || e.amountPaise > b.amountPaise ? { merchant: e.merchant, amountPaise: e.amountPaise } : b),
    null,
  );
  return {
    date: day,
    hasBudget: row.hasBudget,
    spentPaise: row.spentPaise,
    allocationPaise: row.allocationPaise,
    closingPaise: row.closingPaise,
    underBudget: row.underBudget,
    byCategory: groupSpend(entries),
    biggest,
    count: entries.length,
    noSpend: row.hasBudget ? row.spentPaise === 0 : outgoingsInRange(txns, day, day).totalPaise === 0,
    streakIfHeld: row.underBudget ? ledger.streak + 1 : 0,
  };
}

export interface Badge {
  id: string;
  emoji: string;
  name: string;
  earned: boolean;
  hint: string;
}

export function badges(ledger: Ledger): Badge[] {
  const done = ledger.days.slice(0, -1);
  const underDays = done.filter((d) => d.underBudget && d.allocationPaise > 0).length;
  const noSpend = done.filter((d) => d.spentPaise === 0).length;
  let bestStreak = 0, cur = 0;
  for (const d of done) {
    cur = d.underBudget && d.allocationPaise > 0 ? cur + 1 : 0;
    bestStreak = Math.max(bestStreak, cur);
  }
  return [
    { id: "first", emoji: "🌱", name: "First day", earned: ledger.days.length >= 1, hint: "Start tracking" },
    { id: "nospend", emoji: "🧘", name: "Zero-spend day", earned: noSpend >= 1, hint: "Spend nothing for a full day" },
    { id: "streak3", emoji: "🔥", name: "3-day streak", earned: bestStreak >= 3, hint: "3 days under budget in a row" },
    { id: "streak7", emoji: "⚡", name: "Week warrior", earned: bestStreak >= 7, hint: "7 days under budget in a row" },
    { id: "under20", emoji: "🏆", name: "20 wins", earned: underDays >= 20, hint: "20 days under budget" },
    { id: "green", emoji: "💚", name: "In the green", earned: ledger.hasBudget && ledger.availablePaise > 0 && ledger.days.length >= 7, hint: "Positive balance after a week" },
  ];
}

export function level(ledger: Ledger) {
  if (!ledger.hasBudget) return { xp: 0, level: 1, progress: 0 };
  const xp = ledger.days.slice(0, -1).filter((d) => d.hasBudget).reduce((s, d) => s + (d.allocationPaise > 0 && d.underBudget ? 10 : 0) + (d.spentPaise === 0 ? 5 : 0), 0);
  const lvl = Math.floor(xp / 100) + 1;
  return { xp, level: lvl, progress: (xp % 100) / 100 };
}
