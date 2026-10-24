import { afterEach, describe, expect, it } from "vitest";
import { computeLedger, previousMonthCumulative } from "@/lib/budget";
import { DEFAULT_CONFIG, parseRemoteConfig, setConfig } from "@/lib/remoteConfig";
import { isIpoMandate } from "@/lib/ipo";
import { upcomingPayments } from "@/lib/recurring";
import type { FundHold, Recurring } from "@/lib/types";
import { plan, profile, txn } from "./helpers";
afterEach(() => setConfig(DEFAULT_CONFIG));

it("compares matching day numbers and holds the shorter prior month's final cumulative value", () => {
  const ledger = computeLedger({ plans: [plan({ incomePaise: null, budgetMode: "tracking" })], profile: profile("2026-02-01"), txns: [txn({ date: "2026-02-01", amountPaise: 10000 }), txn({ date: "2026-02-28", amountPaise: 30000 }), txn({ date: "2026-03-01", amountPaise: 90000 })], today: "2026-03-31" });
  expect(previousMonthCumulative(ledger, ["2026-03-01", "2026-03-27", "2026-03-28", "2026-03-31"], "2026-02-01")).toEqual([10000, 10000, 40000, 40000]);
  expect(previousMonthCumulative(ledger, ["2026-03-01"], "2026-02-02")).toEqual([null]);
});

describe("budget mode availability", () => {
  it("accepts one or both choices and defaults invalid or missing selections to both", () => {
    for (const setAsideModes of [["actual"], ["planned"], ["planned", "actual"]]) expect(parseRemoteConfig({ budget: { setAsideModes } }).config.budget.setAsideModes).toEqual(setAsideModes);
    for (const setAsideModes of [[], ["invalid"], null]) expect(parseRemoteConfig({ budget: { setAsideModes } }).config.budget.setAsideModes).toEqual(["planned", "actual"]);
  });
  it("changing offered modes does not alter existing plan calculations", () => {
    const input = { plans: [plan({ incomePaise: 100000, setAsideMode: "planned" })], profile: profile("2026-10-01"), txns: [], today: "2026-10-24" };
    const before = computeLedger(input);
    setConfig(parseRemoteConfig({ budget: { setAsideModes: ["actual"] } }).config);
    expect(computeLedger(input)).toEqual(before);
  });
});

it("IPO classifications and confirmed hold references exclude reminders, with explicit user overrides", () => {
  const r: Recurring = { id: "r", name: "Application", amountPaise: 1500000, source: "mandate", status: "active", frequency: "monthly", dueDay: 25, startDate: "2026-10-25", category: "Bills", mandateRef: "IPO123", bank: "HDFC", createdAt: 0, updatedAt: 0 };
  const holds = [{ reference: "ipo123", bank: "HDFC" }] as FundHold[];
  expect(isIpoMandate(r, holds)).toBe(true);
  expect(isIpoMandate({ ...r, purpose: "payment" }, holds)).toBe(false);
  expect(isIpoMandate({ ...r, purpose: "ipo" })).toBe(true);
  expect(upcomingPayments({ statuses: [], recurring: [r], holds, txns: [], today: "2026-10-24" })).toEqual([]);
  expect(upcomingPayments({ statuses: [], recurring: [{ ...r, purpose: "ipo" }], txns: [], today: "2026-10-24" })).toEqual([]);
  expect(upcomingPayments({ statuses: [], recurring: [{ ...r, purpose: "payment" }], holds, txns: [], today: "2026-10-24" })).toHaveLength(1);
});
