/** Derived totals for the native widget. No SMS, merchant or account details. */
import { computeLedger, hasBudget, planForDate } from "./budget";
import { addDays, startOfMonth } from "./dates";
import type { BudgetPlan, DateKey, Profile, Transaction } from "./types";

export function widgetSnapshot(input: { profile: Profile; plans: BudgetPlan[]; txns: Transaction[]; today: DateKey }) {
  const { profile, plans, today } = input;
  const txns = input.txns.filter((t) => t.date <= today);
  // Forecast allowance only: Android can roll the date forward without reading SMS.
  // Forecast rows must never count as observed zero-spend days in the calendar.
  const ledger = computeLedger({ profile, plans, txns, today: addDays(today, 40) });
  return {
    version: 1,
    capturedDate: today,
    trackingStart: profile.trackingStart,
    rows: ledger.days.filter((d) => d.date >= startOfMonth(today)).map((d) => ({
      date: d.date,
      budget: hasBudget(planForDate(plans, d.date)),
      available: d.closingPaise,
      allocation: d.allocationPaise,
      dayBudget: Math.max(0, d.carriedInPaise + d.allocationPaise + d.adjustPaise),
      spent: d.spentPaise,
      under: d.underBudget,
    })),
  };
}
