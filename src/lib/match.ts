/**
 * Matching helpers: refunds → original expenses, payments → commitment
 * reservations, and debit/credit pairs that look like own-account transfers.
 * They only *suggest*; the UI (or an import with one unambiguous match) applies.
 */
import { diffDays, monthKey } from "./dates";
import { normalize } from "./categorize";
import type { BudgetPlan, Commitment, Transaction } from "./types";
import { planForDate } from "./budget";

function merchantKey(s: string) {
  return normalize(s).replace(/[^a-z0-9]/g, "").replace(/(pvtltd|ltd|india|pvt|private|limited|online|payments?)$/g, "");
}

function sameMerchant(a: string, b: string) {
  const x = merchantKey(a), y = merchantKey(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

export interface RefundCandidate {
  expense: Transaction;
  score: number;
  exactAmount: boolean;
}

/** Expenses a refund could belong to: same merchant, on/before the refund, within 120 days, not already fully refunded. */
export function refundCandidates(refund: Transaction, txns: Transaction[]): RefundCandidate[] {
  const refundedSoFar = new Map<string, number>();
  for (const t of txns) if (t.kind === "refund" && t.refundOf && t.id !== refund.id) refundedSoFar.set(t.refundOf, (refundedSoFar.get(t.refundOf) ?? 0) + t.amountPaise);
  return txns
    .filter((t) => t.kind === "expense" && t.date <= refund.date && diffDays(t.date, refund.date) <= 120 && sameMerchant(t.merchant, refund.merchant))
    .filter((t) => t.amountPaise - (refundedSoFar.get(t.id) ?? 0) >= refund.amountPaise)
    .map((expense) => {
      const exactAmount = expense.amountPaise === refund.amountPaise;
      const score = (exactAmount ? 100 : 40) - diffDays(expense.date, refund.date) * 0.2;
      return { expense, score, exactAmount };
    })
    .sort((a, b) => b.score - a.score);
}

/** Link a refund if there is exactly one exact-amount candidate; otherwise flag for review. */
export function autoLinkRefund(refund: Transaction, txns: Transaction[]): Pick<Transaction, "refundOf" | "needsReview" | "reviewReason"> {
  const cands = refundCandidates(refund, txns);
  const exact = cands.filter((c) => c.exactAmount);
  if (exact.length === 1) return { refundOf: exact[0].expense.id, needsReview: false, reviewReason: undefined };
  if (exact.length === 0 && cands.length === 1) return { refundOf: undefined, needsReview: true, reviewReason: "Possible partial refund — confirm the original expense" };
  return {
    refundOf: undefined,
    needsReview: true,
    reviewReason: cands.length ? "Several expenses could match this refund" : "No matching expense found for this refund",
  };
}

export interface CommitmentCandidate {
  commitment: Commitment;
  score: number;
  reason: string;
}

/** Suggest which reservation a payment belongs to (hint text, or amount within 10%). */
export function commitmentCandidates(txn: Transaction, plans: BudgetPlan[], txns: Transaction[]): CommitmentCandidate[] {
  const plan = planForDate(plans, txn.date);
  if (!plan) return [];
  const mk = monthKey(txn.date);
  const text = normalize(`${txn.merchant} ${txn.note ?? ""} ${txn.source.raw ?? ""}`);
  return plan.commitments
    .map((c) => {
      const paid = txns.filter((t) => t.id !== txn.id && t.kind === "commitment" && t.commitmentId === c.id && monthKey(t.date) === mk).reduce((s, t) => s + t.amountPaise, 0);
      const hint = c.matchHint ? normalize(c.matchHint) : "";
      const hintHit = !!hint && text.includes(hint);
      const nameHit = text.includes(normalize(c.name));
      const diff = Math.abs(txn.amountPaise - c.amountPaise) / Math.max(1, c.amountPaise);
      const amountHit = diff <= 0.1;
      let score = 0;
      const reasons: string[] = [];
      if (hintHit || nameHit) (score += 60), reasons.push("name matches");
      if (amountHit) (score += 40 - diff * 100), reasons.push(diff === 0 ? "exact amount" : "similar amount");
      if (paid >= c.amountPaise) (score -= 30), reasons.push("already paid this month");
      return { commitment: c, score, reason: reasons.join(" · ") };
    })
    .filter((c) => c.score > 20)
    .sort((a, b) => b.score - a.score);
}

export interface TransferPair {
  out: Transaction;
  in: Transaction;
}

/** Equal-amount money-out and money-in within 2 days often means moving money between your own accounts. */
export function transferPairs(txns: Transaction[]): TransferPair[] {
  const outs = txns.filter((t) => t.kind === "expense" || t.kind === "investment");
  const ins = txns.filter((t) => t.kind === "income");
  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const o of outs) {
    const m = ins.find((i) => !used.has(i.id) && i.amountPaise === o.amountPaise && Math.abs(diffDays(o.date, i.date)) <= 2 && i.source.providerId !== "manual");
    if (m && o.amountPaise >= 100_00) {
      used.add(m.id);
      pairs.push({ out: o, in: m });
    }
  }
  return pairs;
}
