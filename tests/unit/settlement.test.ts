import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FinanceDB } from "@/data/db";
import { addManualTxn, updateTxn, deleteTxn, ensureRules, exportAll, importBackup } from "@/data/repo";
import { categoryBreakdown, expenseEntries, netInHandInRange } from "@/lib/budget";
import { ACTIVE_CATEGORIES, displayCategory } from "@/lib/categorize";
import { autoLinkRefund } from "@/lib/match";
import { settlementCandidates } from "@/lib/reimbursements";
import { smsToCandidate } from "@/lib/sms";
import { parseCsv, guessMapping, validateRows } from "@/lib/csv";
import { parseRemoteConfig, DEFAULT_CONFIG, setConfig } from "@/lib/remoteConfig";
import { txn } from "./helpers";

let db: FinanceDB | undefined;
afterEach(async () => { if (db) await db.delete(); db = undefined; setConfig(DEFAULT_CONFIG); vi.useRealTimers(); });
const expense = () => txn({ id: "dinner", date: "2026-10-01", amountPaise: 400000, category: "Food & Dining", merchant: "Restaurant" });
const share = (id: string, original = "dinner") => txn({ id, kind: "settlement", category: "Settlement", date: "2026-10-03", amountPaise: 100000, merchant: id, refundOf: original });

describe("settlements and Net In-Hand", () => {
  it("counts all income buckets, three people's shares, net expenses and legacy savings under investments", () => {
    const rows = [expense(), share("Alice"), share("Bob"), share("Carol"), txn({ id: "bill", date: "2026-10-02", category: "Bills", amountPaise: 50000 }), txn({ date: "2026-10-04", kind: "refund", category: "Refunds", refundOf: "bill", amountPaise: 20000 }), txn({ date: "2026-10-02", kind: "investment", category: "Investments", amountPaise: 100000 }), txn({ date: "2026-10-02", category: "Savings", amountPaise: 50000 }), ...([1000000, 20000, 10000, 50000].map((amountPaise, i) => txn({ date: "2026-10-02", kind: "income", category: "Income", tag: ["Salary", "Dividend income", "Interest", "Freelance"][i], amountPaise }))), txn({ date: "2026-10-02", kind: "transfer", amountPaise: 900000 })];
    expect(netInHandInRange(rows, "2026-10-01", "2026-10-24")).toEqual({ incomePaise: 1080000, expensesPaise: 130000, investmentsPaise: 150000, moneyOutPaise: 280000, netPaise: 800000 });
    expect(expenseEntries(rows, "2026-10-01", "2026-10-24").reduce((s, r) => s + r.amountPaise, 0)).toBe(130000);
    expect(categoryBreakdown(rows, [], "2026-10-01", "2026-10-24").find(r => r.category === "Food & Dining")?.amountPaise).toBe(100000);
  });
  it("does not leak later shares into history or count an unlinked settlement as income", () => {
    const rows = [expense(), share("Alice"), { ...share("unlinked"), refundOf: undefined }];
    expect(netInHandInRange(rows, "2026-10-01", "2026-10-02").expensesPaise).toBe(400000);
    expect(netInHandInRange(rows, "2026-10-01", "2026-10-04")).toMatchObject({ expensesPaise: 300000, incomePaise: 0 });
    expect(autoLinkRefund(share("Alice"), [expense()])).toMatchObject({ refundOf: undefined, needsReview: true });
  });
  it("offers expenses from other merchants, honours earlier refunds and never offers an investment", () => {
    const rows = [expense(), share("Alice"), txn({ date: "2026-10-02", kind: "refund", refundOf: "dinner", amountPaise: 200000 }), txn({ date: "2026-10-01", kind: "investment", category: "Investments", amountPaise: 800000 })];
    expect(settlementCandidates(share("Bob"), rows).map(t => t.id)).toEqual(["dinner"]);
    expect(settlementCandidates({ ...share("Bob"), amountPaise: 100001 }, rows)).toHaveLength(0);
  });
  it("preserves the original, protects user links and rejects excess and invalid links", async () => {
    db = new FinanceDB(`settlement-${Math.random()}`);
    await db.txns.bulkAdd([expense(), share("Alice")]);
    const credit = await addManualTxn(db, { date: "2026-10-03", amountPaise: 100000, merchant: "Bob", category: "Settlement", refundOf: "dinner" });
    expect(credit).toMatchObject({ kind: "settlement", refundOf: "dinner" });
    await updateTxn(db, credit.id, { amountPaise: 200000 });
    expect(await db.txns.get(credit.id)).toMatchObject({ userEdited: true, refundOf: "dinner" });
    await expect(updateTxn(db, credit.id, { amountPaise: 300001 })).rejects.toThrow(/remaining amount/);
    await expect(updateTxn(db, credit.id, { refundOf: credit.id })).rejects.toThrow(/earlier expense/);
    expect(await db.txns.get("dinner")).toMatchObject({ amountPaise: 400000, kind: "expense" });
    await deleteTxn(db, "dinner");
    expect(await db.txns.get(credit.id)).toMatchObject({ kind: "settlement", needsReview: true });
    expect((await db.txns.get(credit.id))?.refundOf).toBeUndefined();
  });
  it("serialises competing settlements against the same remaining share", async () => {
    db = new FinanceDB(`settlement-race-${Math.random()}`);
    await db.txns.bulkAdd([{ ...expense(), amountPaise: 150000 }, { ...share("A"), kind: "income", category: "Income", refundOf: undefined }, { ...share("B"), kind: "income", category: "Income", refundOf: undefined }]);
    const results = await Promise.allSettled(["A", "B"].map(id => updateTxn(db!, id, { kind: "settlement", category: "Settlement", refundOf: "dinner" })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.txns.where("refundOf").equals("dinner").count()).toBe(1);
  });
  it("supports explicit incoming Settlement rules for SMS and CSV without treating them as income", () => {
    const rule = { id: "split", pattern: "rahul", category: "Settlement", kind: "settlement" as const, direction: "in" as const, priority: 10 };
    const credit = smsToCandidate({ id: "1", address: "VM-HDFCBK", date: Date.UTC(2026, 9, 20, 9), body: "Credit Alert! Rs.2,000.00 credited to HDFC Bank A/c XX1234 on 20-10-26 from VPA rahul.k@okicici (UPI 629398765432)" }, [rule]);
    expect(credit).toMatchObject({ kind: "settlement", category: "Settlement", direction: "in" });
    const csv = parseCsv("Date,Narration,Debit,Credit\n03/10/2026,RAHUL SPLIT,,1000\n");
    const rows = validateRows(csv, guessMapping(csv.headers, csv.rows), { existingFingerprints: new Set(), rules: [rule] });
    expect(rows[0]).toMatchObject({ status: "valid", kind: "settlement", category: "Settlement" });
  });
  it("applies settlement history only by explicit rule opt-in and preserves user edits", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-24T06:00:00Z"));
    db = new FinanceDB(`settlement-history-${Math.random()}`);
    const incoming = txn({ id: "auto", date: "2026-10-03", kind: "income", category: "Income", merchant: "Shared dinner", amountPaise: 100000, createdAt: 1, updatedAt: 1, source: { providerId: "csv", importedAt: 1 } });
    await db.txns.bulkAdd([incoming, { ...incoming, id: "mine", userEdited: true }]);
    setConfig(parseRemoteConfig({ version: 100, rules: [{ contains: "shared dinner", category: "Settlement", kind: "settlement", direction: "in", applyToHistory: true, historyRevision: 1 }] }).config);
    await ensureRules(db);
    expect(await db.txns.get("auto")).toMatchObject({ kind: "settlement", needsReview: true });
    expect(await db.txns.get("mine")).toMatchObject({ kind: "income", userEdited: true });
  });
  it("round-trips linked settlements through existing backups", async () => {
    db = new FinanceDB(`settlement-backup-${Math.random()}`);
    await db.profile.put({ id: "me", trackingStart: "2026-10-01", openingAdjustmentPaise: 0, onboardedAt: 1, manuallyPaid: [] });
    await db.txns.bulkAdd([expense(), { ...share("Alice"), userEdited: true }]);
    const restored = new FinanceDB(`settlement-restored-${Math.random()}`);
    try {
      await importBackup(restored, JSON.parse(JSON.stringify(await exportAll(db, "personal"))));
      expect(await restored.txns.get("Alice")).toMatchObject({ kind: "settlement", category: "Settlement", refundOf: "dinner", userEdited: true });
    } finally { await restored.delete(); }
  });
  it("retains Savings in old config rules while hiding new choices and accepts Settlement rules", () => {
    expect(ACTIVE_CATEGORIES).not.toContain("Savings"); expect(ACTIVE_CATEGORIES).toContain("Settlement");
    expect(displayCategory("Savings")).toBe("Investments");
    const { config, errors } = parseRemoteConfig({ version: 100, rules: [{ contains: "old bank", category: "Savings" }, { contains: "flatmate", category: "Settlement", kind: "settlement", direction: "in" }] });
    expect(errors).toEqual([]); expect(config.rules.map(r => r.category)).toEqual(["Savings", "Settlement"]);
  });
});
