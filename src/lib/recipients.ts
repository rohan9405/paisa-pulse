import { normalize } from "./categorize";
import { addMonths, dueDateInMonth, parseKey, toISTKey } from "./dates";
import type { Transaction } from "./types";

/**
 * Placeholder names the SMS parser uses when a message names no payee
 * ("HDFC debit", "ATM cash", "UPI Lite top-up"). They aren't one recipient, so
 * they never get recipient rules or bulk edits.
 */
export function isGenericName(name: string): boolean {
  const n = normalize(name);
  return !n || n === "unknown" || n === "expense" || n === "atm cash" || n === "upi lite top-up" || /^(hdfc|icici|sbi|axis|kotak) (debit|credit)$/.test(n);
}

export function recipientKey(t: Pick<Transaction, "payee" | "merchant">): string | null {
  const payee = normalize(t.payee ?? "");
  if (payee) return `p:${payee}`;
  return isGenericName(t.merchant) ? null : `n:${normalize(t.merchant)}`;
}

export function taggingFlow(t: Pick<Transaction, "kind">): string {
  return ["expense", "investment", "commitment"].includes(t.kind) ? "out" : t.kind;
}

export function sameRecipient(a: Transaction, b: Transaction): boolean {
  const key = recipientKey(a);
  return !!key && key === recipientKey(b) && taggingFlow(a) === taggingFlow(b);
}

/** Rolling twelve calendar months, including the cutoff day. Leap days clamp to February 28. */
export function taggingCutoff(today = toISTKey()): string {
  return dueDateInMonth(addMonths(today.slice(0, 7), -12), parseKey(today).d);
}

export function withinTaggingWindow(t: Pick<Transaction, "date">, today = toISTKey()): boolean {
  return t.date >= taggingCutoff(today) && t.date <= today;
}

export function recipientMatches(txns: Transaction[], txn: Transaction, scope: "month" | "all", today = toISTKey()): Transaction[] {
  const cutoff = taggingCutoff(today);
  return txns.filter((t) => t.id !== txn.id && t.date >= cutoff && t.date <= today && sameRecipient(t, txn) && (scope === "all" || t.date.slice(0, 7) === txn.date.slice(0, 7)));
}

/** A category is enough; optional finer tags must agree across recent payments.
 * Older history cannot keep a recipient in the queue because bulk edits skip it.
 */
export function recipientNeedsTagging(txns: Transaction[], today = toISTKey()): boolean {
  const recent = txns.filter((t) => withinTaggingWindow(t, today));
  if (!recent.length) return false;
  const first = recent[0];
  return recent.some((t) => (!t.category || t.category === "Other") && !t.tag?.trim()) ||
    recent.some((t) => t.category !== first.category || (t.tag?.trim() ?? "") !== (first.tag?.trim() ?? ""));
}
