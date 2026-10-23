import { describe, expect, it } from "vitest";
import type { DayRow, Ledger } from "@/lib/budget";
import { addDays } from "@/lib/dates";
import { monthCalendar, monthPace, usualDailySpend, weekDays, weeklyInsight } from "@/lib/overview";
import { plan, txn } from "./helpers";

function ledger(rows: [string, number, number][], today: string, hasBudget = true): Ledger {
  const days: DayRow[] = rows.map(([date, alloc, spent]) => ({ date, hasBudget, everydayPaise: spent, allocationPaise: alloc, spentPaise: spent, adjustPaise: 0, setAsidePaise: 0, carriedInPaise: 0, closingPaise: alloc - spent, underBudget: spent <= alloc }));
  return { started: true, hasBudget, mode: "planned", today, days, todayRow: days[days.length - 1], availablePaise: 0, totalAllocatedPaise: 0, totalSpentPaise: 0, streak: 0, nextAllocationPaise: 0 };
}

describe("month pace", () => {
  it("projects month end from the completed days' pace", () => {
    // 1–4 Oct: ₹1,000/day allowance, ₹800/day spent; today (5th) ₹200 so far.
    const l = ledger([["2026-10-01", 1000_00, 800_00], ["2026-10-02", 1000_00, 800_00], ["2026-10-03", 1000_00, 800_00], ["2026-10-04", 1000_00, 800_00], ["2026-10-05", 1000_00, 200_00]], "2026-10-05");
    const p = monthPace(l, "2026-10-05");
    expect(p).toMatchObject({ spentPaise: 3_400_00, allocatedPaise: 5_000_00, dayOfMonth: 5, daysInMonth: 31, onTrack: true });
    // spend: 3,400 + 800×26 = 24,200; allowance: 5,000 + 1,000×26 = 31,000 → ₹6,800 under
    expect(p.projectedDeltaPaise).toBe(6_800_00);
  });

  it("doesn't project with fewer than 3 completed days, or without a budget", () => {
    expect(monthPace(ledger([["2026-10-01", 1000_00, 0], ["2026-10-02", 1000_00, 0]], "2026-10-02"), "2026-10-02").projectedDeltaPaise).toBeNull();
    const rows: [string, number, number][] = [["2026-10-01", 0, 500_00], ["2026-10-02", 0, 500_00], ["2026-10-03", 0, 500_00], ["2026-10-04", 0, 0]];
    expect(monthPace(ledger(rows, "2026-10-04", false), "2026-10-04").projectedDeltaPaise).toBeNull();
  });
});

describe("usual daily spend", () => {
  it("averages completed tracked days only", () => {
    const l = ledger([["2026-10-01", 0, 300_00], ["2026-10-02", 0, 100_00], ["2026-10-03", 0, 999_00]], "2026-10-03");
    expect(usualDailySpend(l, "2026-10-03")).toBe(200_00);
  });
});

describe("week and calendar", () => {
  it("lists Monday to Sunday, marking future and untracked days", () => {
    const l = ledger([["2026-10-21", 1000_00, 500_00], ["2026-10-22", 1000_00, 100_00]], "2026-10-22"); // Wed, Thu
    const w = weekDays(l, "2026-10-22");
    expect(w.map((d) => d.date)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(w[0].untracked).toBe(true);
    expect(w[2]).toMatchObject({ spentPaise: 500_00, future: false, untracked: false });
    expect(w[4].future).toBe(true);
  });

  it("colours each day of the month and starts rows on Monday", () => {
    const l = ledger([["2026-10-01", 1000_00, 1200_00], ["2026-10-02", 1000_00, 0], ["2026-10-03", 1000_00, 300_00], ["2026-10-04", 1000_00, 50_00]], "2026-10-04");
    const c = monthCalendar(l, "2026-10-04");
    expect(c.blanks).toBe(3); // 1 Oct 2026 is a Thursday
    expect(c.days).toHaveLength(31);
    expect(c.days.slice(0, 5).map((d) => d.state)).toEqual(["over", "nospend", "under", "today", "future"]);
  });
});

describe("weekly insight", () => {
  const plans = [plan({ incomePaise: null, commitments: [] })];
  const spend = (date: string, rupees: number, category: string) => txn({ date, amountPaise: rupees * 100, category, kind: "expense" });

  it("flags the category that rose most against the previous 4 weeks", () => {
    // One of each per week in the 4 weeks before (8 Sep–15 Oct window): usual Food ₹1,000/week.
    const before = [0, 7, 14, 21].flatMap((w) => [spend(addDays("2026-10-15", -w), 1000, "Food & Dining"), spend(addDays("2026-10-14", -w), 500, "Transport")]);
    const week = [spend("2026-10-20", 900, "Food & Dining"), spend("2026-10-21", 800, "Food & Dining"), spend("2026-10-21", 500, "Transport")];
    expect(weeklyInsight([...before, ...week], plans, "2026-10-22")).toEqual({ text: "Food & Dining is 70% above your usual this week", tone: "warn" });
  });

  it("says so when the whole week is well below usual, and stays quiet without history", () => {
    const before = [0, 7, 14, 21].map((w) => spend(addDays("2026-10-15", -w), 2000, "Shopping"));
    expect(weeklyInsight([...before, spend("2026-10-21", 500, "Shopping")], plans, "2026-10-22")).toEqual({ text: "This week's spending is 75% below your usual", tone: "good" });
    expect(weeklyInsight([spend("2026-10-21", 500, "Shopping")], plans, "2026-10-22")).toBeNull();
  });
});
