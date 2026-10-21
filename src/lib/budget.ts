/**
 * Budget engine. Pure functions only — no React, no storage.
 *
 * Rules (see docs/BUDGET_LOGIC.md):
 *  - monthly pool = income − fixed bills − savings targets (commitments)
 *  - daily allocation = pool / days in that calendar month, with deterministic
 *    paise rounding so the days of a month sum exactly to the pool
 *  - available = Σ allocations (tracking start → today) + opening adjustment
 *                − discretionary spending (tracking start → today)
 */
import {
  type DateKey,
  type MonthKey,
  addDays,
  daysInMonth,
  dueDateInMonth,
  eachDay,
  monthKey,
  parseKey,
} from "./dates";
import type { Paise } from "./money";
import type { BudgetPlan, Commitment, Profile, Transaction } from "./types";

// ---------------------------------------------------------------- plans/pool

export interface PoolSummary {
  hasBudget: boolean;
  incomePaise: Paise;
  billsPaise: Paise;
  savingsPaise: Paise;
  committedPaise: Paise;
  /** May be negative when commitments exceed income. */
  poolPaise: Paise;
  /** What is actually spread across the days: max(0, pool). */
  allocatablePaise: Paise;
  /** How far commitments exceed income (0 if they don't). */
  shortfallPaise: Paise;
}

export function hasBudget(plan: BudgetPlan | null | undefined): boolean {
  return !!plan && plan.incomePaise !== null && plan.incomePaise > 0;
}

export function poolSummary(plan: BudgetPlan | null | undefined): PoolSummary {
  const income = plan && plan.incomePaise ? plan.incomePaise : 0;
  const bills = sum((plan?.commitments ?? []).filter((c) => c.kind === "bill").map((c) => c.amountPaise));
  const savings = sum((plan?.commitments ?? []).filter((c) => c.kind === "savings").map((c) => c.amountPaise));
  const committed = bills + savings;
  const pool = income - committed;
  const budget = hasBudget(plan);
  return {
    hasBudget: budget,
    incomePaise: income,
    billsPaise: bills,
    savingsPaise: savings,
    committedPaise: committed,
    poolPaise: budget ? pool : 0,
    allocatablePaise: budget ? Math.max(0, pool) : 0,
    shortfallPaise: budget ? Math.max(0, -pool) : 0,
  };
}

/** The plan in force on `day`: the latest plan whose effectiveFrom ≤ day. */
export function planForDate(plans: BudgetPlan[], day: DateKey): BudgetPlan | null {
  let best: BudgetPlan | null = null;
  for (const p of plans) {
    if (p.effectiveFrom <= day && (!best || p.effectiveFrom > best.effectiveFrom || (p.effectiveFrom === best.effectiveFrom && p.createdAt > best.createdAt)))
      best = p;
  }
  return best;
}

/**
 * Deterministic rounding: base = floor(pool / n); the leftover r paise
 * (0 ≤ r < n) go one each to days 1…r. Σ over the month === pool exactly.
 */
export function dailyAllocation(allocatablePaise: Paise, day: DateKey): Paise {
  if (allocatablePaise <= 0) return 0;
  const { y, m, d } = parseKey(day);
  const n = daysInMonth(y, m);
  const base = Math.floor(allocatablePaise / n);
  const remainder = allocatablePaise - base * n;
  return base + (d <= remainder ? 1 : 0);
}

export function allocationForDay(plans: BudgetPlan[], day: DateKey): Paise {
  return dailyAllocation(poolSummary(planForDate(plans, day)).allocatablePaise, day);
}

// ------------------------------------------------------ discretionary spend

export interface SpendEntry {
  date: DateKey;
  amountPaise: Paise;
  category: string;
  txnId: string;
  merchant: string;
  /** "expense" = net expense after linked refunds; "overage" = commitment paid above its reservation. */
  source: "expense" | "overage" | "unreserved";
}

function findCommitment(plans: BudgetPlan[], id: string, day: DateKey): Commitment | null {
  const inForce = planForDate(plans, day)?.commitments.find((c) => c.id === id);
  if (inForce) return inForce;
  for (const p of [...plans].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))) {
    const c = p.commitments.find((x) => x.id === id);
    if (c) return c;
  }
  return null;
}

/**
 * Every rupee that counts against the discretionary budget, dated.
 *  - expenses, net of refunds linked to them (refund credits land on the
 *    original expense's date and are capped at the expense amount)
 *  - commitment payments above their reserved amount for that month
 *  - commitment payments whose reservation no longer exists
 * Transfers, investments, income, and unlinked refunds never count.
 * Transactions dated after `asOf` are ignored.
 */
export function discretionaryEntries(txns: Transaction[], plans: BudgetPlan[], asOf: DateKey): SpendEntry[] {
  const live = txns.filter((t) => t.date <= asOf);
  const refundsByExpense = new Map<string, Paise>();
  for (const t of live) {
    if (t.kind === "refund" && t.refundOf) refundsByExpense.set(t.refundOf, (refundsByExpense.get(t.refundOf) ?? 0) + t.amountPaise);
  }

  const out: SpendEntry[] = [];
  for (const t of live) {
    if (t.kind !== "expense") continue;
    const net = Math.max(0, t.amountPaise - (refundsByExpense.get(t.id) ?? 0));
    if (net > 0) out.push({ date: t.date, amountPaise: net, category: t.category, txnId: t.id, merchant: t.merchant, source: "expense" });
  }

  // Commitment overage: process chronologically, per commitment per month.
  const paidSoFar = new Map<string, Paise>();
  const commitmentTxns = live.filter((t) => t.kind === "commitment").sort(byDateThenCreated);
  for (const t of commitmentTxns) {
    const c = t.commitmentId ? findCommitment(plans, t.commitmentId, t.date) : null;
    if (!c) {
      out.push({ date: t.date, amountPaise: t.amountPaise, category: t.category, txnId: t.id, merchant: t.merchant, source: "unreserved" });
      continue;
    }
    const key = `${c.id}@${monthKey(t.date)}`;
    const before = paidSoFar.get(key) ?? 0;
    const after = before + t.amountPaise;
    paidSoFar.set(key, after);
    const excess = Math.max(0, after - c.amountPaise) - Math.max(0, before - c.amountPaise);
    if (excess > 0) out.push({ date: t.date, amountPaise: excess, category: t.category, txnId: t.id, merchant: t.merchant, source: "overage" });
  }
  return out;
}

function byDateThenCreated(a: Transaction, b: Transaction) {
  return a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1;
}

// ------------------------------------------------------------------ ledger

export interface DayRow {
  date: DateKey;
  allocationPaise: Paise;
  spentPaise: Paise;
  /** Balance carried in from previous days (incl. opening adjustment). */
  carriedInPaise: Paise;
  /** carriedIn + allocation − spent. */
  closingPaise: Paise;
  underBudget: boolean;
}

export interface Ledger {
  started: boolean;
  hasBudget: boolean;
  today: DateKey;
  days: DayRow[];
  todayRow: DayRow;
  /** Money available to spend right now (negative = deficit). */
  availablePaise: Paise;
  totalAllocatedPaise: Paise;
  totalSpentPaise: Paise;
  /** Consecutive completed days (ending yesterday) where spend ≤ that day's allocation. */
  streak: number;
}

export function computeLedger(input: {
  plans: BudgetPlan[];
  profile: Pick<Profile, "trackingStart" | "openingAdjustmentPaise">;
  txns: Transaction[];
  today: DateKey;
}): Ledger {
  const { plans, profile, txns, today } = input;
  const start = profile.trackingStart;
  const started = today >= start;
  const budget = hasBudget(planForDate(plans, today));

  const spentByDay = new Map<DateKey, Paise>();
  for (const e of discretionaryEntries(txns, plans, today)) {
    if (e.date < start) continue;
    spentByDay.set(e.date, (spentByDay.get(e.date) ?? 0) + e.amountPaise);
  }

  const days: DayRow[] = [];
  let balance = profile.openingAdjustmentPaise;
  let totalAlloc = 0;
  let totalSpent = 0;
  if (started) {
    for (const day of eachDay(start, today)) {
      const allocation = allocationForDay(plans, day);
      const spent = spentByDay.get(day) ?? 0;
      const carriedIn = balance;
      balance = carriedIn + allocation - spent;
      totalAlloc += allocation;
      totalSpent += spent;
      days.push({ date: day, allocationPaise: allocation, spentPaise: spent, carriedInPaise: carriedIn, closingPaise: balance, underBudget: spent <= allocation });
    }
  }

  const todayRow: DayRow =
    days[days.length - 1] ??
    { date: today, allocationPaise: 0, spentPaise: 0, carriedInPaise: 0, closingPaise: 0, underBudget: true };

  let streak = 0;
  for (let i = days.length - 2; i >= 0; i--) {
    if (days[i].underBudget && days[i].allocationPaise > 0) streak++;
    else break;
  }

  return {
    started,
    hasBudget: budget,
    today,
    days,
    todayRow,
    availablePaise: started ? balance : 0,
    totalAllocatedPaise: totalAlloc,
    totalSpentPaise: totalSpent,
    streak,
  };
}

// ------------------------------------------------------------- commitments

export type CommitmentState = "paid" | "partial" | "upcoming" | "due_today" | "overdue";

export interface CommitmentStatus {
  commitment: Commitment;
  dueDate: DateKey;
  paidPaise: Paise;
  manuallyPaid: boolean;
  state: CommitmentState;
  matchedTxnIds: string[];
}

export function manualPaidKey(commitmentId: string, mk: MonthKey) {
  return `${commitmentId}@${mk}`;
}

export function commitmentStatuses(
  plan: BudgetPlan | null,
  profile: Pick<Profile, "manuallyPaid">,
  txns: Transaction[],
  mk: MonthKey,
  today: DateKey,
): CommitmentStatus[] {
  if (!plan) return [];
  return plan.commitments
    .map((c) => {
      const matched = txns.filter((t) => t.kind === "commitment" && t.commitmentId === c.id && monthKey(t.date) === mk);
      const paid = sum(matched.map((t) => t.amountPaise));
      const manual = profile.manuallyPaid.includes(manualPaidKey(c.id, mk));
      const dueDate = dueDateInMonth(mk, c.dueDay);
      let state: CommitmentState;
      if (manual || paid >= c.amountPaise) state = "paid";
      else if (paid > 0) state = "partial";
      else if (dueDate < today) state = "overdue";
      else if (dueDate === today) state = "due_today";
      else state = "upcoming";
      return { commitment: c, dueDate, paidPaise: paid, manuallyPaid: manual, state, matchedTxnIds: matched.map((t) => t.id) };
    })
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

// --------------------------------------------------------------- outgoings

export interface Outgoings {
  discretionaryPaise: Paise;
  commitmentsPaise: Paise;
  investmentsPaise: Paise;
  /** discretionary + commitments(reserved part) + investments. Transfers excluded. */
  totalPaise: Paise;
  transfersExcludedPaise: Paise;
  incomePaise: Paise;
}

export function outgoingsInRange(txns: Transaction[], plans: BudgetPlan[], from: DateKey, to: DateKey): Outgoings {
  const inRange = (d: DateKey) => d >= from && d <= to;
  const entries = discretionaryEntries(txns, plans, to).filter((e) => inRange(e.date));
  const discretionary = sum(entries.map((e) => e.amountPaise));
  // Commitment amounts already counted as overage/unreserved must not be counted twice.
  const commitmentOverlap = sum(entries.filter((e) => e.source !== "expense").map((e) => e.amountPaise));
  const ts = txns.filter((t) => inRange(t.date));
  const commitments = sum(ts.filter((t) => t.kind === "commitment").map((t) => t.amountPaise)) - commitmentOverlap;
  const investments = sum(ts.filter((t) => t.kind === "investment").map((t) => t.amountPaise));
  return {
    discretionaryPaise: discretionary,
    commitmentsPaise: commitments,
    investmentsPaise: investments,
    totalPaise: discretionary + commitments + investments,
    transfersExcludedPaise: sum(ts.filter((t) => t.kind === "transfer").map((t) => t.amountPaise)),
    incomePaise: sum(ts.filter((t) => t.kind === "income").map((t) => t.amountPaise)),
  };
}

export function categoryBreakdown(
  txns: Transaction[],
  plans: BudgetPlan[],
  from: DateKey,
  to: DateKey,
): { category: string; amountPaise: Paise; count: number }[] {
  const map = new Map<string, { amountPaise: Paise; ids: Set<string> }>();
  for (const e of discretionaryEntries(txns, plans, to)) {
    if (e.date < from || e.date > to) continue;
    const cur = map.get(e.category) ?? { amountPaise: 0, ids: new Set() };
    cur.amountPaise += e.amountPaise;
    cur.ids.add(e.txnId);
    map.set(e.category, cur);
  }
  return [...map.entries()]
    .map(([category, v]) => ({ category, amountPaise: v.amountPaise, count: v.ids.size }))
    .sort((a, b) => b.amountPaise - a.amountPaise);
}

/** Budget vs actual per day in a range (for charts). */
export function spendVsBudgetSeries(ledger: Ledger, from: DateKey, to: DateKey) {
  const byDate = new Map(ledger.days.map((d) => [d.date, d]));
  let cumBudget = 0;
  let cumSpent = 0;
  const out: { date: DateKey; budgetPaise: Paise; spentPaise: Paise; cumBudgetPaise: Paise; cumSpentPaise: Paise }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const row = byDate.get(d);
    const b = row?.allocationPaise ?? 0;
    const s = row?.spentPaise ?? 0;
    cumBudget += b;
    cumSpent += s;
    out.push({ date: d, budgetPaise: b, spentPaise: s, cumBudgetPaise: cumBudget, cumSpentPaise: cumSpent });
  }
  return out;
}

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}
