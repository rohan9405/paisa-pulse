"use client";

import { useMemo } from "react";
import { commitmentStatuses, computeLedger, hasBudget, modeOf, planForDate, poolSummary } from "@/lib/budget";
import { monthKey } from "@/lib/dates";
import { upcomingPayments } from "@/lib/recurring";
import { type AppData, useAppData, useStore } from "./store";

/** Everything the screens need, derived from the live database snapshot. */
export function useBudget() {
  const data = useAppData();
  const { today, mode, db } = useStore();
  const derived = useMemo(() => {
    if (!data || !data.profile) return null;
    const { profile, plans, txns } = data;
    const plan = planForDate(plans, today) ?? plans[0] ?? null;
    const ledger = computeLedger({ plans, profile, txns, today });
    // Planned lines are budget inputs only in planned mode; otherwise reminders come from autopay SMS alone.
    const statuses = hasBudget(plan) && modeOf(plan) === "planned" ? commitmentStatuses(plan, profile, txns, monthKey(today), today) : [];
    const upcoming = upcomingPayments({ statuses, recurring: data.recurring, txns, today });
    return { plan, pool: poolSummary(plan), ledger, statuses, upcoming };
  }, [data, today]);
  return { data, derived, today, mode, db, loading: data === undefined };
}

export type BudgetView = NonNullable<ReturnType<typeof useBudget>["derived"]> & { data: AppData };
