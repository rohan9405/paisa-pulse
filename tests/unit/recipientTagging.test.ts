import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinanceDB } from "@/data/db";
import { addManualTxn, applyCategory, recategorizeAll } from "@/data/repo";
import { smsToCandidate } from "@/lib/sms";
import { categorize } from "@/lib/categorize";
import { recipientMatches, taggingCutoff, recipientNeedsTagging } from "@/lib/recipients";
import { plan, txn } from "./helpers";

let db: FinanceDB;
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-23T06:00:00Z")); });
afterEach(async () => { if (db) await db.delete(); vi.useRealTimers(); });
const payment = (id: string, patch = {}) => txn({ id, date: "2026-10-01", amountPaise: 10000, merchant: "Ramesh", payee: "ramesh@ybl", ...patch });

describe("recipient tagging", () => {
  it("limits a month nudge to the same recipient and flow", async () => {
    db = new FinanceDB(`tag-${Math.random()}`);
    const a = payment("a");
    const rows = [a, payment("b", { payee: " RAMESH@YBL ", merchant: "Different bank name" }), payment("old", { date: "2026-09-30" }), payment("other", { payee: "other@ybl" }), payment("income", { kind: "income" }), payment("refund", { kind: "refund" })];
    await db.txns.bulkAdd(rows);
    expect(recipientMatches(rows, a, "month").map((t) => t.id)).toEqual(["b"]);
    expect(await applyCategory(db, a, "Bills", "Rent", { remember: true, scope: "month" })).toBe(1);
    expect(await db.txns.get("b")).toMatchObject({ category: "Bills", tag: "Rent" });
    for (const id of ["old", "other", "income", "refund"]) expect((await db.txns.get(id))?.category).toBe("Other");
    const rules = await db.rules.toArray();
    expect(categorize("different name", rules, "ramesh@ybl", { direction: "out" })).toMatchObject({ category: "Bills", tag: "Rent" });
    expect(categorize("different name", rules, "ramesh@ybl", { direction: "in" })).toBeNull();
  });

  it.each(["tracking", "planned", "actual"] as const)("%s mode remembers future manual/SMS payments without rewriting history", async (mode) => {
    db = new FinanceDB(`tag-${Math.random()}`);
    await db.plans.put(plan({ budgetMode: mode === "tracking" ? "tracking" : "set-aside", setAsideMode: mode === "actual" ? "actual" : "planned", incomePaise: mode === "planned" ? 60_000_00 : null }));
    const a = payment("a", { payee: undefined, merchant: "Local Shop" });
    const old = { ...a, id: "old", date: "2026-09-01" };
    await db.txns.bulkAdd([a, old]);
    await applyCategory(db, a, "Groceries", "Weekly", { remember: true, scope: "one" });
    expect((await db.txns.get("old"))?.category).toBe("Other");
    const next = await addManualTxn(db, { date: "2026-11-01", amountPaise: 15000, merchant: " local   shop " });
    expect(next).toMatchObject({ category: "Groceries", tag: "Weekly" });
    const rules = await db.rules.toArray();
    const sms = smsToCandidate({ id: "new-sms", address: "VM-HDFCBK-S", date: Date.UTC(2026, 10, 1), body: "Sent Rs.250.00\nFrom HDFC Bank A/C *1234\nTo Local Shop\nOn 01/11/26\nRef 629312345678" }, rules);
    expect(sms).toMatchObject({ category: "Groceries", tag: "Weekly", kind: "expense" });
    expect(categorize("Local Shop Express", rules)).toBeNull();
    expect(categorize("UPI narration", rules, undefined, { merchant: "Local Shop", direction: "out" })).toMatchObject({ tag: "Weekly" });
    await applyCategory(db, a, "Shopping", "", { remember: true, scope: "all" });
    expect(await db.rules.count()).toBe(1);
    expect((await db.txns.get("old"))?.category).toBe("Shopping");
    expect((await db.txns.get("old"))?.tag).toBeUndefined();
  });

  it("bulk edits skip older history, include the cutoff, and leave unchanged rows untouched", async () => {
    db = new FinanceDB(`tag-${Math.random()}`);
    const a = payment("a");
    await db.txns.bulkAdd([
      a,
      payment("boundary", { date: "2025-10-23" }),
      payment("too-old", { date: "2025-10-22" }),
      payment("three-years", { date: "2023-10-23" }),
      payment("future", { date: "2026-10-24" }),
      payment("unchanged", { category: "Bills", tag: "Rent", updatedAt: 123 }),
    ]);
    const wholeTableRead = vi.spyOn(db.txns, "toArray");
    expect(await applyCategory(db, a, "Bills", "Rent", { remember: true, scope: "all" })).toBe(1);
    expect(wholeTableRead).not.toHaveBeenCalled();
    expect((await db.txns.get("boundary"))?.tag).toBe("Rent");
    expect((await db.txns.get("unchanged"))?.updatedAt).toBe(123);
    for (const id of ["too-old", "three-years", "future"]) expect((await db.txns.get(id))?.category).toBe("Other");
    const editedAt = (await db.txns.get("a"))?.updatedAt;
    vi.setSystemTime(new Date("2026-10-23T07:00:00Z"));
    expect(await applyCategory(db, a, "Bills", "Rent", { remember: false, scope: "all" })).toBe(0);
    expect((await db.txns.get("a"))?.updatedAt).toBe(editedAt);
  });

  it("re-applying rules also respects the twelve-month cutoff", async () => {
    db = new FinanceDB(`tag-${Math.random()}`);
    await db.txns.bulkAdd([payment("new"), payment("old", { date: "2023-10-23" })]);
    await db.rules.put({ id: "rent", payee: "ramesh@ybl", pattern: "ramesh@ybl", category: "Bills", tag: "Rent", priority: 10 });
    expect(await recategorizeAll(db)).toBe(1);
    expect((await db.txns.get("new"))?.tag).toBe("Rent");
    expect((await db.txns.get("old"))?.category).toBe("Other");
  });

  it("an older bulk anchor stays unchanged, but can still be edited individually", async () => {
    db = new FinanceDB(`tag-${Math.random()}`);
    const old = payment("old", { date: "2023-10-23" });
    await db.txns.bulkAdd([old, payment("recent")]);
    await applyCategory(db, old, "Groceries", "Weekly", { remember: true, scope: "all" });
    expect((await db.txns.get("old"))?.category).toBe("Other");
    expect((await db.txns.get("recent"))?.category).toBe("Groceries");
    await applyCategory(db, old, "Bills", "Rent", { remember: false, scope: "one" });
    expect((await db.txns.get("old"))?.category).toBe("Bills");
    expect(taggingCutoff("2024-02-29")).toBe("2023-02-28");
  });

  it("archives consistent categories, with optional tags, and reopens for new untagged payments", () => {
    const tagged = [payment("a", { category: "Bills", tag: "Rent" }), payment("b", { category: "Bills", tag: "Rent" })];
    expect(recipientNeedsTagging(tagged)).toBe(false);
    expect(recipientNeedsTagging([payment("category-only", { category: "Groceries" })])).toBe(false);
    expect(recipientNeedsTagging([payment("custom", { category: "Other", tag: "Coffee" })])).toBe(false);
    expect(recipientNeedsTagging([...tagged, payment("new")])).toBe(true);
    expect(recipientNeedsTagging([...tagged, payment("mixed", { category: "Bills", tag: "Utility" })])).toBe(true);
    expect(recipientNeedsTagging([...tagged, payment("old", { date: "2023-10-23" })])).toBe(false);
    expect(recipientNeedsTagging([payment("old-only", { date: "2023-10-23" })])).toBe(false);
  });

  it("does not group unknown recipients or different UPI IDs with the same display name", () => {
    const a = payment("a");
    expect(recipientMatches([payment("b", { payee: "different@ybl" }), payment("c", { payee: undefined })], a, "all")).toEqual([]);
    const unknown = payment("unknown", { merchant: "Unknown", payee: undefined });
    expect(recipientMatches([{ ...unknown, id: "second" }], unknown, "all")).toEqual([]);
  });
});
