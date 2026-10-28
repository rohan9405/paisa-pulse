import { describe, expect, it } from "vitest";
import { calendarSlots, dailyAnalytics } from "@/lib/dailyAnalytics";
import { txn } from "./helpers";

const rows = [
  txn({ id: "rent", date: "2026-10-01", category: "Bills", amountPaise: 2000000 }),
  txn({ id: "food", date: "2026-10-20", category: "Food & Dining", amountPaise: 50000 }),
  txn({ id: "future", date: "2026-10-24", category: "Food & Dining", amountPaise: 90000 }),
  txn({ id: "refund", date: "2026-10-23", category: "Refunds", kind: "refund", refundOf: "food", amountPaise: 10000 }),
  txn({ id: "invest", date: "2026-10-20", category: "Investments", kind: "investment", amountPaise: 800000 }),
  txn({ id: "own", date: "2026-10-20", category: "Transfers", kind: "transfer", amountPaise: 600000 }),
  txn({ id: "salary", date: "2026-10-20", category: "Income", kind: "income", tag: "Salary", amountPaise: 5000000 }),
  txn({ id: "future-income", date: "2026-10-25", category: "Income", kind: "income", amountPaise: 1000000 }),
  txn({ id: "previous", date: "2026-09-20", category: "Shopping", amountPaise: 30000 }),
];

describe("unified daily snapshots", () => {
  it("uses the saved spending scope for totals, categories, trends and payment lists without affecting income", () => {
    const without=dailyAnalytics(rows,"2026-09-01","2026-10-20","spent",false);
    const withInvestments=dailyAnalytics(rows,"2026-09-01","2026-10-20","spent",true);
    expect(without.dayPaise).toBe(50000);
    expect(withInvestments.dayPaise).toBe(850000);
    expect(without.dayEntries.map(t=>t.id)).toEqual(["food"]);
    expect(withInvestments.dayEntries.map(t=>t.id)).toEqual(["food","invest"]);
    expect(without.breakdown.some(c=>c.label==="Investments")).toBe(false);
    expect(withInvestments.trend7.at(-1)?.amountPaise).toBe(850000);
    expect(without.trend7.at(-1)?.amountPaise).toBe(50000);
    expect(dailyAnalytics(rows,"2026-09-01","2026-10-20","income",false)).toEqual(dailyAnalytics(rows,"2026-09-01","2026-10-20","income",true));
  });
  it("includes investment refunds only when known, and excludes savings and pending payments", () => {
    const date = "2026-10-20";
    const payments = [txn({id:"investment",date,amountPaise:3000000,kind:"investment",category:"Investments"}),txn({date,amountPaise:200000,category:"Savings"}),txn({date,amountPaise:500000,kind:"investment",category:"Investments",accountingPending:true}),txn({date:"2026-10-21",amountPaise:100000,kind:"refund",refundOf:"investment"})];
    const current=dailyAnalytics(payments,date,date,"spent");
    expect(current.dayPaise).toBe(3000000);expect(current.dayEntries.map(t=>t.id)).toEqual(["investment"]);
    expect(current.trend7.at(-1)?.amountPaise).toBe(3000000);
    expect(dailyAnalytics(payments,date,"2026-10-21","spent").monthPaise).toBe(2900000);
  });
  it("includes bills and investments, excludes transfers and uses only refunds known by the selected date", () => {
    const early = dailyAnalytics(rows, "2026-09-01", "2026-10-20", "spent");
    expect(early.dayPaise).toBe(850000); expect(early.monthPaise).toBe(2850000);
    expect(early.lastMonthPaise).toBe(30000);
    expect(early.breakdown).toEqual([{ label: "Investments", amountPaise: 800000 }, { label: "Food & Dining", amountPaise: 50000 }]);
    const after = dailyAnalytics(rows, "2026-09-01", "2026-10-23", "spent");
    expect(after.monthPaise).toBe(2840000);
    expect(after.weekPaise).toBe(840000);
    expect(after.week.find((d) => d.date === "2026-10-24")).toMatchObject({ amountPaise: 0, future: true });
  });
  it("reports actual income with the same periods, excluding refunds, transfers and later credits", () => {
    const income = dailyAnalytics(rows, "2026-09-01", "2026-10-20", "income");
    expect(income.dayPaise).toBe(5000000); expect(income.weekPaise).toBe(5000000); expect(income.monthPaise).toBe(5000000);
    expect(income.breakdown).toEqual([{ label: "Salary", amountPaise: 5000000 }]);
    expect(dailyAnalytics(rows, "2026-09-01", "2026-10-19", "income").monthPaise).toBe(0);
  });
  it("averages completed tracked days including zero days and does not invent a comparison", () => {
    expect(dailyAnalytics(rows, "2026-10-20", "2026-10-20", "spent").usualPaise).toBeNull();
    const s = dailyAnalytics(rows, "2026-10-19", "2026-10-21", "spent");
    expect(s.usualPaise).toBe(425000); expect(s.lastMonthPaise).toBeNull();
    const feb = dailyAnalytics([], "2025-01-01", "2026-03-31", "spent");
    expect(feb.lastMonthTo).toBe("2026-02-28"); expect(feb.lastMonthPaise).toBe(0);
  });
  it("compares the same weekdays of last week and requires full tracked coverage", () => {
    const payments = [txn({ date: "2026-10-12", amountPaise: 10000 }), txn({ date: "2026-10-13", amountPaise: 20000 }), txn({ date: "2026-10-14", amountPaise: 90000 })];
    const snapshot = dailyAnalytics(payments, "2026-10-01", "2026-10-20", "spent");
    expect(snapshot.lastWeekTo).toBe("2026-10-13");
    expect(snapshot.lastWeekPaise).toBe(30000);
    expect(dailyAnalytics(payments, "2026-10-13", "2026-10-20", "spent").lastWeekPaise).toBeNull();
  });
  it("uses complete previous calendar periods for daily averages, including zero days", () => {
    const payments = [txn({ date: "2026-09-01", amountPaise: 300000 }), txn({ date: "2026-10-12", amountPaise: 10000 }), txn({ date: "2026-10-18", amountPaise: 60000 }), txn({ date: "2026-10-20", amountPaise: 90000 })];
    const snapshot = dailyAnalytics(payments, "2026-09-01", "2026-10-20", "spent");
    expect(snapshot.lastMonthDailyAvgPaise).toBe(10000);
    expect(snapshot.lastWeekDailyAvgPaise).toBe(10000);
    expect(dailyAnalytics(payments, "2026-09-02", "2026-10-20", "spent").lastMonthDailyAvgPaise).toBeNull();
    expect(dailyAnalytics(payments, "2026-10-13", "2026-10-20", "spent").lastWeekDailyAvgPaise).toBeNull();
    expect(dailyAnalytics([], "2026-09-01", "2026-10-20", "spent").lastMonthDailyAvgPaise).toBe(0);
    expect(dailyAnalytics([txn({ date: "2024-02-02", amountPaise: 290000 })], "2024-02-01", "2024-03-01", "spent").lastMonthDailyAvgPaise).toBe(10000);
  });
  it("uses rolling windows across weeks and months without the partial day in the 28-day baseline", () => {
    const payments = [txn({ date: "2026-09-04", amountPaise: 999999 }), txn({ date: "2026-09-05", amountPaise: 280000 }), txn({ date: "2026-09-27", amountPaise: 70000 }), txn({ date: "2026-10-03", amountPaise: 140000 }), txn({ date: "2026-10-04", amountPaise: 999999 })];
    const s = dailyAnalytics(payments, "2026-09-01", "2026-10-03", "spent");
    expect(s.rolling28DailyAvgPaise).toBe(12500);
    expect(s.trend7.map(d => d.date)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(s.rolling7DailyAvgPaise).toBe(30000);
    const short = dailyAnalytics(payments, "2026-10-01", "2026-10-03", "spent");
    expect(short.rolling28DailyAvgPaise).toBeNull(); expect(short.rolling7DailyAvgPaise).toBeNull();
  });
  it("uses only occupied calendar weeks, including leap years and six-row months", () => {
    for (const [month, count] of [["2027-02", 28], ["2024-02", 35], ["2026-10", 35], ["2026-11", 42]] as const) {
      const slots = calendarSlots(month);
      expect(slots).toHaveLength(count);
      expect(slots.slice(-7).some(Boolean)).toBe(true);
    }
    expect(calendarSlots("2024-02").filter(Boolean)).toHaveLength(29);
  });
});
