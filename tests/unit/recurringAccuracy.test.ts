import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { nextDue, upcomingPayments } from "@/lib/recurring";
import { parseMandate } from "@/lib/sms";
import { FinanceDB } from "@/data/db";
import { applyMandate } from "@/data/repo";
import { txn } from "./helpers";
import type { Recurring } from "@/lib/types";
const r = (extra: Partial<Recurring> = {}): Recurring => ({ id: "r", name: "Netflix", amountPaise: 64900, frequency: "monthly", dueDay: 5, startDate: "2026-09-05", category: "Subscriptions", source: "mandate", status: "active", createdAt: Date.parse("2026-09-01"), updatedAt: 0, ...extra });
const parse = (body: string) => parseMandate({ address: "VM-HDFCBK", body, date: Date.parse("2026-10-24") });

describe("recurring accuracy", () => {
  it("does not guess missing, daily, half-yearly or one-time frequencies as monthly", () => {
    expect(parse("UPI mandate created for Rs.649 to Netflix UMRN ABC12345")?.frequency).toBe("unknown");
    expect(parse("UPI mandate created for Rs.649 to Netflix frequency daily UMRN ABC12345")?.frequency).toBe("daily");
    expect(parse("UPI mandate created for Rs.649 to Netflix frequency half-yearly UMRN ABC12345")?.frequency).toBe("half-yearly");
    expect(parse("UPI mandate created for Rs.649 to Netflix one-time UMRN ABC12345")?.frequency).toBe("once");
    expect(parse("UPI mandate created for Rs.15000 for ACME IPO UMRN ABC12345")).toBeNull();
    expect(upcomingPayments({ statuses: [], recurring: [r({ frequency: "unknown" }), r({ frequency: "once" })], txns: [], today: "2026-10-24" })).toEqual([]);
  });
  it("anchors schedules, clamps month-end and keeps missed payments visible", () => {
    expect(nextDue(r({ dueDay: 31, startDate: "2026-01-31" }), [], "2026-02-15")).toBe("2026-02-28");
    expect(nextDue(r({ frequency: "weekly", startDate: "2026-10-01", dueDay: 1 }), [], "2026-10-09")).toBe("2026-10-08");
    expect(nextDue(r({ frequency: "half-yearly", startDate: "2026-03-05" }), [], "2026-10-01")).toBe("2026-09-05");
    expect(nextDue(r({ startDate: "2026-12-05" }), [], "2026-10-24")).toBe("2026-12-05");
    expect(upcomingPayments({ statuses: [], recurring: [r()], txns: [], today: "2026-10-12" })[0].state).toBe("missed");
  });
  it("keeps separate mandate references and does not let one payment clear two schedules", async () => {
    const db = new FinanceDB(`rec-accuracy-${Math.random()}`);
    const m = { bank: "HDFC", event: "created" as const, amountPaise: 10000, name: "Same merchant", frequency: "monthly" as const };
    await applyMandate(db, { ...m, ref: "REF0001" }, "2026-10-05", []);
    await applyMandate(db, { ...m, ref: "REF0002" }, "2026-10-05", []);
    expect(await db.recurring.count()).toBe(2);
    const items = upcomingPayments({ statuses: [], recurring: await db.recurring.toArray(), txns: [txn({ merchant: "Same merchant", date: "2026-10-05", amountPaise: 10000, source: { providerId: "sms", importedAt: 0, raw: "Paid UMRN REF0001" } })], today: "2026-10-05" });
    expect(items).toHaveLength(1);
    expect((await db.recurring.get(items[0].key.slice(4)))?.mandateRef).toBe("REF0002");
    await db.delete();
  });
});
