/** Genuine repeating mandates, anchored to their own schedule and reference. */
import type { CommitmentStatus } from "./budget";
import { isIpoMandate } from "./ipo";
import { normalize } from "./categorize";
import { type DateKey, addDays, addMonths, diffDays, dueDateInMonth, monthKey, toISTKey } from "./dates";
import type { Paise } from "./money";
import type { FundHold, Recurring, Transaction } from "./types";

export interface DueItem {
  key: string; name: string; amountPaise: Paise; dueDate: DateKey;
  state: "overdue" | "due_today" | "upcoming" | "missed";
  category: string; tag?: string; source: "plan" | "mandate" | "manual";
}
const GRACE_DAYS = 5;
const isOut = (t: Transaction) => ["expense", "commitment", "investment"].includes(t.kind);

function paidAround(r: Recurring, due: DateKey, txns: Transaction[], today: DateKey, requireReference = false): boolean {
  const before = r.frequency === "daily" ? 0 : r.frequency === "weekly" ? 2 : 10;
  const after = r.frequency === "daily" ? 0 : GRACE_DAYS;
  return txns.some((t) => {
    if (!isOut(t) || t.date < addDays(due, -before) || t.date > (today < addDays(due, after) ? today : addDays(due, after))) return false;
    if (requireReference && (!r.mandateRef || !normalize(t.source.raw ?? "").includes(normalize(r.mandateRef)))) return false;
    const identity = r.payee && t.payee ? normalize(r.payee) === normalize(t.payee) : normalize(t.merchant) === normalize(r.name);
    return identity && (r.source === "mandate" || Math.abs(t.amountPaise - r.amountPaise) <= r.amountPaise * 0.3);
  });
}
const monthStep = (r: Recurring) => r.frequency === "quarterly" ? 3 : r.frequency === "half-yearly" ? 6 : r.frequency === "yearly" ? 12 : 1;
const monthNumber = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

export function nextDue(r: Recurring, txns: Transaction[], today: DateKey, requireReference = false): DateKey {
  const start = r.startDate ?? dueDateInMonth(monthKey(toISTKey(r.createdAt)), r.dueDay);
  if (r.frequency === "once" || r.frequency === "unknown") return start;
  let due: DateKey;
  if (r.frequency === "daily" || r.frequency === "weekly") {
    const step = r.frequency === "daily" ? 1 : 7;
    due = addDays(start, Math.max(0, Math.floor(diffDays(start, today) / step)) * step);
    if (due <= today && paidAround(r, due, txns, today, requireReference)) due = addDays(due, step);
  } else {
    const step = monthStep(r);
    const anchor = r.startDate ? monthKey(start) : r.dueMonth ? `${today.slice(0, 4)}-${String(r.dueMonth).padStart(2, "0")}` : monthKey(start);
    const cycles = Math.max(0, Math.floor((monthNumber(today) - monthNumber(anchor)) / step));
    let mk = addMonths(anchor, cycles * step);
    due = dueDateInMonth(mk, r.dueDay);
    if (due < start) { mk = addMonths(mk, step); due = dueDateInMonth(mk, r.dueDay); }
    if (due <= today && paidAround(r, due, txns, today, requireReference)) due = dueDateInMonth(addMonths(mk, step), r.dueDay);
  }
  return due;
}
const state = (due: DateKey, today: DateKey): DueItem["state"] => diffDays(due, today) > GRACE_DAYS ? "missed" : due < today ? "overdue" : due === today ? "due_today" : "upcoming";

export function upcomingPayments(input: { statuses: CommitmentStatus[]; recurring: Recurring[]; txns: Transaction[]; today: DateKey; days?: number; holds?: FundHold[] }): DueItem[] {
  const { statuses, recurring, txns, today, days = 7 } = input;
  const items: DueItem[] = [];
  const seen = new Set<string>();
  for (const s of statuses) {
    if (s.state === "paid" || diffDays(today, s.dueDate) > days) continue;
    const c = s.commitment;
    items.push({ key: `plan:${c.id}`, name: c.name, amountPaise: Math.max(0, c.amountPaise - s.paidPaise), dueDate: s.dueDate, state: state(s.dueDate, today), category: c.kind === "investment" ? "Investments" : c.kind === "savings" ? "Savings" : "Bills", tag: c.tag, source: "plan" });
    seen.add(normalize(c.name));
    if (c.matchHint) seen.add(normalize(c.matchHint));
  }
  const live = recurring.filter((r) => !isIpoMandate(r, input.holds) && r.status === "active" && r.source === "mandate" && r.frequency !== "once" && r.frequency !== "unknown");
  for (const r of live) {
    if (seen.has(normalize(r.name)) || (r.payee && seen.has(normalize(r.payee)))) continue;
    const siblings = live.filter((other) => other.id !== r.id && (r.payee ? normalize(other.payee ?? "") === normalize(r.payee) : normalize(other.name) === normalize(r.name)));
    const due = nextDue(r, txns, today, siblings.length > 0);
    if (diffDays(today, due) > days) continue;
    items.push({ key: `rec:${r.id}`, name: r.name, amountPaise: r.amountPaise, dueDate: due, state: state(due, today), category: r.category, tag: r.tag, source: r.source });
  }
  return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
