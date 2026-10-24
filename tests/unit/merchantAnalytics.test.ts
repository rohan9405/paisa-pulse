import { describe, expect, it } from "vitest";
import { hasMerchantMonthlyHistory, merchantBreakdown, merchantMonthlyHistory } from "@/lib/merchantAnalytics";
import { txn } from "./helpers";
describe("merchant analytics", () => {
  it("groups name variants, nets linked repayments as of the cutoff, and excludes investments and transfers", () => {
    const txns = [txn({ id: "buy", date: "2026-10-02", amountPaise: 10000, merchant: "Swiggy" }), txn({ date: "2026-10-03", amountPaise: 5000, merchant: " swiggy " }), txn({ date: "2026-10-04", amountPaise: 2000, kind: "refund", refundOf: "buy" }), txn({ date: "2026-10-26", amountPaise: 8000, kind: "settlement", refundOf: "buy" }), txn({ date: "2026-10-04", amountPaise: 9000, kind: "investment" }), txn({ date: "2026-10-04", amountPaise: 9000, kind: "transfer" })];
    expect(merchantBreakdown(txns, "2026-10-01", "2026-10-24")).toMatchObject([{ key: "swiggy", amountPaise: 13000, count: 2 }]);
  });
  it("distinguishes untracked, partial, and fully tracked zero months", () => {
    const h = merchantMonthlyHistory([], "swiggy", "2026-10-24", "2026-09-10");
    expect(h.at(-3)).toMatchObject({ month: "2026-08", tracked: false });
    expect(h.at(-2)).toMatchObject({ month: "2026-09", tracked: true, partial: true, amountPaise: 0 });
    expect(h.at(-1)).toMatchObject({ month: "2026-10", tracked: true, partial: true });
  });
  it("returns twelve ordered months across the year boundary", () => {
    const h = merchantMonthlyHistory([], "swiggy", "2026-03-15", "2025-01-01");
    expect(h).toHaveLength(12);
    expect(h[0].month).toBe("2025-04");
    expect(h.at(-1)).toMatchObject({ month: "2026-03", partial: true });
  });
  it("requires expense data in three calendar months, excluding future and pre-tracking transactions", () => {
    const txns = ["2026-08-20", "2026-09-10", "2026-10-15", "2026-11-01"].map(date => txn({ date, amountPaise: 10000 }));
    expect(hasMerchantMonthlyHistory(txns, "2026-08-01", "2026-10-25")).toBe(true);
    expect(hasMerchantMonthlyHistory(txns, "2026-09-01", "2026-10-25")).toBe(false);
    expect(hasMerchantMonthlyHistory(txns, "2026-08-01", "2026-09-30")).toBe(false);
    expect(hasMerchantMonthlyHistory(txns.map(t => ({ ...t, kind: "investment" as const })), "2026-08-01", "2026-10-25")).toBe(false);
  });
  it("ranks merchants by total spend in the history window, not just the current month", () => {
    const txns = [txn({ date: "2026-09-10", merchant: "Swiggy", amountPaise: 50000 }), txn({ date: "2026-10-10", merchant: "Zomato", amountPaise: 10000 }), txn({ date: "2025-01-01", merchant: "Old merchant", amountPaise: 90000 })];
    expect(merchantBreakdown(txns, "2025-11-01", "2026-10-25").map(r => r.name)).toEqual(["Swiggy", "Zomato"]);
  });

});
