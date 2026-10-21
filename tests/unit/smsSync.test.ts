import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { FinanceDB } from "@/data/db";
import { syncSms } from "@/data/providers/sms";
import { ensureRules } from "@/data/repo";
import type { RawSms } from "@/lib/sms";

const at = (day: string, hour = 12) => Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00+05:30`);
const debit = (id: string, day: string, rupees: number, payee: string): RawSms => ({
  id,
  address: "VK-SBIUPI",
  body: `Dear UPI user A/C X1234 debited by ${rupees}.0 on date trf to ${payee} Refno 6293${id.padStart(8, "0")}. -SBI`,
  date: at(day),
});

/** Minimal stand-in for the Android bridge over an in-memory inbox. */
function installBridge(inbox: RawSms[]) {
  // Node test environment: give the provider a `window` to find the bridge on.
  (globalThis as { window?: unknown }).window ??= globalThis;
  window.PaisaSms = {
    hasPermission: () => true,
    requestPermission: () => {},
    list: (since, limit) => {
      const rows = inbox.filter((m) => m.date > since).sort((a, b) => a.date - b.date);
      const page = rows.slice(0, limit);
      return JSON.stringify({ messages: page, until: page.length ? page[page.length - 1].date : since, more: rows.length > limit });
    },
  };
}

let db: FinanceDB;
beforeEach(async () => {
  db = new FinanceDB(`sms-sync-${Math.random()}`);
  await ensureRules(db);
});

async function start(day: string) {
  await db.profile.put({ id: "me", trackingStart: day, openingAdjustmentPaise: 0, onboardedAt: 0, manuallyPaid: [] });
}

describe("SMS sync", () => {
  const inbox = [debit("1", "2026-10-01", 100, "BLINKIT"), debit("2", "2026-10-10", 200, "SWIGGY"), debit("3", "2026-10-20", 300, "ZOMATO")];

  it("reads only from the tracking start, then backfills when the start moves earlier", async () => {
    installBridge(inbox);
    await start("2026-10-15");
    expect(await syncSms(db)).toBe(1);

    await start("2026-10-05");
    expect(await syncSms(db)).toBe(1);
    expect((await db.txns.toArray()).map((t) => t.date).sort()).toEqual(["2026-10-10", "2026-10-20"]);

    // Nothing new: no duplicates on repeated syncs.
    expect(await syncSms(db)).toBe(0);
  });

  it("doesn't bring back a transaction deleted after it was imported", async () => {
    installBridge(inbox);
    await start("2026-10-15");
    await syncSms(db);
    await db.txns.clear();
    await start("2026-10-05");
    expect(await syncSms(db)).toBe(1);
    expect((await db.txns.toArray())[0].date).toBe("2026-10-10");
  });

  it("picks up new messages after the cursor", async () => {
    const box = [...inbox];
    installBridge(box);
    await start("2026-10-01");
    expect(await syncSms(db)).toBe(3);
    box.push(debit("4", "2026-10-21", 400, "UBER"));
    expect(await syncSms(db)).toBe(1);
  });
});
