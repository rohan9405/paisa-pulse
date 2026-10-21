import { describe, expect, it } from "vitest";
import {
  allocationForDay,
  categoryBreakdown,
  commitmentStatuses,
  computeLedger,
  dailyAllocation,
  manualPaidKey,
  outgoingsInRange,
  poolSummary,
} from "@/lib/budget";
import { daysInMonth, eachDay, endOfMonth, isLeapYear, startOfMonth } from "@/lib/dates";
import { commitment, plan, profile, txn } from "./helpers";

const sumAlloc = (pool: number, month: string) =>
  eachDay(startOfMonth(`${month}-01`), endOfMonth(`${month}-01`)).reduce((s, d) => s + dailyAllocation(pool, d), 0);

describe("pool", () => {
  it("income minus bills and savings", () => {
    const s = poolSummary(
      plan({ incomePaise: 80_000_00, commitments: [commitment({ id: "rent", amountPaise: 25_000_00 }), commitment({ id: "sip", kind: "savings", amountPaise: 10_000_00 })] }),
    );
    expect(s.billsPaise).toBe(25_000_00);
    expect(s.savingsPaise).toBe(10_000_00);
    expect(s.poolPaise).toBe(45_000_00);
    expect(s.shortfallPaise).toBe(0);
  });

  it("commitments exceeding income: no crash, zero allocation, shortfall reported", () => {
    const p = plan({ incomePaise: 20_000_00, commitments: [commitment({ id: "rent", amountPaise: 30_000_00 })] });
    const s = poolSummary(p);
    expect(s.poolPaise).toBe(-10_000_00);
    expect(s.allocatablePaise).toBe(0);
    expect(s.shortfallPaise).toBe(10_000_00);
    const l = computeLedger({ plans: [p], profile: profile("2026-10-01"), txns: [txn({ date: "2026-10-02", amountPaise: 500_00 })], today: "2026-10-03" });
    expect(l.totalAllocatedPaise).toBe(0);
    expect(l.availablePaise).toBe(-500_00);
  });

  it("no income → tracking-only mode", () => {
    const s = poolSummary(plan({ incomePaise: null }));
    expect(s.hasBudget).toBe(false);
    expect(s.allocatablePaise).toBe(0);
  });
});

describe("rounding", () => {
  it.each([
    [45_000_00, "2026-10"],
    [45_000_01, "2026-10"],
    [1, "2026-10"],
    [29, "2026-02"],
    [99_999_99, "2026-04"],
    [12_345_67, "2024-02"],
    [12_345_67, "2026-02"],
  ])("daily allocations of %i in %s sum exactly to the pool", (pool, month) => {
    expect(sumAlloc(pool, month)).toBe(pool);
  });

  it("leftover paise go to the first days, deterministically", () => {
    // 100 paise over 30 days: base 3, remainder 10 → days 1-10 get 4
    expect(dailyAllocation(100, "2026-09-01")).toBe(4);
    expect(dailyAllocation(100, "2026-09-10")).toBe(4);
    expect(dailyAllocation(100, "2026-09-11")).toBe(3);
    expect(dailyAllocation(100, "2026-09-30")).toBe(3);
  });

  it("divides by calendar days in the month, not days remaining", () => {
    const p = plan({ incomePaise: 31_000_00 });
    expect(allocationForDay([p], "2026-10-01")).toBe(1_000_00);
    expect(allocationForDay([p], "2026-10-31")).toBe(1_000_00);
  });
});

describe("leap years and month changes", () => {
  it("leap year rules", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it("Feb 2024 splits over 29 days; Feb 2026 over 28", () => {
    const p = plan({ incomePaise: 29_000_00 * 28 });
    expect(allocationForDay([p], "2024-02-10")).toBe(28_000_00);
    expect(sumAlloc(29_000_00 * 28, "2024-02")).toBe(29_000_00 * 28);
    expect(allocationForDay([p], "2026-02-10")).toBe(29_000_00);
  });

  it("allocation follows each month's own day count across a boundary", () => {
    const p = plan({ incomePaise: 30_000_00 });
    const l = computeLedger({ plans: [p], profile: profile("2026-01-30"), txns: [], today: "2026-02-02" });
    // Jan: 30000/31 ≈ 967.74; Feb: 30000/28 ≈ 1071.43
    expect(l.days.map((d) => d.allocationPaise)).toEqual([
      dailyAllocation(30_000_00, "2026-01-30"),
      dailyAllocation(30_000_00, "2026-01-31"),
      dailyAllocation(30_000_00, "2026-02-01"),
      dailyAllocation(30_000_00, "2026-02-02"),
    ]);
    expect(l.days[0].allocationPaise).toBe(96_774);
    expect(l.days[2].allocationPaise).toBe(1_07_143);
  });

  it("budget change effective mid-month applies from that date only", () => {
    const old = plan({ id: "a", incomePaise: 31_000_00, effectiveFrom: "2026-10-01" });
    const next = plan({ id: "b", incomePaise: 62_000_00, effectiveFrom: "2026-10-16", createdAt: 1 });
    const l = computeLedger({ plans: [old, next], profile: profile("2026-10-01"), txns: [], today: "2026-10-31" });
    expect(l.totalAllocatedPaise).toBe(15 * 1_000_00 + 16 * 2_000_00);
  });
});

describe("accrual, carry-forward, deficits", () => {
  const p = plan({ incomePaise: 30_000_00 }); // Sep: ₹1000/day
  it("unspent money carries forward", () => {
    const l = computeLedger({ plans: [p], profile: profile("2026-09-01"), txns: [txn({ date: "2026-09-01", amountPaise: 400_00 })], today: "2026-09-03" });
    expect(l.availablePaise).toBe(3 * 1_000_00 - 400_00);
    expect(l.todayRow.carriedInPaise).toBe(2 * 1_000_00 - 400_00);
  });

  it("overspending creates a deficit, never extra money", () => {
    const l = computeLedger({ plans: [p], profile: profile("2026-09-01"), txns: [txn({ date: "2026-09-01", amountPaise: 5_000_00 })], today: "2026-09-02" });
    expect(l.availablePaise).toBe(2_000_00 - 5_000_00);
    expect(l.days[0].closingPaise).toBe(-4_000_00);
    expect(l.days[0].underBudget).toBe(false);
  });

  it("mid-month start: accrues only from the tracking date, ignores earlier spend", () => {
    const l = computeLedger({
      plans: [p],
      profile: profile("2026-09-15"),
      txns: [txn({ date: "2026-09-10", amountPaise: 9_999_00 }), txn({ date: "2026-09-15", amountPaise: 200_00 })],
      today: "2026-09-16",
    });
    expect(l.days).toHaveLength(2);
    expect(l.totalAllocatedPaise).toBe(2_000_00);
    expect(l.availablePaise).toBe(1_800_00);
  });

  it("opening adjustment is explicit (default 0) and added once", () => {
    const zero = computeLedger({ plans: [p], profile: profile("2026-09-15"), txns: [], today: "2026-09-15" });
    expect(zero.availablePaise).toBe(1_000_00);
    const adj = computeLedger({ plans: [p], profile: profile("2026-09-15", 2_500_00), txns: [], today: "2026-09-17" });
    expect(adj.availablePaise).toBe(3_000_00 + 2_500_00);
  });

  it("before tracking starts nothing accrues", () => {
    const l = computeLedger({ plans: [p], profile: profile("2026-09-20"), txns: [], today: "2026-09-19" });
    expect(l.started).toBe(false);
    expect(l.availablePaise).toBe(0);
  });

  it("future-dated transactions don't count yet", () => {
    const l = computeLedger({ plans: [p], profile: profile("2026-09-01"), txns: [txn({ date: "2026-09-05", amountPaise: 100_00 })], today: "2026-09-02" });
    expect(l.totalSpentPaise).toBe(0);
  });

  it("streak counts completed under-budget days", () => {
    const l = computeLedger({
      plans: [p],
      profile: profile("2026-09-01"),
      txns: [txn({ date: "2026-09-01", amountPaise: 2_000_00 }), txn({ date: "2026-09-02", amountPaise: 10_00 }), txn({ date: "2026-09-04", amountPaise: 9_000_00 })],
      today: "2026-09-04",
    });
    expect(l.streak).toBe(2); // 2nd, 3rd (today excluded, 1st over)
  });
});

describe("commitments / bill matching", () => {
  const rent = commitment({ id: "rent", name: "Rent", amountPaise: 20_000_00, dueDay: 1 });
  const sip = commitment({ id: "sip", name: "SIP", kind: "savings", amountPaise: 5_000_00, dueDay: 10 });
  const p = plan({ incomePaise: 55_000_00, commitments: [rent, sip] }); // pool 30k → Sep ₹1000/day

  it("matched bill payments are in outgoings but not deducted from the pool twice", () => {
    const txns = [txn({ date: "2026-09-01", amountPaise: 20_000_00, kind: "commitment", commitmentId: "rent" }), txn({ date: "2026-09-01", amountPaise: 300_00 })];
    const l = computeLedger({ plans: [p], profile: profile("2026-09-01"), txns, today: "2026-09-01" });
    expect(l.availablePaise).toBe(1_000_00 - 300_00);
    const o = outgoingsInRange(txns, [p], "2026-09-01", "2026-09-30");
    expect(o.commitmentsPaise).toBe(20_000_00);
    expect(o.discretionaryPaise).toBe(300_00);
    expect(o.totalPaise).toBe(20_300_00);
  });

  it("paying more than reserved: only the excess hits discretionary, counted once in outgoings", () => {
    const txns = [txn({ date: "2026-09-02", amountPaise: 21_000_00, kind: "commitment", commitmentId: "rent" })];
    const l = computeLedger({ plans: [p], profile: profile("2026-09-01"), txns, today: "2026-09-02" });
    expect(l.totalSpentPaise).toBe(1_000_00);
    const o = outgoingsInRange(txns, [p], "2026-09-01", "2026-09-30");
    expect(o.totalPaise).toBe(21_000_00);
    expect(o.discretionaryPaise).toBe(1_000_00);
    expect(o.commitmentsPaise).toBe(20_000_00);
  });

  it("split payments across the month accumulate before overage", () => {
    const txns = [
      txn({ date: "2026-09-02", amountPaise: 12_000_00, kind: "commitment", commitmentId: "rent" }),
      txn({ date: "2026-09-03", amountPaise: 9_000_00, kind: "commitment", commitmentId: "rent" }),
    ];
    const l = computeLedger({ plans: [p], profile: profile("2026-09-01"), txns, today: "2026-09-03" });
    expect(l.days.map((d) => d.spentPaise)).toEqual([0, 0, 1_000_00]);
  });

  it("statuses: paid, partial, overdue, upcoming, manual paid", () => {
    const txns = [txn({ date: "2026-09-01", amountPaise: 10_000_00, kind: "commitment", commitmentId: "rent" })];
    let st = commitmentStatuses(p, { manuallyPaid: [] }, txns, "2026-09", "2026-09-05");
    expect(st.find((s) => s.commitment.id === "rent")!.state).toBe("partial");
    expect(st.find((s) => s.commitment.id === "sip")!.state).toBe("upcoming");
    st = commitmentStatuses(p, { manuallyPaid: [] }, [], "2026-09", "2026-09-11");
    expect(st.find((s) => s.commitment.id === "sip")!.state).toBe("overdue");
    st = commitmentStatuses(p, { manuallyPaid: [manualPaidKey("sip", "2026-09")] }, [], "2026-09", "2026-09-11");
    expect(st.find((s) => s.commitment.id === "sip")!.state).toBe("paid");
  });

  it("due day 31 clamps to short months", () => {
    const p2 = plan({ incomePaise: 1, commitments: [commitment({ id: "x", amountPaise: 1, dueDay: 31 })] });
    expect(commitmentStatuses(p2, { manuallyPaid: [] }, [], "2026-02", "2026-02-01")[0].dueDate).toBe("2026-02-28");
  });
});

describe("transfers, investments, refunds", () => {
  const p = plan({ incomePaise: 30_000_00 });

  it("transfers between own accounts are excluded entirely", () => {
    const txns = [txn({ date: "2026-09-01", amountPaise: 50_000_00, kind: "transfer" })];
    const l = computeLedger({ plans: [p], profile: profile("2026-09-01"), txns, today: "2026-09-01" });
    expect(l.totalSpentPaise).toBe(0);
    const o = outgoingsInRange(txns, [p], "2026-09-01", "2026-09-30");
    expect(o.totalPaise).toBe(0);
    expect(o.transfersExcludedPaise).toBe(50_000_00);
  });

  it("investments are outgoings but not expenses", () => {
    const txns = [txn({ date: "2026-09-01", amountPaise: 5_000_00, kind: "investment", category: "Investments" })];
    const l = computeLedger({ plans: [p], profile: profile("2026-09-01"), txns, today: "2026-09-01" });
    expect(l.totalSpentPaise).toBe(0);
    expect(outgoingsInRange(txns, [p], "2026-09-01", "2026-09-30").investmentsPaise).toBe(5_000_00);
    expect(categoryBreakdown(txns, [p], "2026-09-01", "2026-09-30")).toEqual([]);
  });

  it("linked refund nets against the original expense on its date", () => {
    const e = txn({ id: "e1", date: "2026-09-01", amountPaise: 2_000_00, category: "Shopping" });
    const r = txn({ date: "2026-09-03", amountPaise: 500_00, kind: "refund", refundOf: "e1" });
    const l = computeLedger({ plans: [p], profile: profile("2026-09-01"), txns: [e, r], today: "2026-09-03" });
    expect(l.days[0].spentPaise).toBe(1_500_00);
    expect(l.availablePaise).toBe(3_000_00 - 1_500_00);
    expect(categoryBreakdown([e, r], [p], "2026-09-01", "2026-09-30")[0].amountPaise).toBe(1_500_00);
  });

  it("refund larger than the expense is capped — it can't create money", () => {
    const e = txn({ id: "e2", date: "2026-09-01", amountPaise: 300_00 });
    const r = txn({ date: "2026-09-02", amountPaise: 900_00, kind: "refund", refundOf: "e2" });
    const l = computeLedger({ plans: [p], profile: profile("2026-09-01"), txns: [e, r], today: "2026-09-02" });
    expect(l.totalSpentPaise).toBe(0);
    expect(l.availablePaise).toBe(2_000_00);
  });

  it("unmatched refunds don't change the balance", () => {
    const r = txn({ date: "2026-09-02", amountPaise: 900_00, kind: "refund", needsReview: true });
    const l = computeLedger({ plans: [p], profile: profile("2026-09-01"), txns: [r], today: "2026-09-02" });
    expect(l.availablePaise).toBe(2_000_00);
  });

  it("refund of an expense from before tracking began doesn't credit the budget", () => {
    const e = txn({ id: "e3", date: "2026-08-20", amountPaise: 1_000_00 });
    const r = txn({ date: "2026-09-02", amountPaise: 1_000_00, kind: "refund", refundOf: "e3" });
    const l = computeLedger({ plans: [p], profile: profile("2026-09-01"), txns: [e, r], today: "2026-09-02" });
    expect(l.availablePaise).toBe(2_000_00);
  });
});
