"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useScope } from "@/features/accounts/Scope";
import { commitmentStatuses, computeLedger, hasBudget, modeOf, planForDate, poolSummary } from "@/lib/budget";
import { monthKey } from "@/lib/dates";
import { upcomingPayments } from "@/lib/recurring";
import { type AppData, useAppData, useStore } from "./store";

/** Everything the screens need, derived from the live database snapshot. */
export function useBudget() {
  const rawData = useAppData();
  const { selectedIds } = useScope();
  const path = usePathname();
  const scopedData = useMemo(() => !rawData || selectedIds === null ? rawData : ({ ...rawData, txns: rawData.txns.filter(t => selectedIds.includes(t.accountId ?? 'unknown')), accounts: rawData.accounts.filter(a => selectedIds.includes(a.id)), holds: rawData.holds.filter(h => rawData.accounts.some(a => selectedIds.includes(a.id) && a.bank === h.bank && a.last4 === h.account)), recurring: rawData.recurring.filter(r => !!r.bank && rawData.accounts.some(a => selectedIds.includes(a.id) && a.bank === r.bank)) }), [rawData, selectedIds]);
  const data = useMemo(() => !scopedData || !["/", "/dashboard"].includes(path.replace(/\/$/, "") || "/") ? scopedData : ({...scopedData, txns: scopedData.txns.filter(t => !t.accountingPending)}), [scopedData, path]);
  const { today, mode, db } = useStore();
  const derived = useMemo(() => {
    if (!data || !data.profile) return null;
    const { profile, plans } = data;
    const txns = data.txns.filter(t => !t.accountingPending);
    const plan = planForDate(plans, today) ?? plans[0] ?? null;
    const ledger = computeLedger({ plans, profile, txns, today });
    // Planned lines are budget inputs only in planned mode; otherwise reminders come from autopay SMS alone.
    const statuses = hasBudget(plan) && modeOf(plan) === "planned" ? commitmentStatuses(plan, profile, txns, monthKey(today), today) : [];
    const upcoming = upcomingPayments({ statuses, recurring: data.recurring, holds: data.holds, txns, today });
    return { plan, pool: poolSummary(plan), ledger, statuses, upcoming };
  }, [data, today]);
  return { data, derived, today, mode, db, loading: data === undefined };
}

export type BudgetView = NonNullable<ReturnType<typeof useBudget>["derived"]> & { data: AppData };
