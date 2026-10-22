import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { categoryBreakdown, computeLedger, dailyAllocation, outgoingsInRange } from "@/lib/budget";
import { DEFAULT_RULES, categorize } from "@/lib/categorize";
import { eachDay } from "@/lib/dates";
import { nextDue, upcomingPayments } from "@/lib/recurring";
import { parseMandate, smsToCandidate } from "@/lib/sms";
import type { CategoryRule, Recurring } from "@/lib/types";
import { FinanceDB } from "@/data/db";
import { migratePlan, migrateRule, migrateTxn } from "@/data/migrate";
import { applyCategory, setRecurringFromTxn } from "@/data/repo";
import { commitment, plan, profile, txn } from "./helpers";

const rules: CategoryRule[] = DEFAULT_RULES.map((r, i) => ({ ...r, id: `b${i}` }));

// September: 30 days. Income ₹60,000; rent ₹20,000 and SIP ₹10,000 planned → pool ₹30,000 = ₹1,000/day.
const rent = commitment({ id: "rent", name: "Rent", kind: "bill", tag: "Rent", amountPaise: 20_000_00, dueDay: 1, matchHint: "ramesh@okaxis" });
const sip = commitment({ id: "sip", name: "Index SIP", kind: "investment", tag: "SIP", amountPaise: 10_000_00, dueDay: 5 });
const planned = plan({ incomePaise: 60_000_00, commitments: [rent, sip] });
const rentPaid = (amount: number, date = "2026-09-01") => txn({ date, amountPaise: amount, category: "Bills", tag: "Rent", payee: "ramesh@okaxis", merchant: "Ramesh K" });
const sipPaid = (amount: number, date = "2026-09-05") => txn({ date, amountPaise: amount, kind: "investment", category: "Investments", tag: "SIP", merchant: "Groww" });

describe("set-aside budget, planned amounts", () => {
  it("planned payments that match exactly don't touch the daily budget (matched by UPI ID / tag, no manual link)", () => {
    const l = computeLedger({ plans: [planned], profile: profile("2026-09-01"), txns: [rentPaid(20_000_00), sipPaid(10_000_00)], today: "2026-09-05" });
    expect(l.totalSpentPaise).toBe(0);
    expect(l.availablePaise).toBe(5 * 1_000_00);
  });

  it("paying more than planned takes the difference from that day", () => {
    const l = computeLedger({ plans: [planned], profile: profile("2026-09-01"), txns: [rentPaid(20_500_00)], today: "2026-09-02" });
    expect(l.days[0].spentPaise).toBe(500_00);
    expect(l.availablePaise).toBe(2_000_00 - 500_00);
  });

  it("paying less than planned gives the difference back at month end, not before", () => {
    const txns = [rentPaid(19_000_00)];
    const mid = computeLedger({ plans: [planned], profile: profile("2026-09-01"), txns, today: "2026-09-29" });
    expect(mid.days.every((d) => d.adjustPaise === 0)).toBe(true);
    const end = computeLedger({ plans: [planned], profile: profile("2026-09-01"), txns, today: "2026-09-30" });
    expect(end.todayRow.adjustPaise).toBe(1_000_00);
    expect(end.availablePaise).toBe(30 * 1_000_00 + 1_000_00);
  });

  it("a set-aside payment with no planned line counts in full", () => {
    const l = computeLedger({ plans: [planned], profile: profile("2026-09-01"), txns: [txn({ date: "2026-09-03", amountPaise: 3_000_00, kind: "investment", category: "Investments", tag: "Stocks", merchant: "Zerodha" })], today: "2026-09-03" });
    expect(l.totalSpentPaise).toBe(3_000_00);
  });

  it("only ticked categories are set aside", () => {
    const noInvest = { ...planned, setAside: ["Bills"] };
    // The SIP line no longer comes off income: pool ₹40,000.
    const l = computeLedger({ plans: [noInvest], profile: profile("2026-09-01"), txns: [sipPaid(10_000_00, "2026-09-01")], today: "2026-09-01" });
    expect(l.todayRow.allocationPaise).toBe(dailyAllocation(40_000_00, "2026-09-01"));
    expect(l.todayRow.spentPaise).toBe(10_000_00);
    const subs = { ...plan({ incomePaise: 30_000_00 }), setAside: ["Bills", "Subscriptions"] };
    const s = computeLedger({ plans: [subs], profile: profile("2026-09-01"), txns: [txn({ date: "2026-09-01", amountPaise: 649_00, category: "Subscriptions" })], today: "2026-09-01" });
    expect(s.todayRow.spentPaise).toBe(649_00); // unplanned subscription still counts
  });
});

describe("set-aside budget, actual payments", () => {
  const actual = plan({ incomePaise: 60_000_00, commitments: [], setAsideMode: "actual" });

  it("with nothing set aside yet, income is spread over the month", () => {
    const l = computeLedger({ plans: [actual], profile: profile("2026-09-01"), txns: [], today: "2026-09-01" });
    expect(l.todayRow.allocationPaise).toBe(2_000_00);
  });

  it("a set-aside payment shrinks the pool and the remaining days are recalculated", () => {
    // Rent ₹20,000 on day 11 → ₹60,000 − ₹20,000 (10 days × ₹2,000) − ₹20,000 = ₹20,000 over 20 days.
    const l = computeLedger({ plans: [actual], profile: profile("2026-09-01"), txns: [rentPaid(20_000_00, "2026-09-11")], today: "2026-09-12" });
    expect(l.days[9].allocationPaise).toBe(2_000_00);
    expect(l.days[10].allocationPaise).toBe(1_000_00);
    expect(l.days[10].spentPaise).toBe(0);
    expect(l.days[10].setAsidePaise).toBe(20_000_00);
    expect(l.nextAllocationPaise).toBe(1_000_00);
  });

  it("allocations add up exactly to income minus what was set aside", () => {
    const txns = [rentPaid(20_000_00, "2026-09-03"), sipPaid(7_777_77, "2026-09-17")];
    const l = computeLedger({ plans: [actual], profile: profile("2026-09-01"), txns, today: "2026-09-30" });
    expect(l.totalAllocatedPaise).toBe(60_000_00 - 20_000_00 - 7_777_77);
  });

  it("set-aside payments beyond what's left become a deficit, not negative allowances", () => {
    const l = computeLedger({ plans: [actual], profile: profile("2026-09-01"), txns: [rentPaid(55_000_00, "2026-09-28")], today: "2026-09-29" });
    // 27 days × ₹2,000 = ₹54,000 already allocated; ₹6,000 left − ₹55,000 → ₹49,000 deficit charged on the 28th.
    expect(l.days[27].allocationPaise).toBe(0);
    expect(l.days[27].adjustPaise).toBe(-49_000_00);
    expect(l.days[28].allocationPaise).toBe(0);
    expect(l.days[28].adjustPaise).toBe(0);
    expect(l.availablePaise).toBe(54_000_00 - 49_000_00);
  });

  it("a mid-month start only counts income for the tracked days", () => {
    const l = computeLedger({ plans: [actual], profile: profile("2026-09-16"), txns: [], today: "2026-09-30" });
    expect(l.totalAllocatedPaise).toBe(30_000_00);
  });

  it("daily allocations never lose paise to rounding", () => {
    const odd = plan({ incomePaise: 33_333_33, setAsideMode: "actual" });
    const l = computeLedger({ plans: [odd], profile: profile("2026-02-01"), txns: [], today: "2026-02-28" });
    expect(l.totalAllocatedPaise).toBe(33_333_33);
    expect(eachDay("2026-02-01", "2026-02-28")).toHaveLength(l.days.length);
  });
});

describe("tracking only", () => {
  it("no allowance; bills and investments aren't everyday spending", () => {
    const track = plan({ incomePaise: null });
    const l = computeLedger({ plans: [track], profile: profile("2026-09-01"), txns: [rentPaid(20_000_00), sipPaid(5_000_00, "2026-09-01"), txn({ date: "2026-09-01", amountPaise: 250_00 })], today: "2026-09-01" });
    expect(l.hasBudget).toBe(false);
    expect(l.todayRow.allocationPaise).toBe(0);
    expect(l.todayRow.spentPaise).toBe(250_00);
  });
});

describe("stats", () => {
  const txns = [rentPaid(20_000_00), sipPaid(10_000_00), txn({ date: "2026-09-02", amountPaise: 400_00, category: "Food & Dining" }), txn({ date: "2026-09-02", amountPaise: 4_000_00, kind: "investment", category: "Savings" }), txn({ date: "2026-09-02", amountPaise: 9_000_00, kind: "transfer", category: "Transfers" })];

  it("expense categories leave out investments and savings, but include bills", () => {
    expect(categoryBreakdown(txns, [planned], "2026-09-01", "2026-09-30").map((c) => c.category)).toEqual(["Bills", "Food & Dining"]);
  });

  it("outgoings split into everyday, bills, investments and savings; transfers excluded", () => {
    expect(outgoingsInRange(txns, "2026-09-01", "2026-09-30")).toMatchObject({ everydayPaise: 400_00, billsPaise: 20_000_00, investmentsPaise: 10_000_00, savingsPaise: 4_000_00, totalPaise: 34_400_00, transfersExcludedPaise: 9_000_00 });
  });
});

describe("rules, tags and payees", () => {
  it("a payee (UPI ID) rule beats text rules and sets category + tag", () => {
    const mine: CategoryRule = { id: "u1", pattern: "ramesh@okaxis", payee: "ramesh@okaxis", category: "Bills", tag: "Rent", priority: 10 };
    expect(categorize("Ramesh K swiggy", [...rules, mine], "ramesh@okaxis")).toMatchObject({ category: "Bills", tag: "Rent" });
    expect(categorize("Ramesh K swiggy", [...rules, mine], "someone@okaxis")?.category).toBe("Food & Dining");
  });

  it("utilities and rent are Bills with tags; SIPs are Investments", () => {
    expect(categorize("BESCOM bill payment", rules)).toMatchObject({ category: "Bills", tag: "Utility" });
    expect(categorize("NoBroker rent", rules)).toMatchObject({ category: "Bills", tag: "Rent" });
    expect(categorize("NACH DR BSE LTD SIP", rules)).toMatchObject({ category: "Investments", tag: "SIP", kind: "investment" });
  });

  const AT = Date.UTC(2026, 9, 20, 9, 0);
  it("SMS keep the payee's UPI ID", () => {
    const c = smsToCandidate({ id: "1", address: "VM-HDFCBK", body: "Rs.250.00 debited from A/c XX1234 on 20-10-26 to VPA ramesh.k@okaxis (UPI Ref No 629312345678)", date: AT }, rules)!;
    expect(c.payee).toBe("ramesh.k@okaxis");
  });

  it("dividend credits get the Dividend income tag", () => {
    const c = smsToCandidate({ id: "1", address: "VM-HDFCBK", body: "Rs.640.00 credited to HDFC Bank A/c XX1234 on 20-10-26 by ACH C- ITC LTD DIV 2026. Avl bal INR 10,000.00", date: AT }, rules)!;
    expect(c).toMatchObject({ direction: "in", kind: "income", category: "Income", tag: "Dividend income" });
  });

  it("SIP debits are investments", () => {
    const c = smsToCandidate({ id: "1", address: "VM-HDFCBK", body: "Rs.5,000.00 debited from A/c XX1234 on 05-10-26 towards NACH DR BSE LTD MUTUAL FUND SIP. Avl bal INR 10,000.00", date: AT }, rules)!;
    expect(c).toMatchObject({ kind: "investment", category: "Investments", tag: "SIP" });
  });
});

describe("autopay / mandate SMS", () => {
  const at = Date.UTC(2026, 9, 12, 9, 0);
  it("reads a new mandate", () => {
    const m = parseMandate({ address: "VM-HDFCBK", body: "UPI AutoPay mandate for Rs.649.00 created successfully towards Netflix. Frequency: Monthly. UMN: abc123def456@hdfcbank", date: at })!;
    expect(m).toMatchObject({ event: "created", amountPaise: 649_00, name: "Netflix", frequency: "monthly" });
  });
  it("reads a cancellation", () => {
    expect(parseMandate({ address: "JD-ICICIT-S", body: "Your UPI-Mandate for Rs 5000.00 for GROWW has been revoked successfully.", date: at })?.event).toBe("revoked");
  });
  it("a debit made under a mandate is a transaction, not a new mandate", () => {
    expect(parseMandate({ address: "VM-HDFCBK", body: "Rs.649.00 debited from A/c XX1234 for UPI AutoPay towards Netflix. Txn successful.", date: at })).toBeNull();
  });
  it("ignores non-bank senders and plain debits", () => {
    expect(parseMandate({ address: "VM-NETFLX", body: "Your autopay mandate is created", date: at })).toBeNull();
    expect(parseMandate({ address: "VM-HDFCBK", body: "Rs.250.00 debited from A/c XX1234 to VPA a@okaxis", date: at })).toBeNull();
  });
});

describe("recurring reminders", () => {
  const netflix: Recurring = { id: "r1", name: "Netflix", amountPaise: 649_00, frequency: "monthly", dueDay: 18, category: "Subscriptions", source: "mandate", status: "active", createdAt: 0, updatedAt: 0 };

  it("next due moves to next month once this month's payment is seen", () => {
    expect(nextDue(netflix, [], "2026-10-15")).toBe("2026-10-18");
    expect(nextDue(netflix, [txn({ date: "2026-10-18", amountPaise: 649_00, merchant: "Netflix", category: "Subscriptions" })], "2026-10-19")).toBe("2026-11-18");
  });

  it("shows payments due within a week, soonest first, and doesn't repeat planned lines", () => {
    const dup: Recurring = { ...netflix, id: "r2", name: "Rent", category: "Bills", dueDay: 1, amountPaise: 20_000_00 };
    const items = upcomingPayments({
      statuses: [{ commitment: rent, dueDate: "2026-10-01", paidPaise: 0, manuallyPaid: false, state: "overdue", matchedTxnIds: [] }],
      recurring: [netflix, dup],
      txns: [],
      today: "2026-10-14",
    });
    expect(items.map((i) => i.name)).toEqual(["Rent", "Netflix"]);
  });
});

describe("migration to v3", () => {
  it("moves old categories to Bills with tags, SIP savings to Investments, and is safe to repeat", () => {
    const old = txn({ date: "2026-09-01", amountPaise: 1_800_00, category: "Bills & Utilities", merchant: "Bescom" });
    const m = migrateTxn(old);
    expect(m).toMatchObject({ category: "Bills", tag: "Utility" });
    expect(migrateTxn(m)).toBe(m);
    expect(migrateTxn(txn({ date: "2026-09-01", amountPaise: 1, category: "Rent & Housing", merchant: "NoBroker" }))).toMatchObject({ category: "Bills", tag: "Rent" });
    expect(migrateTxn(txn({ date: "2026-09-01", amountPaise: 1, category: "Bills & Utilities", merchant: "UPI Lite top-up" }))).toMatchObject({ category: "Other", tag: "UPI Lite" });
    const p = migratePlan(plan({ incomePaise: 1, commitments: [commitment({ id: "s", name: "Index fund SIP", kind: "savings", amountPaise: 1 })] }));
    expect(p.commitments[0]).toMatchObject({ kind: "investment", tag: "SIP" });
    expect(migrateRule({ id: "x", pattern: "ramesh@okaxis", category: "Rent & Housing", priority: 10 })).toMatchObject({ category: "Bills", tag: "Rent", payee: "ramesh@okaxis" });
  });

  it("upgrades an existing v2 database in place without losing data", async () => {
    const name = `upgrade-${Math.random()}`;
    const v2 = new Dexie(name);
    v2.version(1).stores({ profile: "id", plans: "id, effectiveFrom", txns: "id, date, kind, category, fingerprint, commitmentId, refundOf", rules: "id, priority", connections: "providerId", imports: "id, importedAt" });
    v2.version(2).stores({ accounts: "id" });
    await v2.open();
    await v2.table("txns").bulkAdd([txn({ id: "a", date: "2026-09-01", amountPaise: 1_800_00, category: "Bills & Utilities", merchant: "Bescom" }), txn({ id: "b", date: "2026-09-02", amountPaise: 250_00, category: "Food & Dining" })]);
    await v2.table("rules").bulkAdd([{ id: "builtin-0", pattern: "old", category: "Rent & Housing", priority: 0, builtIn: true }, { id: "mine", pattern: "chai point", category: "Food & Dining", priority: 10 }]);
    v2.close();

    const db = new FinanceDB(name);
    expect(await db.txns.count()).toBe(2);
    expect(await db.txns.get("a")).toMatchObject({ category: "Bills", tag: "Utility" });
    expect((await db.txns.get("b"))?.category).toBe("Food & Dining");
    expect(await db.rules.get("mine")).toMatchObject({ pattern: "chai point" });
    expect((await db.rules.filter((r) => !!r.builtIn).toArray()).some((r) => r.category === "Rent & Housing")).toBe(false);
    expect(await db.recurring.count()).toBe(0);
    db.close();
  });
});

describe("editing", () => {
  it("‘always use this’ saves a payee rule and fixes past payments to that UPI ID", async () => {
    const db = new FinanceDB(`edit-${Math.random()}`);
    const a = txn({ id: "a", date: "2026-09-01", amountPaise: 20_000_00, merchant: "Ramesh K", payee: "ramesh@okaxis", category: "Other" });
    const b = txn({ id: "b", date: "2026-10-01", amountPaise: 20_000_00, merchant: "RAMESH KUMAR", payee: "ramesh@okaxis", category: "Other" });
    const c = txn({ id: "c", date: "2026-10-02", amountPaise: 300_00, merchant: "Ramesh K", payee: "other@ybl", category: "Other" });
    await db.txns.bulkAdd([a, b, c]);
    expect(await applyCategory(db, a, "Bills", "Rent", true)).toBe(1);
    expect(await db.txns.get("b")).toMatchObject({ category: "Bills", tag: "Rent" });
    expect((await db.txns.get("c"))?.category).toBe("Other");
    expect((await db.rules.toArray()).find((r) => r.payee === "ramesh@okaxis")).toMatchObject({ category: "Bills", tag: "Rent" });
    // Moving something into Investments makes it an investment.
    await applyCategory(db, c, "Investments", "SIP", false);
    expect((await db.txns.get("c"))?.kind).toBe("investment");
  });

  it("‘repeats every month’ adds and removes a recurring payment", async () => {
    const db = new FinanceDB(`rec-${Math.random()}`);
    const t = txn({ id: "t", date: "2026-10-07", amountPaise: 3_200_00, merchant: "Sunita", payee: "sunita@ybl", category: "Bills", tag: "Maintenance" });
    await db.txns.add(t);
    await setRecurringFromTxn(db, t, true);
    expect(await db.recurring.toArray()).toEqual([expect.objectContaining({ name: "Sunita", payee: "sunita@ybl", dueDay: 7, frequency: "monthly", source: "manual" })]);
    expect((await db.txns.get("t"))?.recurring).toBe(true);
    await setRecurringFromTxn(db, t, false);
    expect(await db.recurring.count()).toBe(0);
  });
});
