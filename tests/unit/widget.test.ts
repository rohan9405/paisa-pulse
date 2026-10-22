import { describe, expect, it } from "vitest";
import { widgetSnapshot } from "@/lib/widget";
import { computeLedger } from "@/lib/budget";
import { commitment, plan, profile, txn } from "./helpers";
import type { Profile } from "@/lib/types";

const me = (start = "2026-10-01"): Profile => ({ ...profile(start), id: "me", onboardedAt: 0 });

describe("home widget snapshot", () => {
  it("uses the app ledger including carried money and spending, without copying private transaction details", () => {
    const input = { profile: me(), plans: [plan({ incomePaise: 31_000_00 })], txns: [txn({ date: "2026-10-22", amountPaise: 460_00, merchant: "Private Merchant", source: { providerId: "sms", importedAt: 0, raw: "Private bank SMS" } })], today: "2026-10-23" };
    const snapshot = widgetSnapshot(input);
    const ledger = computeLedger(input);
    const row = snapshot.rows.find((r) => r.date === input.today)!;
    expect(row.available).toBe(ledger.availablePaise);
    expect(row.dayBudget).toBe(ledger.todayRow.carriedInPaise + ledger.todayRow.allocationPaise);
    expect(JSON.stringify(snapshot)).not.toMatch(/Private|merchant|source|SMS/);
    expect(snapshot.capturedDate).toBe(input.today);
  });

  it("forecasts the next day and next month, but drops future-dated spending", () => {
    const snapshot = widgetSnapshot({ profile: me(), plans: [plan({ incomePaise: 31_000_00 })], txns: [txn({ date: "2026-11-01", amountPaise: 9_999_00 })], today: "2026-10-31" });
    expect(snapshot.rows.find((r) => r.date === "2026-11-01")).toMatchObject({ spent: 0, allocation: 103_334, available: 31_00_000 + 103_334 });
    expect(snapshot.rows.at(-1)?.date).toBe("2026-12-10");
  });

  it("keeps a deficit visible and doesn't turn the drop denominator negative", () => {
    const snapshot = widgetSnapshot({ profile: me(), plans: [plan({ incomePaise: 31_000_00 })], txns: [txn({ date: "2026-10-01", amountPaise: 5_000_00 })], today: "2026-10-02" });
    expect(snapshot.rows.find((r) => r.date === "2026-10-02")).toMatchObject({ available: -3_000_00, dayBudget: 0 });
  });

  it("supports tracking only and does not count planned bills as today's everyday spend", () => {
    const txns = [txn({ date: "2026-10-01", amountPaise: 20_000_00, category: "Bills", tag: "Rent", merchant: "Rent" })];
    const planned = widgetSnapshot({ profile: me(), plans: [plan({ incomePaise: 51_000_00, commitments: [commitment({ id: "rent", name: "Rent", amountPaise: 20_000_00, tag: "Rent" })] })], txns, today: "2026-10-01" });
    expect(planned.rows[0]).toMatchObject({ budget: true, spent: 0, available: 1_000_00 });
    const tracking = widgetSnapshot({ profile: me(), plans: [plan({ incomePaise: null })], txns, today: "2026-10-01" });
    expect(tracking.rows[0].budget).toBe(false);
  });

  it("includes actual-mode set-aside adjustments in today's budget and future allowances", () => {
    const input = { profile: me("2026-09-01"), plans: [plan({ incomePaise: 60_000_00, setAsideMode: "actual" })], txns: [txn({ date: "2026-09-11", amountPaise: 20_000_00, category: "Bills" })], today: "2026-09-11" };
    const snapshot = widgetSnapshot(input);
    expect(snapshot.rows.find((r) => r.date === "2026-09-11")).toMatchObject({ allocation: 1_000_00, spent: 0 });
    expect(snapshot.rows.find((r) => r.date === "2026-09-12")).toMatchObject({ allocation: 1_000_00 });
  });

  it("does not invent history before a mid-month tracking start", () => {
    const snapshot = widgetSnapshot({ profile: me("2026-10-23"), plans: [plan({ incomePaise: 31_000_00 })], txns: [], today: "2026-10-23" });
    expect(snapshot.rows[0]).toMatchObject({ date: "2026-10-23", available: 1_000_00 });
    expect(snapshot.rows.some((r) => r.date === "2026-10-22")).toBe(false);
  });
});
