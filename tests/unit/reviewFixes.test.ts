import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { learnFromLinked } from "@/lib/match";
import { isGenericName, recipientKey } from "@/lib/recipients";
import { FinanceDB } from "@/data/db";
import { dismissSuggestion } from "@/data/repo";
import { txn } from "./helpers";

const sms = { providerId: "sms", importedAt: 0 };

describe("generic SMS names aren't recipients", () => {
  it("nameless bank alerts, ATM cash and UPI Lite never group into one recipient", () => {
    for (const name of ["HDFC debit", "ICICI credit", "ATM cash", "UPI Lite top-up", "Unknown"]) expect(isGenericName(name)).toBe(true);
    expect(recipientKey({ merchant: "HDFC debit" })).toBeNull();
    expect(recipientKey({ merchant: "HDFC debit", payee: "ramesh@okaxis" })).toBe("p:ramesh@okaxis");
    expect(recipientKey({ merchant: "Swiggy" })).toBe("n:swiggy");
  });
});

describe("learning from linked payments", () => {
  const fibre = txn({ id: "l", date: "2026-09-08", amountPaise: 1_178_00, merchant: "Airtel", category: "Bills", kind: "commitment", commitmentId: "c-wifi", source: sms });

  it("a same-name payment with a similar amount is linked", () => {
    const next = txn({ id: "n", date: "2026-10-08", amountPaise: 1_178_00, merchant: "Airtel", category: "Bills", source: sms });
    expect(learnFromLinked([fibre, next]).map((t) => t.id)).toEqual(["n"]);
  });

  it("a same-name payment with a very different amount isn't (prepaid recharge vs fibre bill)", () => {
    const recharge = txn({ id: "r", date: "2026-10-10", amountPaise: 299_00, merchant: "Airtel", category: "Bills", source: sms });
    expect(learnFromLinked([fibre, recharge])).toEqual([]);
  });

  it("a payment to the same UPI ID is linked whatever the amount", () => {
    const rent = txn({ id: "a", date: "2026-09-01", amountPaise: 22_000_00, merchant: "Ramesh K", payee: "ramesh@okaxis", kind: "commitment", commitmentId: "c-rent", category: "Bills", source: sms });
    const partial = txn({ id: "b", date: "2026-10-01", amountPaise: 11_000_00, merchant: "RAMESH KUMAR", payee: "ramesh@okaxis", category: "Other", source: sms });
    expect(learnFromLinked([rent, partial])).toEqual([expect.objectContaining({ id: "b", commitmentId: "c-rent", category: "Bills" })]);
  });
});

describe("suggestion dismissals", () => {
  it("a “No” is stored on the profile, once", async () => {
    const db = new FinanceDB(`dismiss-${Math.random()}`);
    await db.profile.put({ id: "me", trackingStart: "2026-10-01", openingAdjustmentPaise: 0, onboardedAt: 0, manuallyPaid: [] });
    await dismissSuggestion(db, "match:n:airtel:c-wifi");
    await dismissSuggestion(db, "match:n:airtel:c-wifi");
    expect((await db.profile.get("me"))?.dismissedSuggestions).toEqual(["match:n:airtel:c-wifi"]);
  });
});
