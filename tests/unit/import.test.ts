import { describe, expect, it } from "vitest";
import { fingerprint, guessMapping, parseCsv, parseDate, summarizeCandidates, validateRows } from "@/lib/csv";
import { formatINR, parseAmountToPaise } from "@/lib/money";
import { DEFAULT_RULES, categorize, extractMerchant, detectMethod } from "@/lib/categorize";
import { autoLinkRefund, commitmentCandidates, transferPairs } from "@/lib/match";
import { addDays, toISTKey } from "@/lib/dates";
import type { CategoryRule } from "@/lib/types";
import { commitment, plan, txn } from "./helpers";

const rules: CategoryRule[] = DEFAULT_RULES.map((r, i) => ({ ...r, id: `b${i}` }));

describe("money", () => {
  it("formats Indian grouping", () => {
    expect(formatINR(1_23_45_678_90)).toBe("₹1,23,45,678.90");
    expect(formatINR(1_000_00)).toBe("₹1,000");
    expect(formatINR(-50_50)).toBe("−₹50.50");
    expect(formatINR(2_50_000_00, { compact: true })).toBe("₹2.5L");
  });
  it.each([
    ["1,23,456.78", 1_23_456_78],
    ["₹ 500", 500_00],
    ["Rs. 99.5", 99_50],
    ["-250", -250_00],
    ["(250.00)", -250_00],
    ["250 Dr", -250_00],
    ["250 CR", 250_00],
    ["1,000", 1_000_00],
  ])("parses %s", (s, p) => expect(parseAmountToPaise(s)).toBe(p));
  it.each(["abc", "1.234", "12,34,5", "", "1e5"])("rejects %s", (s) => expect(parseAmountToPaise(s)).toBeNull());
  it("uses IST date boundaries", () => {
    // 2026-10-20 19:00 UTC = 2026-10-21 00:30 IST
    expect(toISTKey(Date.UTC(2026, 9, 20, 19, 0))).toBe("2026-10-21");
    expect(toISTKey(Date.UTC(2026, 9, 20, 18, 0))).toBe("2026-10-20");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("dates in CSV", () => {
  it("parses formats and rejects impossible dates", () => {
    expect(parseDate("05/10/2026", "DD/MM/YYYY")).toBe("2026-10-05");
    expect(parseDate("05/10/26", "DD/MM/YYYY")).toBe("2026-10-05");
    expect(parseDate("10/05/2026", "MM/DD/YYYY")).toBe("2026-10-05");
    expect(parseDate("2026-10-05 10:22:01", "YYYY-MM-DD")).toBe("2026-10-05");
    expect(parseDate("05-Oct-2026", "DD-MMM-YYYY")).toBe("2026-10-05");
    expect(parseDate("31/02/2026", "DD/MM/YYYY")).toBeNull();
    expect(parseDate("29/02/2024", "DD/MM/YYYY")).toBe("2024-02-29");
    expect(parseDate("29/02/2026", "DD/MM/YYYY")).toBeNull();
  });
});

const HDFC_STYLE = `Account Statement,,,,,
Name: TEST USER,,,,,
Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
01/10/26,UPI-SWIGGY-swiggy@icici-ICIC0000001-412345-Food,000412345,01/10/26,450.00,,10000.00
02/10/26,UPI-ZOMATO-zomato@hdfcbank-HDFC0000001-412346-Order,000412346,02/10/26,"1,250.50",,8749.50
03/10/26,SALARY OCT ACME PVT LTD,000412347,03/10/26,,"85,000.00",93749.50
04/10/26,NEFT SELF TRANSFER TO SBI,000412348,04/10/26,"20,000.00",,73749.50
31/02/26,BAD DATE ROW,000412349,31/02/26,10.00,,0
05/10/26,UPI-SWIGGY-swiggy@icici-ICIC0000001-412345-Food,000412345,05/10/26,450.00,,0
06/10/26,ZERODHA BROKING SIP,000412350,06/10/26,"5,000.00",,0
07/10/26,AMAZON REFUND,000412351,07/10/26,,299.00,0
08/10/26,Something,000412352,08/10/26,abc,,0
`;

describe("CSV import", () => {
  const parsed = parseCsv(HDFC_STYLE);
  const mapping = guessMapping(parsed.headers, parsed.rows);

  it("skips bank preamble and guesses a split debit/credit mapping", () => {
    expect(parsed.skippedPreamble).toBe(2);
    expect(mapping.amountMode).toBe("split");
    expect(parsed.headers[mapping.date]).toBe("Date");
    expect(parsed.headers[mapping.description]).toBe("Narration");
    expect(mapping.dateFormat).toBe("DD/MM/YYYY");
  });

  it("validates, categorizes and flags rows — never silently drops", () => {
    const rows = validateRows(parsed, mapping, { existingFingerprints: new Set(), rules });
    expect(rows).toHaveLength(9);
    const s = summarizeCandidates(rows);
    expect(s.invalid).toBe(2); // bad date + "abc" amount
    expect(rows[4].errors[0]).toMatch(/31\/02\/26/);
    expect(rows[8].errors[0]).toMatch(/abc/);
    // row 6 reuses row 1's bank reference → duplicate within file
    expect(rows[5].status).toBe("duplicate");
    expect(rows[0]).toMatchObject({ status: "valid", amountPaise: 450_00, direction: "out", kind: "expense", category: "Food & Dining", method: "upi", merchant: "Swiggy" });
    expect(rows[1].amountPaise).toBe(1_250_50);
    expect(rows[2]).toMatchObject({ kind: "income", category: "Income" });
    expect(rows[3]).toMatchObject({ kind: "transfer" });
    expect(rows[6]).toMatchObject({ kind: "investment" });
    expect(rows[7]).toMatchObject({ kind: "refund", direction: "in" });
  });

  it("detects duplicates against already-imported data on re-import", () => {
    const first = validateRows(parsed, mapping, { existingFingerprints: new Set(), rules });
    const existing = new Set(first.filter((r) => r.status === "valid").map((r) => r.fingerprint!));
    const again = validateRows(parsed, mapping, { existingFingerprints: existing, rules });
    expect(summarizeCandidates(again).valid).toBe(0);
    expect(summarizeCandidates(again).duplicate).toBe(7);
  });

  it("without references, identical rows are flagged but kept (could be two real chais)", () => {
    const p = parseCsv(`Date,Description,Amount\n2026-10-01,CHAI POINT,-20\n2026-10-01,CHAI POINT,-20\n`);
    const m = guessMapping(p.headers, p.rows);
    const rows = validateRows(p, m, { existingFingerprints: new Set(), rules });
    expect(rows.map((r) => r.status)).toEqual(["valid", "valid"]);
    expect(rows[1].duplicateReason).toMatch(/row 1/);
  });

  it("signed and Dr/Cr type columns", () => {
    const p = parseCsv(`Txn Date,Details,Amount,Type\n01-Oct-2026,UBER TRIP,350.00,DR\n02-Oct-2026,CASHBACK REVERSAL,50,CR\n`);
    const m = guessMapping(p.headers, p.rows);
    expect(m.amountMode).toBe("type");
    expect(m.dateFormat).toBe("DD-MMM-YYYY");
    const rows = validateRows(p, m, { existingFingerprints: new Set(), rules });
    expect(rows[0]).toMatchObject({ direction: "out", amountPaise: 350_00, category: "Transport" });
    expect(rows[1]).toMatchObject({ direction: "in", kind: "refund" });
  });

  it("fingerprint prefers bank reference", () => {
    expect(fingerprint({ date: "2026-10-01", amountPaise: 1, direction: "out", description: "x", reference: "ABC123" })).toBe("ref:abc123");
  });
});

describe("categorization", () => {
  it("merchant rules, short-pattern word boundaries, user rules win", () => {
    expect(categorize("UPI/BLINKIT/payment", rules)?.category).toBe("Groceries");
    expect(categorize("OLA CABS", rules)?.category).toBe("Transport");
    expect(categorize("COCA-COLA VENDING", rules)).toBeNull();
    const user: CategoryRule = { id: "u1", pattern: "swiggy", category: "Groceries", priority: 10 };
    expect(categorize("Swiggy Instamart", [...rules, user])?.category).toBe("Groceries");
  });
  it("extracts merchants from narrations", () => {
    expect(extractMerchant("UPI/412345678901/SWIGGY/swiggy@icici/Payment")).toBe("Swiggy");
    expect(extractMerchant("POS 4321XXXX1234 DMART AVENUE")).toBe("Dmart Avenue");
    expect(detectMethod("UPI-ZOMATO-zomato@hdfcbank")).toBe("upi");
    expect(detectMethod("POS 4321 DMART")).toBe("card");
  });
});

describe("matching", () => {
  it("auto-links a refund with one exact match; flags otherwise", () => {
    const e = txn({ id: "ex", date: "2026-10-01", amountPaise: 999_00, merchant: "Myntra" });
    const r = txn({ date: "2026-10-05", amountPaise: 999_00, kind: "refund", merchant: "MYNTRA" });
    expect(autoLinkRefund(r, [e, r])).toMatchObject({ refundOf: "ex", needsReview: false });
    const orphan = txn({ date: "2026-10-05", amountPaise: 50_00, kind: "refund", merchant: "Nowhere" });
    expect(autoLinkRefund(orphan, [e, orphan])).toMatchObject({ needsReview: true, reviewReason: expect.stringMatching(/No matching/) });
    const e2 = txn({ date: "2026-10-02", amountPaise: 999_00, merchant: "Myntra" });
    expect(autoLinkRefund(r, [e, e2, r]).needsReview).toBe(true);
  });
  it("suggests the commitment a payment belongs to", () => {
    const p = plan({ incomePaise: 1, effectiveFrom: "2026-01-01", commitments: [commitment({ id: "rent", name: "Rent", amountPaise: 25_000_00, matchHint: "nobroker" }), commitment({ id: "net", name: "Broadband", amountPaise: 999_00 })] });
    const t = txn({ date: "2026-10-01", amountPaise: 25_000_00, merchant: "NoBroker Rent" });
    expect(commitmentCandidates(t, [p], [t])[0].commitment.id).toBe("rent");
  });
  it("pairs equal out/in within 2 days as likely transfers", () => {
    const o = txn({ date: "2026-10-01", amountPaise: 10_000_00, source: { providerId: "csv", importedAt: 0 } });
    const i = txn({ date: "2026-10-02", amountPaise: 10_000_00, kind: "income", source: { providerId: "csv", importedAt: 0 } });
    expect(transferPairs([o, i])).toHaveLength(1);
  });
});
