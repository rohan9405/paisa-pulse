import { describe, expect, it } from "vitest";
import { spendHeatmap } from "@/lib/spendHeatmap";
import { startOfWeek } from "@/lib/dates";
import { txn } from "./helpers";

describe("monthly spending heatmap", () => {
  it("lays out twelve labelled months in whole Monday-first weeks, including leap day", () => {
    const h = spendHeatmap([], "2020-01-01", "2024-02-29");
    expect(h.from).toBe("2023-03-01"); expect(h.to).toBe("2024-02-29");
    expect(h.days[0].date).toBe(startOfWeek(h.from));
    expect(h.days.length % 7).toBe(0); expect(h.months).toHaveLength(12);
    expect(h.days.find(d => d.date === "2024-02-29")?.state).toBe("tracked");
  });
  it("includes bills and linked refunds but excludes retained money, income and own transfers", () => {
    const rows = [txn({ id: "bill", date: "2026-10-10", category: "Bills", amountPaise: 10000 }), txn({ id: "refund", date: "2026-10-12", kind: "refund", refundOf: "bill", amountPaise: 2000 }), ...(["investment", "saving", "transfer", "income"] as const).map((kind, i) => txn({ id: String(i), date: "2026-10-10", kind: kind === "saving" ? "expense" : kind, category: kind === "investment" ? "Investments" : kind === "saving" ? "Savings" : kind === "income" ? "Income" : "Transfers", amountPaise: 50000 }))];
    expect(spendHeatmap(rows, "2026-01-01", "2026-10-24").days.find(d => d.date === "2026-10-10")?.amountPaise).toBe(8000);
    expect(spendHeatmap(rows, "2026-01-01", "2026-10-11").days.find(d => d.date === "2026-10-10")?.amountPaise).toBe(10000);
  });
  it("distinguishes recorded zero from untracked, future and padding cells", () => {
    const h = spendHeatmap([], "2026-10-03", "2026-10-24");
    expect(h.days.find(d => d.date === "2026-10-02")).toMatchObject({ state: "untracked", amountPaise: null });
    expect(h.days.find(d => d.date === "2026-10-03")).toMatchObject({ state: "tracked", amountPaise: 0, level: 0 });
    expect(h.days.find(d => d.date === "2026-10-25")).toMatchObject({ state: "future", amountPaise: null });
    expect(h.days[0].state).toBe("outside");
  });
  it("uses one monotonically darker scale across months and equal levels for equal amounts", () => {
    const amounts = [1000, 2000, 2000, 3000, 4000, 5000, 6000, 7000];
    const rows = amounts.map((amountPaise, i) => txn({ date: `2026-0${i < 4 ? 9 : 8}-${String(i + 1).padStart(2, "0")}`, amountPaise }));
    const h = spendHeatmap(rows, "2026-01-01", "2026-10-24");
    const levels = rows.map(r => h.days.find(d => d.date === r.date)!.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(levels[1]).toBe(levels[2]); expect(levels[0]).toBeLessThan(levels.at(-1)!);
  });
  it("supports historical month windows without leaking later refunds", () => {
    const rows = [txn({ id: "buy", date: "2026-09-20", amountPaise: 20000 }), txn({ date: "2026-10-02", kind: "refund", refundOf: "buy", amountPaise: 20000 })];
    const h = spendHeatmap(rows, "2026-01-01", "2026-10-24", "2026-09");
    expect(h.from).toBe("2025-10-01"); expect(h.to).toBe("2026-09-30");
    expect(h.days.find(d => d.date === "2026-09-20")?.amountPaise).toBe(20000);
  });
});
