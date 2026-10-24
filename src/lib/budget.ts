import { isReimbursementKind } from "./reimbursements";
/**
 * Budget engine. Pure functions only — no React, no storage.
 *
 * Rules (see docs/BUDGET_LOGIC.md):
 *  - Set-aside categories (Bills, Investments, Savings by default) come off
 *    income before the daily budget. Everything else is everyday spending.
 *  - planned mode: pool = income − planned amounts; daily allocation = pool /
 *    days in that calendar month (deterministic paise rounding). A payment that
 *    differs from its planned line moves that day's budget: over at once,
 *    under at month end. An unplanned set-aside payment counts in full.
 *  - actual mode: nothing is planned; each set-aside payment comes out of the
 *    month's pool when it arrives and the remaining days are recalculated.
 *  - tracking only: explicit mode, no allocation or budget balance.
 *  - available = Σ allocations (tracking start → today) + opening adjustment
 *                − everyday spending + adjustments
 */
import { DEFAULT_SET_ASIDE, NOT_EXPENSE, normalize } from "./categorize";
import {
  type DateKey,
  type MonthKey,
  addDays,
  addMonths,
  daysInMonth,
  diffDays,
  dueDateInMonth,
  eachDay,
  endOfMonth,
  monthKey,
  parseKey,
  startOfMonth,
} from "./dates";
import type { Paise } from "./money";
import { getConfig } from "./remoteConfig";
import type { BudgetPlan, Commitment, CommitmentKind, Profile, SetAsideMode, Transaction } from "./types";

// ---------------------------------------------------------------- plans/pool

const KIND_CATEGORY: Record<CommitmentKind, string> = { bill: "Bills", investment: "Investments", savings: "Savings" };

export function commitmentCategory(c: Pick<Commitment, "kind">): string {
  return KIND_CATEGORY[c.kind] ?? "Bills";
}

export function setAsideOf(plan: BudgetPlan | null | undefined): string[] {
  return plan?.setAside ?? DEFAULT_SET_ASIDE;
}

export function modeOf(plan: BudgetPlan | null | undefined): SetAsideMode {
  return plan?.setAsideMode ?? "planned";
}

export interface PoolSummary {
  hasBudget: boolean;
  mode: SetAsideMode;
  setAside: string[];
  incomePaise: Paise;
  /** Planned amounts per group (all planned lines, set aside or not). */
  billsPaise: Paise;
  investmentsPaise: Paise;
  savingsPaise: Paise;
  /** Planned amounts actually taken off income (planned mode, set-aside categories only). */
  committedPaise: Paise;
  /** May be negative when commitments exceed income. */
  poolPaise: Paise;
  /** What is actually spread across the days: max(0, pool). */
  allocatablePaise: Paise;
  /** How far commitments exceed income (0 if they don't). */
  shortfallPaise: Paise;
}

export function hasBudget(plan: BudgetPlan | null | undefined): boolean {
  if (!plan || plan.budgetMode === "tracking") return false;
  if (plan.budgetMode === "set-aside" && modeOf(plan) === "actual") return true;
  return plan.incomePaise !== null && plan.incomePaise > 0;
}

export function poolSummary(plan: BudgetPlan | null | undefined): PoolSummary {
  const income = plan && plan.incomePaise ? plan.incomePaise : 0;
  const lines = plan?.commitments ?? [];
  const byKind = (k: CommitmentKind) => sum(lines.filter((c) => c.kind === k).map((c) => c.amountPaise));
  const setAside = setAsideOf(plan);
  const mode = modeOf(plan);
  const committed = mode === "planned" ? sum(lines.filter((c) => setAside.includes(commitmentCategory(c))).map((c) => c.amountPaise)) : 0;
  const pool = income - committed;
  const budget = hasBudget(plan);
  return {
    hasBudget: budget,
    mode,
    setAside,
    incomePaise: income,
    billsPaise: byKind("bill"),
    investmentsPaise: byKind("investment"),
    savingsPaise: byKind("savings"),
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

/** Planned-mode allocation for a day (0 in actual mode or without a budget; the ledger works those out). */
export function allocationForDay(plans: BudgetPlan[], day: DateKey): Paise {
  const plan = planForDate(plans, day);
  if (modeOf(plan) === "actual") return 0;
  return dailyAllocation(poolSummary(plan).allocatablePaise, day);
}

// ------------------------------------------------------ matching plan lines

const isOutflow = (t: Transaction) => t.kind === "expense" || t.kind === "commitment" || t.kind === "investment";

/**
 * The planned line a payment belongs to: the one you linked, else the best
 * unique match in the same category by UPI ID / text hint, tag or name.
 */
export function matchCommitment(t: Transaction, plan: BudgetPlan | null): Commitment | null {
  if (!plan) return null;
  if (t.commitmentId) {
    const linked = plan.commitments.find((c) => c.id === t.commitmentId);
    if (linked) return linked;
  }
  const text = ` ${normalize(`${t.merchant} ${t.payee ?? ""} ${t.note ?? ""} ${t.source.raw ?? ""}`)} `;
  const scored = plan.commitments
    .filter((c) => commitmentCategory(c) === t.category)
    .map((c) => {
      let score = 0;
      const hint = c.matchHint ? normalize(c.matchHint) : "";
      if (hint && (normalize(t.payee ?? "") === hint || text.includes(hint))) score += 3;
      if (c.tag && t.tag && normalize(c.tag) === normalize(t.tag)) score += 2;
      if (text.includes(` ${normalize(c.name)} `) || text.includes(normalize(c.name))) score += 2;
      if (Math.abs(t.amountPaise - c.amountPaise) <= c.amountPaise * 0.15) score += 1;
      return { c, score };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score);
  if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) return null;
  return scored[0].c;
}


/**
 * The day a credit starts funding the budget (actual mode). A salary, or any
 * credit of ₹10,000+, that lands on the 25th or later counts from the 1st of
 * the next month, so a salary paid on 31 Aug pays for September.
 */
export function incomeDate(t: Pick<Transaction, "date" | "tag" | "amountPaise">): DateKey {
  // Thresholds (default: from the 25th, ₹10,000+) come from the remote config.
  const { lateSalaryDay, bigCreditRupees } = getConfig().budget;
  if (parseKey(t.date).d >= lateSalaryDay && (t.tag === "Salary" || t.amountPaise >= bigCreditRupees * 100)) return addDays(endOfMonth(t.date), 1);
  return t.date;
}

// ------------------------------------------------------ budget entries

export interface SpendEntry {
  date: DateKey;
  amountPaise: Paise;
  category: string;
  txnId: string;
  merchant: string;
  /**
   * expense: everyday spending (net of linked refunds)
   * overage: a planned payment above its planned amount
   * unplanned: a set-aside payment with no planned line (planned mode)
   */
  source: "expense" | "overage" | "unplanned";
}

export interface SetAsideEntry {
  date: DateKey;
  amountPaise: Paise;
  category: string;
  txnId: string;
  commitmentId?: string;
}

export interface CreditEntry {
  date: DateKey;
  amountPaise: Paise;
  commitmentId: string;
  label: string;
}

export interface BudgetEntries {
  spend: SpendEntry[];
  setAside: SetAsideEntry[];
  /** Planned lines that came in under: credited on the last day of that month. */
  credits: CreditEntry[];
}

/**
 * Splits every outflow up to `asOf` into everyday spending, set-aside payments
 * and plan adjustments. Refunds linked to a payment reduce it (capped at the
 * payment). Transfers, income and unlinked refunds never count.
 */
export function budgetEntries(txns: Transaction[], plans: BudgetPlan[], asOf: DateKey): BudgetEntries {
  const live = txns.filter((t) => t.date <= asOf);
  const refunds = new Map<string, Paise>();
  for (const t of live) if (isReimbursementKind(t.kind) && t.refundOf) refunds.set(t.refundOf, (refunds.get(t.refundOf) ?? 0) + t.amountPaise);

  const spend: SpendEntry[] = [];
  const setAside: SetAsideEntry[] = [];
  const paid = new Map<string, { paid: Paise; planned: Paise; name: string; month: MonthKey; commitmentId: string; planId: string }>();

  for (const t of live.filter(isOutflow).sort(byDateThenCreated)) {
    const net = Math.max(0, t.amountPaise - (refunds.get(t.id) ?? 0));
    if (net === 0) continue;
    const plan = planForDate(plans, t.date);
    const base = { date: t.date, category: t.category, txnId: t.id, merchant: t.merchant };
    const linked = t.commitmentId ? plan?.commitments.find((c) => c.id === t.commitmentId) : undefined;
    const category = linked ? commitmentCategory(linked) : t.category;
    if (!(hasBudget(plan) ? setAsideOf(plan) : DEFAULT_SET_ASIDE).includes(category)) {
      spend.push({ ...base, amountPaise: net, source: "expense" });
      continue;
    }
    if (!hasBudget(plan) || modeOf(plan) === "actual") {
      setAside.push({ date: t.date, amountPaise: net, category, txnId: t.id });
      continue;
    }
    const c = matchCommitment(t, plan);
    if (!c) {
      spend.push({ ...base, amountPaise: net, source: "unplanned" });
      continue;
    }
    const key = `${plan!.id}:${c.id}@${monthKey(t.date)}`;
    const cur = paid.get(key) ?? { paid: 0, planned: c.amountPaise, name: c.name, month: monthKey(t.date), commitmentId: c.id, planId: plan!.id };
    const before = cur.paid;
    cur.paid += net;
    paid.set(key, cur);
    const excess = Math.max(0, cur.paid - cur.planned) - Math.max(0, before - cur.planned);
    if (net - excess > 0) setAside.push({ date: t.date, amountPaise: net - excess, category, txnId: t.id, commitmentId: c.id });
    if (excess > 0) spend.push({ ...base, amountPaise: excess, source: "overage" });
  }

  const credits: CreditEntry[] = [];
  for (const v of paid.values()) {
    const end = endOfMonth(`${v.month}-01`);
    if (v.paid < v.planned && end <= asOf && planForDate(plans, end)?.id === v.planId) credits.push({ date: end, amountPaise: v.planned - v.paid, commitmentId: v.commitmentId, label: `${v.name} came in under` });
  }
  return { spend, setAside, credits };
}

/** Everyday spending that counts against the daily budget (compatibility helper). */
export function discretionaryEntries(txns: Transaction[], plans: BudgetPlan[], asOf: DateKey): SpendEntry[] {
  return budgetEntries(txns, plans, asOf).spend;
}

function byDateThenCreated(a: Transaction, b: Transaction) {
  return a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1;
}

// ------------------------------------------------------------------ ledger

export interface DayRow {
  date: DateKey;
  hasBudget: boolean;
  everydayPaise: Paise;
  /** Actual expenses including bills, excluding investments, savings and transfers. */
  expensePaise: Paise;
  allocationPaise: Paise;
  spentPaise: Paise;
  /** Plan adjustments that day: + a planned payment came in under, − actual-mode payments beyond the pool. */
  adjustPaise: Paise;
  /** Set-aside payments that day (not counted as spending). */
  setAsidePaise: Paise;
  /** Balance carried in from previous days (incl. opening adjustment). */
  carriedInPaise: Paise;
  /** carriedIn + allocation − spent + adjust. */
  closingPaise: Paise;
  underBudget: boolean;
}

export interface Ledger {
  started: boolean;
  hasBudget: boolean;
  mode: SetAsideMode;
  today: DateKey;
  days: DayRow[];
  todayRow: DayRow;
  /** Money available to spend right now (negative = deficit). */
  availablePaise: Paise;
  totalAllocatedPaise: Paise;
  totalSpentPaise: Paise;
  /** Consecutive completed days (ending yesterday) where spend ≤ that day's allocation. */
  streak: number;
  /** Tomorrow's allocation if nothing else is set aside before then. */
  nextAllocationPaise: Paise;
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
  const todayPlan = planForDate(plans, today);
  const budget = hasBudget(todayPlan);

  const entries = budgetEntries(txns, plans, today);
  const byDay = (xs: { date: DateKey; amountPaise: Paise }[]) => {
    const m = new Map<DateKey, Paise>();
    for (const e of xs) if (e.date >= start) m.set(e.date, (m.get(e.date) ?? 0) + e.amountPaise);
    return m;
  };
  const spentByDay = byDay(entries.spend);
  const everydayByDay = byDay(everydayEntries(txns, start, today));
  const expensesByDay = byDay(expenseEntries(txns, start, today));
  const setAsideByDay = byDay(entries.setAside);
  const creditByDay = byDay(entries.credits);

  // Actual-mode state for the month being walked.
  let month = "";
  let allocated = 0; // allocated so far this month
  let charged = 0; // set-aside overshoot already charged as a deficit this month
  let setAsideSoFar = 0;
  let budgetStart = start;
  const actualAllocation = (day: DateKey) => {
    const { y, m, d } = parseKey(day);
    const dim = daysInMonth(y, m);
    const firstTracked = budgetStart > startOfMonth(day) ? budgetStart : startOfMonth(day);
    const income = sum(
      txns
        .filter((t) => t.kind === "income")
        .filter((t) => {
          const on = incomeDate(t);
          return on >= firstTracked && on <= day;
        })
        .map((t) => t.amountPaise),
    );
    // What's left to spread; overshoot already charged doesn't count twice.
    const remaining = income - setAsideSoFar - allocated + charged;
    if (remaining < 0) return { allocation: 0, charge: -remaining };
    const daysLeft = dim - d + 1;
    return { allocation: daysLeft === 1 ? remaining : Math.floor(remaining / daysLeft), charge: 0 };
  };

  const days: DayRow[] = [];
  let balance = hasBudget(planForDate(plans, start)) && modeOf(planForDate(plans, start)) === "planned" ? profile.openingAdjustmentPaise : 0;
  let wasBudget = hasBudget(planForDate(plans, start));
  let totalAlloc = 0;
  let totalSpent = 0;
  if (started) {
    for (const day of eachDay(start, today)) {
      const plan = planForDate(plans, day);
      const dayHasBudget = hasBudget(plan);
      // Tracking has no balance. Starting a budget after tracking starts fresh.
      if (dayHasBudget !== wasBudget) {
        balance = 0;
        allocated = 0;
        charged = 0;
        setAsideSoFar = 0;
        budgetStart = day;
      }
      wasBudget = dayHasBudget;
      if (monthKey(day) !== month) {
        month = monthKey(day);
        allocated = 0;
        charged = 0;
        setAsideSoFar = 0;
      }
      const setAsideToday = setAsideByDay.get(day) ?? 0;
      if (dayHasBudget) setAsideSoFar += setAsideToday;
      let allocation = 0;
      let adjust = dayHasBudget && modeOf(plan) === "planned" ? creditByDay.get(day) ?? 0 : 0;
      if (hasBudget(plan) && modeOf(plan) === "actual") {
        const a = actualAllocation(day);
        allocation = a.allocation;
        adjust -= a.charge;
        allocated += a.allocation;
        charged += a.charge;
      } else {
        allocation = allocationForDay(plans, day);
        allocated += allocation;
      }
      const spent = spentByDay.get(day) ?? 0;
      const carriedIn = balance;
      balance = dayHasBudget ? carriedIn + allocation - spent + adjust : 0;
      totalAlloc += allocation;
      totalSpent += spent;
      days.push({
        date: day,
        hasBudget: dayHasBudget,
        everydayPaise: everydayByDay.get(day) ?? 0,
        expensePaise: expensesByDay.get(day) ?? 0,
        allocationPaise: allocation,
        spentPaise: spent,
        adjustPaise: adjust,
        setAsidePaise: setAsideToday,
        carriedInPaise: carriedIn,
        closingPaise: balance,
        underBudget: dayHasBudget && spent - adjust <= allocation,
      });
    }
  }

  const todayRow: DayRow =
    days[days.length - 1] ??
    { date: today, hasBudget: budget, everydayPaise: 0, expensePaise: 0, allocationPaise: 0, spentPaise: 0, adjustPaise: 0, setAsidePaise: 0, carriedInPaise: 0, closingPaise: 0, underBudget: true };

  let streak = 0;
  for (let i = budget ? days.length - 2 : -1; i >= 0; i--) {
    if (days[i].underBudget && days[i].allocationPaise > 0) streak++;
    else break;
  }

  const tomorrow = addDays(today, 1);
  const tomorrowPlan = planForDate(plans, tomorrow);
  let next = 0;
  if (hasBudget(tomorrowPlan)) {
    if (modeOf(tomorrowPlan) === "actual") {
      if (!budget || monthKey(tomorrow) !== month) {
        if (!budget) budgetStart = tomorrow;
        allocated = 0;
        charged = 0;
        setAsideSoFar = 0;
      }
      next = actualAllocation(tomorrow).allocation;
    } else next = allocationForDay(plans, tomorrow);
  }

  return {
    started,
    hasBudget: budget,
    mode: modeOf(todayPlan),
    today,
    days,
    todayRow,
    availablePaise: started ? balance : 0,
    totalAllocatedPaise: totalAlloc,
    totalSpentPaise: totalSpent,
    streak,
    nextAllocationPaise: next,
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
  const inMonth = txns.filter((t) => isOutflow(t) && monthKey(t.date) === mk);
  const linked = new Map<string, Transaction[]>();
  for (const t of inMonth) {
    const c = matchCommitment(t, plan);
    if (c) linked.set(c.id, [...(linked.get(c.id) ?? []), t]);
  }
  return plan.commitments
    .map((c) => {
      const matched = linked.get(c.id) ?? [];
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
  /** Everything except Bills, Investments and Savings. */
  everydayPaise: Paise;
  billsPaise: Paise;
  investmentsPaise: Paise;
  savingsPaise: Paise;
  /** All money out. Transfers excluded. */
  totalPaise: Paise;
  transfersExcludedPaise: Paise;
  incomePaise: Paise;
}

/** Everyday reporting never depends on the user's set-aside preferences. */
export function everydayEntries(txns: Transaction[], from: DateKey, to: DateKey): SpendEntry[] {
  return netOutflows(txns, from, to)
    .filter(({ t }) => !DEFAULT_SET_ASIDE.includes(t.category))
    .map(({ t, net }) => ({ date: t.date, amountPaise: net, category: t.category, txnId: t.id, merchant: t.merchant, source: "expense" }));
}

/** Tracking expenses include bills and exclude money retained as investments/savings. */
export function expenseEntries(txns: Transaction[], from: DateKey, to: DateKey): SpendEntry[] {
  return netOutflows(txns, from, to).filter(({ t }) => !(t.kind === "investment" || ["Investments", "Savings"].includes(t.category)))
    .map(({ t, net }) => ({ date: t.date, amountPaise: net, category: t.category, txnId: t.id, merchant: t.merchant, source: "expense" }));
}

/** Net outflows (after linked refunds) in a date range, by what they're for. */
function netOutflows(txns: Transaction[], from: DateKey, to: DateKey) {
  const refunds = new Map<string, Paise>();
  for (const t of txns) if (isReimbursementKind(t.kind) && t.refundOf && t.date <= to) refunds.set(t.refundOf, (refunds.get(t.refundOf) ?? 0) + t.amountPaise);
  return txns
    .filter((t) => isOutflow(t) && t.date >= from && t.date <= to)
    .map((t) => ({ t, net: Math.max(0, t.amountPaise - (refunds.get(t.id) ?? 0)) }))
    .filter((x) => x.net > 0);
}

export function outgoingsInRange(txns: Transaction[], from: DateKey, to: DateKey): Outgoings {
  const out = netOutflows(txns, from, to);
  const of = (cat: string) => sum(out.filter((x) => x.t.category === cat).map((x) => x.net));
  const bills = of("Bills");
  const investments = of("Investments");
  const savings = of("Savings");
  const total = sum(out.map((x) => x.net));
  const ts = txns.filter((t) => t.date >= from && t.date <= to);
  return {
    everydayPaise: total - bills - investments - savings,
    billsPaise: bills,
    investmentsPaise: investments,
    savingsPaise: savings,
    totalPaise: total,
    transfersExcludedPaise: sum(ts.filter((t) => t.kind === "transfer").map((t) => t.amountPaise)),
    incomePaise: sum(ts.filter((t) => t.kind === "income").map((t) => t.amountPaise)),
  };
}

/**
 * Spending by category in a range. Investments and Savings aren't expenses,
 * so they're always left out; pass more categories to exclude (e.g. Bills for
 * everyday-only views).
 */
export function categoryBreakdown(
  txns: Transaction[],
  _plans: BudgetPlan[],
  from: DateKey,
  to: DateKey,
  opts: { exclude?: string[] } = {},
): { category: string; amountPaise: Paise; count: number }[] {
  const exclude = new Set([...NOT_EXPENSE, ...(opts.exclude ?? [])]);
  const map = new Map<string, { amountPaise: Paise; count: number }>();
  for (const { t, net } of netOutflows(txns, from, to)) {
    if (t.kind === "investment" || exclude.has(t.category)) continue;
    const cur = map.get(t.category) ?? { amountPaise: 0, count: 0 };
    cur.amountPaise += net;
    cur.count += 1;
    map.set(t.category, cur);
  }
  return [...map.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.amountPaise - a.amountPaise);
}

/** Group budget spend entries by category (what moved the daily budget). */
export function groupSpend(entries: SpendEntry[]): { category: string; amountPaise: Paise; count: number }[] {
  const map = new Map<string, { amountPaise: Paise; ids: Set<string> }>();
  for (const e of entries) {
    const cur = map.get(e.category) ?? { amountPaise: 0, ids: new Set<string>() };
    cur.amountPaise += e.amountPaise;
    cur.ids.add(e.txnId);
    map.set(e.category, cur);
  }
  return [...map.entries()].map(([category, v]) => ({ category, amountPaise: v.amountPaise, count: v.ids.size })).sort((a, b) => b.amountPaise - a.amountPaise);
}

/** Budget vs actual per day in a range (for charts). */
export function spendVsBudgetSeries(ledger: Ledger, from: DateKey, to: DateKey) {
  const byDate = new Map(ledger.days.map((d) => [d.date, d]));
  let cumBudget = 0;
  let cumSpent = 0;
  const out: { date: DateKey; budgetPaise: Paise; spentPaise: Paise; cumBudgetPaise: Paise; cumSpentPaise: Paise }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const row = byDate.get(d);
    const b = (row?.allocationPaise ?? 0) + Math.max(0, row?.adjustPaise ?? 0);
    const s = (ledger.hasBudget ? row?.spentPaise ?? 0 : row?.expensePaise ?? 0) + (ledger.hasBudget ? Math.max(0, -(row?.adjustPaise ?? 0)) : 0);
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

/** Economic position for Stats: reimbursements reduce their linked expense,
 * never become income. Legacy Savings records are retained under Investments. */
export function netInHandInRange(txns: Transaction[], from: DateKey, to: DateKey) {
  const out = netOutflows(txns, from, to);
  const investmentsPaise = sum(out.filter(({ t }) => t.kind === "investment" || ["Investments", "Savings"].includes(t.category)).map(x => x.net));
  const moneyOutPaise = sum(out.map(x => x.net));
  const incomePaise = sum(txns.filter(t => t.kind === "income" && !["Refunds", "Settlement"].includes(t.category) && t.date >= from && t.date <= to).map(t => t.amountPaise));
  return { incomePaise, expensesPaise: moneyOutPaise - investmentsPaise, investmentsPaise, moneyOutPaise, netPaise: incomePaise - moneyOutPaise };
}

/** Compare the same day numbers with last month's cumulative spending.
 * Shorter months stop at their last day; incomplete history stays unknown. */
export function previousMonthCumulative(ledger: Ledger, dates: DateKey[], trackingStart: DateKey): (number | null)[] {
  const cache = new Map<string, ReturnType<typeof spendVsBudgetSeries>>();
  return dates.map(date => {
    const previous = addMonths(monthKey(date), -1) + "-01";
    if (previous < trackingStart) return null;
    let days = cache.get(previous);
    if (!days) { days = spendVsBudgetSeries(ledger, previous, endOfMonth(previous)); cache.set(previous, days); }
    return days[Math.min(Number(date.slice(8)), days.length) - 1]?.cumSpentPaise ?? null;
  });
}
