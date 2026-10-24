import type { Transaction, TxnKind } from "./types";

export const isReimbursementKind = (kind: TxnKind | undefined) => kind === "refund" || kind === "settlement";
export const canSettle = (t: Transaction) => ["expense", "commitment"].includes(t.kind) && !["Investments", "Savings"].includes(t.category);

export function remainingToReimburse(expense: Transaction, txns: Transaction[], excludingId?: string): number {
  const paidBack = txns.filter(t => t.id !== excludingId && isReimbursementKind(t.kind) && t.refundOf === expense.id).reduce((sum, t) => sum + t.amountPaise, 0);
  return Math.max(0, expense.amountPaise - paidBack);
}

export function settlementCandidates(credit: Pick<Transaction, "id" | "date" | "amountPaise">, txns: Transaction[]): Transaction[] {
  return txns.filter(t => canSettle(t) && t.id !== credit.id && t.date <= credit.date && remainingToReimburse(t, txns, credit.id) > 0 && remainingToReimburse(t, txns, credit.id) >= credit.amountPaise).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

/** Check under the caller's write transaction, so simultaneous links cannot
 * spend the same remaining share. The existing refundOf index is shared by
 * refunds and settlements; old backups need no data rewrite.
 */
export function validateSettlement(t: Transaction, txns: Transaction[]): void {
  if (t.kind !== "settlement" || !t.refundOf) return;
  const original = txns.find(x => x.id === t.refundOf);
  if (!original || !canSettle(original) || original.date > t.date || original.id === t.id) throw new Error("Choose an earlier expense for this settlement");
  if (t.amountPaise > remainingToReimburse(original, txns, t.id)) throw new Error("Settlement exceeds the original expense's remaining amount");
}
