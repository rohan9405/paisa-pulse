import { describe, expect, it } from "vitest";
import { computeLedger, incomeDate } from "@/lib/budget";
import { DEFAULT_RULES, categorize } from "@/lib/categorize";
import { learnFromLinked } from "@/lib/match";
import { upcomingPayments } from "@/lib/recurring";
import type { CategoryRule, Recurring } from "@/lib/types";
import { plan, profile, txn } from "./helpers";

const rules: CategoryRule[] = DEFAULT_RULES.map((r, i) => ({ ...r, id: `b${i}` }));

describe("late salary counts for the next month (actual mode)", () => {
  const actual = plan({ incomePaise: null, budgetMode: "set-aside", setAsideMode: "actual" });

  it("moves a salary paid on the 25th or later to the 1st of the next month", () => {
    expect(incomeDate({ date: "2026-08-31", tag: "Salary", amountPaise: 1_50_000_00 })).toBe("2026-09-01");
    expect(incomeDate({ date: "2026-08-25", amountPaise: 50_000_00 })).toBe("2026-09-01");
    expect(incomeDate({ date: "2026-12-28", amountPaise: 50_000_00 })).toBe("2027-01-01");
    // Early in the month, or small credits (dividends, friends paying back): the day they arrive.
    expect(incomeDate({ date: "2026-09-01", tag: "Salary", amountPaise: 1_50_000_00 })).toBe("2026-09-01");
    expect(incomeDate({ date: "2026-08-30", tag: "Dividend income", amountPaise: 550_00 })).toBe("2026-08-30");
  });

  it("a 31 Aug salary funds September even when tracking starts on 1 Sep", () => {
    const salary = txn({ date: "2026-08-31", amountPaise: 90_000_00, kind: "income", category: "Income", tag: "Salary" });
    const rent = txn({ date: "2026-09-02", amountPaise: 30_000_00, category: "Bills", tag: "Rent" });
    const l = computeLedger({ plans: [actual], profile: profile("2026-09-01"), txns: [salary, rent], today: "2026-09-03" });
    // ₹90,000 over 30 days = ₹3,000/day; rent on the 2nd reshapes the rest: (90,000 − 3,000 − 30,000) / 29.
    expect(l.days[0].allocationPaise).toBe(3_000_00);
    expect(l.availablePaise).toBeGreaterThan(0);
    expect(l.days.every((d) => d.adjustPaise >= 0)).toBe(true);
  });
});

describe("rules from feedback", () => {
  const cat = (text: string, direction: "in" | "out") => categorize(text, rules, undefined, { merchant: text, direction });

  it("ACH credits are dividend income, ACH debits are not", () => {
    expect(cat("Ach Itc Ltd Div 2026", "in")).toMatchObject({ category: "Income", kind: "income", tag: "Dividend income" });
    expect(cat("ACH Sun Pharma Industries", "in")).toMatchObject({ tag: "Dividend income" });
    expect(cat("ACH D- BAJAJ FINANCE", "out")?.tag).not.toBe("Dividend income");
  });

  it("pharmacies are Health", () => {
    expect(cat("Wellness Forever Pharmacy", "out")?.category).toBe("Health");
    expect(cat("Shree Chemist", "out")?.category).toBe("Health");
    expect(cat("Gupta Medicals", "out")?.category).toBe("Health");
  });
});

describe("learning from payments you linked", () => {
  const sms = { providerId: "sms", importedAt: 0 };

  it("links other payments to the same payee, and nameless debits by amount", () => {
    const linkedSip = txn({ date: "2026-10-05", amountPaise: 20_000_00, merchant: "Groww", payee: "groww@axis", kind: "commitment", category: "Investments", tag: "SIP", commitmentId: "sip", source: sms, createdAt: 1, updatedAt: 99 });
    const linkedRent = txn({ date: "2026-10-01", amountPaise: 40_000_00, merchant: "ICICI debit", kind: "commitment", category: "Bills", tag: "Rent", commitmentId: "rent", source: sms, createdAt: 2, updatedAt: 99 });
    const sepSip = txn({ date: "2026-09-05", amountPaise: 25_000_00, merchant: "Groww", payee: "groww@axis", category: "Other", source: sms });
    const sepRent = txn({ date: "2026-09-01", amountPaise: 40_000_00, merchant: "ICICI debit", category: "Other", source: sms });
    const otherDebit = txn({ date: "2026-09-10", amountPaise: 503_98, merchant: "ICICI debit", category: "Other", source: sms });
    const edited = txn({ date: "2026-09-06", amountPaise: 25_000_00, merchant: "Groww", payee: "groww@axis", category: "Shopping", source: sms, createdAt: 5, updatedAt: 50 });

    const out = learnFromLinked([linkedSip, linkedRent, sepSip, sepRent, otherDebit, edited]);
    expect(out.find((t) => t.id === sepSip.id)).toMatchObject({ commitmentId: "sip", category: "Investments", tag: "SIP" });
    expect(out.find((t) => t.id === sepRent.id)).toMatchObject({ commitmentId: "rent", category: "Bills", tag: "Rent" });
    expect(out.find((t) => t.id === otherDebit.id)).toBeUndefined(); // ₹503.98 isn't ₹40,000
    expect(out.find((t) => t.id === edited.id)).toBeUndefined(); // you edited it
  });
});

describe("reminders come only from autopay SMS", () => {
  const base = { amountPaise: 649_00, dueDay: 25, frequency: "monthly", status: "active", category: "Subscriptions", createdAt: 0 } as const;
  const mandate = { ...base, id: "m", name: "Netflix", source: "mandate" } as Recurring;
  const manual = { ...base, id: "x", name: "Gym", source: "manual" } as unknown as Recurring;

  it("ignores manually marked repeats", () => {
    const items = upcomingPayments({ statuses: [], recurring: [mandate, manual], txns: [], today: "2026-10-23" });
    expect(items.map((i) => i.name)).toEqual(["Netflix"]);
  });
});
