/**
 * Upcoming regular payments for the "Coming up" reminders: planned budget
 * lines plus recurring payments (from autopay/mandate SMS, or ones you marked).
 */
import type { CommitmentStatus } from "./budget";
import { normalize } from "./categorize";
import { type DateKey, addDays, addMonths, diffDays, dueDateInMonth, monthKey, toISTKey } from "./dates";
import type { Paise } from "./money";
import type { Recurring, Transaction } from "./types";

export interface DueItem {
  key: string;
  name: string;
  amountPaise: Paise;
  dueDate: DateKey;
  state: "overdue" | "due_today" | "upcoming";
  category: string;
  tag?: string;
  source: "plan" | "mandate" | "manual";
}

/** How late an unpaid payment still shows as overdue before rolling to the next cycle. */
const GRACE_DAYS = 5;

const isOut = (t: Transaction) => t.kind === "expense" || t.kind === "commitment" || t.kind === "investment";

function paidAround(r: Recurring, due: DateKey, txns: Transaction[], today: DateKey): boolean {
  const name = normalize(r.name);
  return txns.some(
    (t) =>
      isOut(t) &&
      t.date >= addDays(due, -10) &&
      t.date <= (today < addDays(due, GRACE_DAYS) ? today : addDays(due, GRACE_DAYS)) &&
      ((r.payee && t.payee === r.payee) || normalize(t.merchant) === name) &&
      // Mandates are often "up to" amounts, so any amount counts for them.
      (r.source === "mandate" || Math.abs(t.amountPaise - r.amountPaise) <= r.amountPaise * 0.3),
  );
}

function stepMonths(r: Recurring) {
  return r.frequency === "quarterly" ? 3 : r.frequency === "yearly" ? 12 : 1;
}

/** The due date this payment is currently waiting on (may be a few days past). */
export function nextDue(r: Recurring, txns: Transaction[], today: DateKey): DateKey {
  if (r.frequency === "weekly") {
    let d = dueDateInMonth(monthKey(toISTKey(r.createdAt)), r.dueDay);
    while (d < addDays(today, -GRACE_DAYS) || (d <= today && paidAround(r, d, txns, today))) d = addDays(d, 7);
    return d;
  }
  const step = stepMonths(r);
  // Start from the cycle month at or before this month.
  let mk = monthKey(today);
  if (r.dueMonth && step > 1) {
    const [y, m] = mk.split("-").map(Number);
    const offset = (((m - r.dueMonth) % step) + step) % step;
    mk = addMonths(`${y}-${String(m).padStart(2, "0")}`, -offset);
  }
  let due = dueDateInMonth(mk, r.dueDay);
  for (let i = 0; i < 3; i++) {
    const tooLate = diffDays(due, today) > GRACE_DAYS;
    if (!tooLate && !paidAround(r, due, txns, today)) return due;
    mk = addMonths(mk, step);
    due = dueDateInMonth(mk, r.dueDay);
  }
  return due;
}

function state(due: DateKey, today: DateKey): DueItem["state"] {
  return due < today ? "overdue" : due === today ? "due_today" : "upcoming";
}

/**
 * Payments due within `days` (plus anything overdue), soonest first. A recurring
 * payment that's also a planned budget line shows once, as the plan line.
 */
export function upcomingPayments(input: { statuses: CommitmentStatus[]; recurring: Recurring[]; txns: Transaction[]; today: DateKey; days?: number }): DueItem[] {
  const { statuses, recurring, txns, today, days = 7 } = input;
  const items: DueItem[] = [];
  const seen = new Set<string>();
  for (const s of statuses) {
    if (s.state === "paid" || diffDays(today, s.dueDate) > days) continue;
    const c = s.commitment;
    items.push({
      key: `plan:${c.id}`,
      name: c.name,
      amountPaise: Math.max(0, c.amountPaise - s.paidPaise),
      dueDate: s.dueDate,
      state: s.state === "partial" ? state(s.dueDate, today) : s.state === "due_today" ? "due_today" : s.state === "overdue" ? "overdue" : "upcoming",
      category: c.kind === "investment" ? "Investments" : c.kind === "savings" ? "Savings" : "Bills",
      tag: c.tag,
      source: "plan",
    });
    seen.add(normalize(c.name));
    if (c.matchHint) seen.add(normalize(c.matchHint));
  }
  for (const r of recurring) {
    // Reminders come only from autopay / e-mandate SMS, never from manual entries.
    if (r.status !== "active" || r.source !== "mandate") continue;
    if (seen.has(normalize(r.name)) || (r.payee && seen.has(normalize(r.payee)))) continue;
    const due = nextDue(r, txns, today);
    if (diffDays(today, due) > days || diffDays(due, today) > GRACE_DAYS) continue;
    items.push({ key: `rec:${r.id}`, name: r.name, amountPaise: r.amountPaise, dueDate: due, state: state(due, today), category: r.category, tag: r.tag, source: r.source });
  }
  return items.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}
