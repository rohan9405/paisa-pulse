import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinanceDB } from "@/data/db";
import { ensureRules, recategorizeAll, saveRule, updateTxn } from "@/data/repo";
import { categorize } from "@/lib/categorize";
import { DEFAULT_CONFIG, parseRemoteConfig, setConfig, TAB_IDS } from "@/lib/remoteConfig";
import { txn } from "./helpers";
import { adminPage } from "../../backend/src/admin";

let db: FinanceDB;
const config = (rule: object = {}, extra: object = {}) => setConfig(parseRemoteConfig({ version: 2, rules: [{ contains: "sample shop", category: "Groceries", priority: 100, ...rule }], ...extra }).config);
beforeEach(async () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-24T06:00:00Z")); db = new FinanceDB(`history-${Math.random()}`); });
afterEach(async () => { await db.delete(); setConfig(DEFAULT_CONFIG); vi.useRealTimers(); });
const row = (id: string, extra = {}) => txn({ id, merchant: "Sample Shop", date: "2026-10-01", amountPaise: 10000, source: { providerId: "sms", importedAt: 1 }, createdAt: 1, updatedAt: 1, ...extra });

describe("remote classification boundaries", () => {
  it("updates future rules without touching history, and every primary action is supported", async () => {
    await db.txns.add(row("old")); config(); await ensureRules(db);
    expect((await db.txns.get("old"))?.category).toBe("Other");
    expect(categorize("Sample Shop", await db.rules.toArray())?.category).toBe("Groceries");
    for (const id of TAB_IDS) expect(parseRemoteConfig({ version: 1, primaryAction: id, tabs: TAB_IDS.map((tab) => ({ id: tab, label: tab, visible: true })) }).config.primaryAction).toBe(id);
    expect(parseRemoteConfig({ version: 1, primaryAction: "settings", tabs: [{ id: "settings", visible: false }] }).config.primaryAction).toBe("today");
  });

  it("requires a per-rule opt-in, respects the cutoff and user edits, and does not repeat for text changes", async () => {
    await db.txns.bulkAdd([row("recent"), row("old", { date: "2025-10-23" }), row("edited"), row("legacy", { updatedAt: 2 })]);
    await updateTxn(db, "edited", { category: "Shopping" });
    config({ applyToHistory: true }); await ensureRules(db);
    expect((await db.txns.get("recent"))?.category).toBe("Groceries");
    expect((await db.txns.get("old"))?.category).toBe("Other");
    expect((await db.txns.get("edited"))?.category).toBe("Shopping");
    expect((await db.txns.get("legacy"))?.category).toBe("Other");
    await db.txns.update("recent", { category: "Other" });
    config({ applyToHistory: true }, { version: 3, screens: { today: { title: "New text" } } }); await ensureRules(db);
    expect((await db.txns.get("recent"))?.category).toBe("Other");
    config({ applyToHistory: true, historyRevision: 1 }); await ensureRules(db);
    expect((await db.txns.get("recent"))?.category).toBe("Groceries");
  });

  it("personal rules beat remote priority 100 and survive refresh, removal and built-in edits", async () => {
    await db.txns.add(row("recent"));
    await saveRule(db, { id: "mine", pattern: "sample", category: "Health", priority: 0 });
    config({ applyToHistory: true }); await ensureRules(db);
    expect(categorize("Sample Shop", await db.rules.toArray())?.category).toBe("Health");
    expect((await db.txns.get("recent"))?.category).toBe("Other");
    const remote = (await db.rules.toArray()).find((r) => r.id.startsWith("remote-"))!;
    await saveRule(db, { ...remote, category: "Education" });
    setConfig(DEFAULT_CONFIG); await ensureRules(db);
    const personal = await db.rules.filter((r) => !r.builtIn).toArray();
    expect(personal).toHaveLength(2);
    expect(personal.some((r) => r.category === "Education")).toBe(true);
    expect(await db.rules.get("mine")).toBeDefined();
  });

  it("re-reads stored SMS only when the config asks, for its period and payments, never user edits", async () => {
    const body = (m: string) => `Rs. 100.00 debited from ICICI Bank Acc XX567 on 01-Oct-26 VIN*${m}. Bal Rs. 900.00.`;
    const sms = (id: string, m: string, extra = {}) => row(id, { merchant: "ICICI debit", source: { providerId: "sms", importedAt: 1, raw: body(m) }, ...extra });
    await db.txns.bulkAdd([sms("auto", "Google Pl"), sms("named", "Netflix", { merchant: "Old Name" }), sms("edited", "Google Pl"), sms("legacyEdit", "Google Pl", { updatedAt: 2 }), sms("old", "Google Pl", { date: "2026-08-01" })]);
    await updateTxn(db, "edited", { note: "mine" });
    const parsing = { merchantAfter: [{ text: "VIN*" }], merchants: [{ contains: "googlepl", name: "Google Play" }, { contains: "netflix", name: "Netflix" }] };

    setConfig(parseRemoteConfig({ version: 6, ...parsing }).config); await ensureRules(db);
    expect((await db.txns.get("auto"))?.merchant).toBe("ICICI debit"); // parsing changes alone touch nothing stored

    setConfig(parseRemoteConfig({ version: 7, ...parsing, smsReread: { run: 1, months: 1, names: true, only: "unnamed" } }).config); await ensureRules(db);
    expect((await db.txns.get("auto"))?.merchant).toBe("Google Play");
    expect((await db.txns.get("auto"))?.updatedAt).toBe(1); // still automatic
    expect((await db.txns.get("named"))?.merchant).toBe("Old Name"); // had a name: not in "unnamed"
    expect((await db.txns.get("edited"))?.merchant).toBe("ICICI debit");
    expect((await db.txns.get("legacyEdit"))?.merchant).toBe("ICICI debit");
    expect((await db.txns.get("old"))?.merchant).toBe("ICICI debit"); // outside the period

    await db.txns.update("auto", { merchant: "ICICI debit" });
    setConfig(parseRemoteConfig({ version: 8, ...parsing, smsReread: { run: 1, months: 1, names: true, only: "unnamed" }, screens: { today: { title: "Hi" } } }).config); await ensureRules(db);
    expect((await db.txns.get("auto"))?.merchant).toBe("ICICI debit"); // same run number: not repeated

    setConfig(parseRemoteConfig({ version: 9, ...parsing, smsReread: { run: 2, months: 3, names: true, categories: true, only: "all", contains: "netflix" } }).config); await ensureRules(db);
    expect((await db.txns.get("named"))?.merchant).toBe("Netflix");
    expect((await db.txns.get("named"))?.category).toBe("Subscriptions");
    expect((await db.txns.get("auto"))?.merchant).toBe("ICICI debit"); // filtered out by "contains"
    expect(parseRemoteConfig({ version: 10, smsReread: { run: 0, names: true } }).errors).toHaveLength(1);
  });

  it("a user's copy of a global rule survives config updates and wins in re-reads; re-apply skips user edits", async () => {
    const raw = "Rs. 100.00 debited from ICICI Bank Acc XX567 on 01-Oct-26 VIN*Sample Shop. Bal Rs. 900.00.";
    await db.txns.bulkAdd([row("auto", { source: { providerId: "sms", importedAt: 1, raw } }), row("edited", { source: { providerId: "sms", importedAt: 1, raw } })]);
    await updateTxn(db, "edited", { category: "Health" });
    config(); await ensureRules(db);
    const global = (await db.rules.toArray()).find((r) => r.builtIn && r.pattern === "sample shop")!;
    await saveRule(db, { id: undefined, pattern: global.pattern, category: "Education", priority: 10 });
    config({ priority: 100 }, { version: 4, smsReread: { run: 1, months: 1, names: false, categories: true, only: "all" } }); await ensureRules(db);
    expect((await db.rules.toArray()).filter((r) => !r.builtIn).map((r) => r.category)).toEqual(["Education"]);
    expect((await db.txns.get("auto"))?.category).toBe("Education");
    expect((await db.txns.get("edited"))?.category).toBe("Health");
    await db.txns.update("auto", { category: "Other" });
    expect(await recategorizeAll(db)).toBe(1);
    expect((await db.txns.get("auto"))?.category).toBe("Education");
    expect((await db.txns.get("auto"))?.updatedAt).toBe(1);
    expect((await db.txns.get("edited"))?.category).toBe("Health");
  });

  it("the admin script compiles and includes per-rule history and primary controls", () => {
    const html = adminPage({}, "test");
    const js = html.match(/<script nonce="test">([\s\S]*?)<\/script>/)![1];
    expect(() => new Function(js)).not.toThrow();
    expect(html).toContain("primaryAction"); expect(html).toContain("applyToHistory"); expect(html).toContain("merchantAfter"); expect(html).toContain("rr_run");
  });
});
