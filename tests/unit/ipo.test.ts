import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FinanceDB } from "@/data/db";
import { ensureRules, exportAll, importBackup } from "@/data/repo";
import { syncSms } from "@/data/providers/sms";
import { applyIpoEvent } from "@/data/holds";
import { parseIpoSms } from "@/lib/ipo";
import { outgoingsInRange } from "@/lib/budget";
import type { RawSms } from "@/lib/sms";

const at = Date.parse("2026-10-24T12:00:00+05:30");
const sms = (id: string, body: string): RawSms => ({ id, address: "VM-HDFCBK", body, date: at + Number(id) * 1000 });
const event = (id: string, text: string) => parseIpoSms(sms(id, text))!;
let db: FinanceDB;
beforeEach(async () => { db = new FinanceDB(`ipo-${Math.random()}`); await ensureRules(db); });
afterEach(async () => { await db.delete(); });

describe("IPO lifecycle", () => {
  it("records partial allotment and confirmed release separately and deduplicates repeated bank notices", async () => {
    const block = event("1", "Rs.15000 blocked in A/c X1234 for ACME IPO. UMRN ABC12345");
    const id = await applyIpoEvent(db, block);
    await applyIpoEvent(db, event("2", "Rs.5000 debited from A/c X1234 for ACME IPO. UMRN ABC12345"));
    expect(await db.holds.get(id)).toMatchObject({ blockedPaise: 1500000, debitedPaise: 500000, remainingPaise: 1000000, status: "partial" });
    const release = event("3", "Rs.10000 unblocked in A/c X1234 for ACME IPO. UMRN ABC12345");
    await applyIpoEvent(db, release);
    await applyIpoEvent(db, { ...release, at: at + 9000 });
    expect(await db.holds.get(id)).toMatchObject({ releasedPaise: 1000000, remainingPaise: 0, status: "settled" });
    expect((await db.holds.get(id))?.events).toHaveLength(3);
    const backup = await exportAll(db, "personal");
    const other = new FinanceDB(`ipo-restore-${Math.random()}`);
    await db.profile.put({ id: "me", trackingStart: "2026-10-01", openingAdjustmentPaise: 0, onboardedAt: 0, manuallyPaid: [] });
    await importBackup(other, { ...backup, profile: await db.profile.get("me") });
    expect((await other.holds.get(id))?.status).toBe("settled"); await other.delete();
  });

  it("never assumes expiry releases money, and does not merge different accounts", async () => {
    const id = await applyIpoEvent(db, event("1", "Rs.15000 blocked in A/c X1234 for ACME IPO. UMRN ABC12345"));
    await applyIpoEvent(db, event("2", "IPO mandate expired for A/c X1234. UMRN ABC12345"));
    expect(await db.holds.get(id)).toMatchObject({ remainingPaise: 1500000, status: "needs_review" });
    await applyIpoEvent(db, event("3", "Rs.15000 blocked in A/c X5678 for ACME IPO. UMRN ABC12345"));
    expect(await db.holds.count()).toBe(2);
    expect(parseIpoSms(sms("4", "IPO mandate requested for Rs.15000 UMRN ABC12345"))).toBeNull();
    expect(parseIpoSms(sms("5", "Rs.15000 will be unblocked for IPO UMRN ABC12345"))).toBeNull();
    expect(parseIpoSms(sms("6", "IPO funds Rs.15000 could not be released UMRN ABC12345"))).toBeNull();
  });

  it("imports only actual allotment as an investment, never the block or release as income/spending", async () => {
    const box = [sms("1", "Rs.15000 blocked in A/c X1234 for ACME IPO. UMRN ABC12345"), sms("2", "Rs.5000 debited from A/c X1234 for ACME IPO. UMRN ABC12345"), sms("3", "Rs.10000 unblocked in A/c X1234 for ACME IPO. UMRN ABC12345")];
    (globalThis as { window?: unknown }).window ??= globalThis;
    window.PaisaSms = { hasPermission: () => true, requestPermission() {}, list(since) { const messages = box.filter((s) => s.date > since); return JSON.stringify({ messages, until: messages.at(-1)?.date ?? since, more: false }); } };
    await db.profile.put({ id: "me", trackingStart: "2026-10-01", openingAdjustmentPaise: 0, onboardedAt: 0, manuallyPaid: [] });
    expect(await syncSms(db)).toBe(1); expect(await syncSms(db)).toBe(0);
    const txns = await db.txns.toArray();
    expect(txns[0]).toMatchObject({ kind: "investment", category: "Investments", tag: "IPO", amountPaise: 500000 });
    expect(txns[0].holdId).toBeDefined();
    expect(outgoingsInRange(txns, "2026-10-01", "2026-10-31")).toMatchObject({ incomePaise: 0, everydayPaise: 0, investmentsPaise: 500000 });
    expect(await db.recurring.count()).toBe(0);
  });
});
