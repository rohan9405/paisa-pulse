import { describe, expect, it } from "vitest";
import { computeLedger, hasBudget, outgoingsInRange } from "@/lib/budget";
import { eveningReport, level, morningBriefing, recoveryPlan } from "@/lib/insights";
import { monthCalendar, monthPace } from "@/lib/overview";
import { plan, profile, txn } from "./helpers";

const tracking = plan({ id: "track", effectiveFrom: "2026-09-01", incomePaise: null, budgetMode: "tracking", setAside: ["Subscriptions"] });
const actual = plan({ id: "actual", effectiveFrom: "2026-09-01", incomePaise: null, budgetMode: "set-aside", setAsideMode: "actual" });
const income = (date: string, amountPaise: number) => txn({ date, amountPaise, kind: "income", category: "Income" });

describe("tracking and mode changes", () => {
  it("has no balance, deficit, recovery, budget judgement or XP, even with an old opening adjustment", () => {
    const l = computeLedger({ plans: [tracking], profile: profile("2026-09-01", -900_00), txns: [txn({ date: "2026-09-01", amountPaise: 500_00 })], today: "2026-09-03" });
    expect(l.availablePaise).toBe(0);
    expect(l.days.every((d) => d.closingPaise === 0 && d.carriedInPaise === 0 && !d.underBudget)).toBe(true);
    expect(recoveryPlan(l, l.today)).toBeNull();
    expect(morningBriefing(l, [], [], l.today).recovery).toBeNull();
    expect(level(l).xp).toBe(0);
    expect(monthPace(l, l.today)).toMatchObject({ onTrack: null, projectedDeltaPaise: null });
  });

  it("ignores set-aside configuration for everyday reporting while keeping all transaction tags", () => {
    const txns = [txn({ date: "2026-09-01", amountPaise: 20_000_00, category: "Bills", tag: "Rent" }), txn({ date: "2026-09-01", amountPaise: 500_00, category: "Subscriptions" }), txn({ date: "2026-09-01", amountPaise: 5_000_00, category: "Investments", kind: "investment", tag: "SIP" })];
    const l = computeLedger({ plans: [tracking], profile: profile("2026-09-01"), txns, today: "2026-09-02" });
    expect(l.days[0].spentPaise).toBe(500_00);
    expect(l.days[0].everydayPaise).toBe(500_00);
    expect(outgoingsInRange(txns, "2026-09-01", l.today).totalPaise).toBe(25_500_00);
    expect(txns[0].tag).toBe("Rent");
  });

  it("does not call a bills-only tracking day a zero-spend day", () => {
    const txns = [txn({ date: "2026-09-01", amountPaise: 20_000_00, category: "Bills" })];
    const l = computeLedger({ plans: [tracking], profile: profile("2026-09-01"), txns, today: "2026-09-02" });
    expect(eveningReport(l, txns, [tracking], "2026-09-01")).toMatchObject({ noSpend: false, hasBudget: false, spentPaise: 20_000_00 });
    expect(monthCalendar(l, l.today).days[0].state).toBe("spent");
  });

  it.each(["planned", "actual"] as const)("starts %s budgeting fresh after tracking, excluding old spending, set-asides and income", (setAsideMode) => {
    const budget = plan({ id: "budget", effectiveFrom: "2026-09-16", budgetMode: "set-aside", setAsideMode, incomePaise: setAsideMode === "planned" ? 30_000_00 : null });
    const txns = [income("2026-09-01", 90_000_00), txn({ date: "2026-09-02", amountPaise: 5_000_00 }), txn({ date: "2026-09-03", amountPaise: 20_000_00, category: "Bills" }), income("2026-09-16", 15_000_00)];
    const l = computeLedger({ plans: [tracking, budget], profile: profile("2026-09-01", 999_00), txns, today: "2026-09-16" });
    expect(l.todayRow.carriedInPaise).toBe(0);
    expect(l.todayRow.allocationPaise).toBe(1_000_00);
    expect(l.availablePaise).toBe(1_000_00);
    expect(l.days[1].spentPaise).toBe(5_000_00);
    expect(monthCalendar(l, l.today).days[1].state).toBe("spent");
    expect(eveningReport(l, txns, [tracking, budget], "2026-09-02").hasBudget).toBe(false);
  });

  it("clears a previous deficit on entering tracking and does not resurrect it on returning to budget", () => {
    const first = plan({ id: "first", effectiveFrom: "2026-09-01", incomePaise: 30_000_00 });
    const middle = { ...tracking, effectiveFrom: "2026-09-03" };
    const last = plan({ id: "last", effectiveFrom: "2026-09-05", incomePaise: 30_000_00 });
    const txns = [txn({ date: "2026-09-01", amountPaise: 9_000_00 }), txn({ date: "2026-09-04", amountPaise: 5_000_00 })];
    const l = computeLedger({ plans: [first, middle, last], profile: profile("2026-09-01"), txns, today: "2026-09-05" });
    expect(l.days[1].closingPaise).toBe(-7_000_00);
    expect(l.days[2].closingPaise).toBe(0);
    expect(l.availablePaise).toBe(1_000_00);
    expect(l.streak).toBe(0);
    expect(monthCalendar(l, l.today).days[0].state).toBe("over");
  });
});

describe("actual set-aside uses actual transactions", () => {
  it("is a budget without entered income; tracking remains distinct even if a legacy plan has income", () => {
    expect(hasBudget(actual)).toBe(true);
    expect(hasBudget({ ...actual, budgetMode: "tracking", incomePaise: 60_000_00 })).toBe(false);
    expect(hasBudget(plan({ incomePaise: null, setAsideMode: "actual" }))).toBe(false);
  });

  it("waits for received income, ignores transfers/refunds/future income and never uses the saved income estimate", () => {
    const txns = [income("2026-09-11", 20_000_00), txn({ date: "2026-09-01", amountPaise: 20_000_00, kind: "transfer" }), txn({ date: "2026-09-01", amountPaise: 20_000_00, kind: "refund" })];
    const plans = [{ ...actual, incomePaise: 60_000_00 }];
    const before = computeLedger({ plans, profile: profile("2026-09-01", 999_00), txns, today: "2026-09-10" });
    expect(before.totalAllocatedPaise).toBe(0);
    expect(before.availablePaise).toBe(0);
    const after = computeLedger({ plans, profile: profile("2026-09-01"), txns, today: "2026-09-11" });
    expect(after.todayRow.allocationPaise).toBe(1_000_00);
    expect(after.days[9].allocationPaise).toBe(0);
  });

  it("reconciles delayed income and set-aside shortfalls exactly once", () => {
    const txns = [txn({ date: "2026-09-01", amountPaise: 5_000_00, category: "Bills" }), income("2026-09-15", 20_000_00), income("2026-09-28", 5_000_00)];
    const l = computeLedger({ plans: [actual], profile: profile("2026-09-01"), txns, today: "2026-09-30" });
    expect(l.days[0].adjustPaise).toBe(-5_000_00);
    expect(l.availablePaise).toBe(20_000_00);
    expect(l.totalAllocatedPaise + l.days.reduce((n, d) => n + d.adjustPaise, 0)).toBe(20_000_00);
    expect(monthPace(l, l.today).projectedDeltaPaise).toBeNull();
  });
});
