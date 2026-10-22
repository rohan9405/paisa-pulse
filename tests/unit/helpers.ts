import type { BudgetPlan, Commitment, Transaction } from "@/lib/types";

let n = 0;
export function txn(p: Partial<Transaction> & Pick<Transaction, "date" | "amountPaise">): Transaction {
  n++;
  return {
    id: p.id ?? `t${n}`,
    kind: "expense",
    merchant: "Test",
    category: "Other",
    method: "upi",
    source: { providerId: "manual", importedAt: 0 },
    createdAt: n,
    updatedAt: n,
    ...p,
  };
}

export function plan(p: Partial<BudgetPlan> & { incomePaise: number | null }): BudgetPlan {
  return { ...p, id: p.id ?? "plan1", effectiveFrom: p.effectiveFrom ?? "2000-01-01", commitments: p.commitments ?? [], createdAt: p.createdAt ?? 0, incomePaise: p.incomePaise };
}

export function commitment(p: Partial<Commitment> & Pick<Commitment, "id" | "amountPaise">): Commitment {
  return { name: p.id, kind: "bill", dueDay: 5, ...p };
}

export const profile = (trackingStart: string, openingAdjustmentPaise = 0) => ({ trackingStart, openingAdjustmentPaise, manuallyPaid: [] as string[] });
