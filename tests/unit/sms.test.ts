import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "@/lib/categorize";
import { DEFAULT_CONFIG, parseRemoteConfig, setConfig } from "@/lib/remoteConfig";
import { bankForSender, parseBalance, parseBankSms, smsToCandidate } from "@/lib/sms";
import type { CategoryRule } from "@/lib/types";

const rules: CategoryRule[] = DEFAULT_RULES.map((r, i) => ({ ...r, id: `b${i}` }));
// 20 Oct 2026, 14:30 IST
const AT = Date.UTC(2026, 9, 20, 9, 0);
const sms = (address: string, body: string) => ({ id: "1", address, body, date: AT });

describe("sender ids", () => {
  it("recognises bank senders with operator prefixes and DLT suffixes", () => {
    expect(bankForSender("VM-HDFCBK")).toBe("HDFC");
    expect(bankForSender("AX-HDFCBK-S")).toBe("HDFC");
    expect(bankForSender("JD-ICICIT-S")).toBe("ICICI");
    expect(bankForSender("VK-SBIUPI")).toBe("SBI");
    expect(bankForSender("BP-ATMSBI")).toBe("SBI");
    expect(bankForSender("CP-SBICRD-T")).toBe("SBI");
  });

  it("ignores phone numbers and non-bank senders", () => {
    expect(bankForSender("+919876543210")).toBeNull();
    expect(bankForSender("VM-SWIGGY")).toBeNull();
    expect(bankForSender("AD-AMAZON")).toBeNull();
  });

  it("drops a message that looks like a bank alert from an unknown sender", () => {
    expect(parseBankSms({ address: "+919876543210", body: "Rs.5000 debited from your HDFC Bank A/c XX1234" })).toBeNull();
  });
});

describe("HDFC", () => {
  it("UPI sent", () => {
    const c = smsToCandidate(sms("VM-HDFCBK-S", "Sent Rs.250.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 20/10/26\nRef 629312345678\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808"), rules)!;
    expect(c).toMatchObject({ date: "2026-10-20", amountPaise: 250_00, direction: "out", kind: "expense", merchant: "Swiggy", category: "Food & Dining", method: "upi", reference: "629312345678" });
  });

  it("card spend", () => {
    const c = smsToCandidate(sms("AD-HDFCBK", "Spent Rs.1,499.00 On HDFC Bank Card 4321 At AMAZON PAY INDIA On 2026-10-20:14:28:09 Bal Rs.48,501.00 Not You? Call 18002586161"), rules)!;
    expect(c).toMatchObject({ amountPaise: 1_499_00, kind: "expense", merchant: "Amazon Pay", category: "Shopping", method: "card" });
  });

  it("credit alert from a VPA", () => {
    const c = smsToCandidate(sms("VM-HDFCBK", "Credit Alert!\nRs.2,000.00 credited to HDFC Bank A/c XX1234 on 20-10-26 from VPA rahul.k@okicici (UPI 629398765432)"), rules)!;
    expect(c).toMatchObject({ amountPaise: 2_000_00, direction: "in", kind: "income", merchant: "Rahul K", method: "upi", reference: "629398765432" });
  });

  it("salary NEFT credit", () => {
    const c = smsToCandidate(sms("VM-HDFCBK", "Update! INR 85,000.00 deposited in HDFC Bank A/c XX1234 on 01-OCT-26 for NEFT Cr-CITI0000001-ACME SALARY OCT. Avl bal INR 1,02,345.00"), rules)!;
    expect(c).toMatchObject({ amountPaise: 85_000_00, kind: "income", category: "Income" });
  });

  it("credit card bill payment is a transfer", () => {
    const c = smsToCandidate(sms("VM-HDFCBK", "Payment of Rs.12,500.00 has been received towards your HDFC Bank Credit Card ending 4321. Thank you."), rules)!;
    expect(c.kind).toBe("transfer");
  });
});

describe("ICICI", () => {
  it("UPI debit with payee", () => {
    const c = smsToCandidate(sms("JD-ICICIT-S", "ICICI Bank Acct XX567 debited for Rs 349.00 on 20-Oct-26; ZOMATO credited. UPI:629311112222. Call 18002662 for dispute. SMS BLOCK 567 to 9215676766."), rules)!;
    expect(c).toMatchObject({ amountPaise: 349_00, direction: "out", kind: "expense", merchant: "Zomato", category: "Food & Dining", method: "upi", reference: "629311112222" });
  });

  it("credit card spend", () => {
    const c = smsToCandidate(sms("VM-ICICIT", "INR 2,340.00 spent using ICICI Bank Card XX9876 on 20-Oct-26 on UBER INDIA. Avl Limit: INR 1,45,660.00. If not you, call 1800 2662/SMS BLOCK 9876 to 9215676766"), rules)!;
    expect(c).toMatchObject({ amountPaise: 2_340_00, merchant: "Uber", category: "Transport", method: "card" });
  });

  it("refund credit", () => {
    const c = smsToCandidate(sms("VM-ICICIT", "Dear Customer, Acct XX567 is credited with Rs 499.00 on 20-Oct-26 from FLIPKART towards refund. UPI:629355556666"), rules)!;
    expect(c).toMatchObject({ direction: "in", kind: "refund", category: "Refunds", merchant: "Flipkart" });
  });
});

describe("ICICI debit card, merchant markers from the config", () => {
  afterEach(() => setConfig(DEFAULT_CONFIG));
  const google = "Rs. 1,250.00 debited from ICICI Bank Acc XX567 on 21-Oct-26 VIN*Google Pl. Bal Rs. 10,000.00. If not you call 18002662 or SMS BLOCK 567 to 9215676766";

  it("has no built-in markers: without config the bank name is used", () => {
    expect(smsToCandidate(sms("JD-ICICIT-S", google), rules)!.merchant).toBe("ICICI debit");
  });

  it("reads the merchant after a configured marker, and the config names it", () => {
    setConfig(parseRemoteConfig({ version: 5, merchantMarkers: ["VIN*"], merchants: [{ contains: "googlepl", name: "Google Play" }] }).config);
    const c = smsToCandidate(sms("JD-ICICIT-S", google), rules)!;
    expect(c.merchant).toBe("Google Play");
    expect(c.amountPaise).toBe(1_250_00);
    const d = smsToCandidate(sms("JD-ICICIT-S", "Rs. 199.00 debited from ICICI Bank Acc XX567 on 21-Oct-26 vin*NETFLIX COM. Bal Rs. 9,801.00."), rules)!;
    expect(d.merchant).toBe("Netflix");
  });

  it("drops invalid and duplicate markers", () => {
    expect(parseRemoteConfig({ version: 5, merchantMarkers: ["VIN*", "vin*", "x", 3, "  "] }).config.merchantMarkers).toEqual(["VIN*"]);
  });
});

describe("ICICI, real messages", () => {
  it("UPI Lite top-up counts as an everyday expense (not a set-aside bill)", () => {
    const c = smsToCandidate(sms("JD-ICICIT-S", "UPI LITE top-up amounting to Rs 1850.00 is successful. Your ref no. is 512345678901-ICICI Bank."), rules)!;
    expect(c).toMatchObject({ amountPaise: 1_850_00, direction: "out", kind: "expense", category: "Other", tag: "UPI Lite", merchant: "UPI Lite top-up", method: "upi", reference: "512345678901" });
  });

  it("money back from a merchant is a refund, with a clean name", () => {
    const c = smsToCandidate(sms("JD-ICICIT-S", "Dear Customer, Acct XX901 is credited with Rs 499.00 on 30-Sep-26 from WWW MYNTRA COM. UPI:598765432101-ICICI Bank."), rules)!;
    expect(c).toMatchObject({ amountPaise: 499_00, direction: "in", kind: "refund", category: "Refunds", merchant: "Myntra", reference: "598765432101" });
  });

  it("money from a person stays income", () => {
    const c = smsToCandidate(sms("JD-ICICIT-S", "Dear Customer, Acct XX901 is credited with Rs 500.00 on 30-Sep-26 from RAHUL KUMAR. UPI:598765439999-ICICI Bank."), rules)!;
    expect(c).toMatchObject({ kind: "income", merchant: "Rahul Kumar" });
  });
});

describe("SBI", () => {
  it("UPI debit without a currency symbol", () => {
    const c = smsToCandidate(sms("VK-SBIUPI", "Dear UPI user A/C X1234 debited by 120.0 on date 20Oct26 trf to BLINKIT Refno 629377778888. If not u? call 1800111109. -SBI"), rules)!;
    expect(c).toMatchObject({ amountPaise: 120_00, direction: "out", merchant: "Blinkit", category: "Groceries", method: "upi", reference: "629377778888" });
  });

  it("UPI credit", () => {
    const c = smsToCandidate(sms("VK-SBIUPI", "Dear SBI UPI User, ur A/cX1234 credited by Rs500 on 20Oct26 by (Ref no 629399990000)"), rules)!;
    expect(c).toMatchObject({ amountPaise: 500_00, direction: "in", kind: "income" });
  });

  it("ATM withdrawal is cash spending", () => {
    const c = smsToCandidate(sms("BP-ATMSBI", "Dear Customer, Rs.2000 withdrawn at SBI ATM S1BW012345 from A/cX1234 on 20Oct26 Transaction Number 1234. Available Balance Rs.10500. If not withdrawn by you, call 1800111109"), rules)!;
    expect(c).toMatchObject({ amountPaise: 2_000_00, direction: "out", method: "cash" });
  });

  it("SBI Card spend", () => {
    const c = smsToCandidate(sms("CP-SBICRD", "Rs.799.00 spent on your SBI Credit Card ending 5555 at NETFLIX on 20/10/26. Trxn. not done by you? Report at https://sbicard.com/Dispute"), rules)!;
    expect(c).toMatchObject({ amountPaise: 799_00, merchant: "Netflix", category: "Subscriptions", method: "card" });
  });
});

describe("not transactions", () => {
  const skip = [
    ["VM-HDFCBK", "654321 is the OTP for txn of INR 1,499.00 at AMAZON on HDFC Bank card ending 4321. Valid till 14:35. Do not share OTP"],
    ["JD-ICICIT", "Your transaction of Rs 500.00 on ICICI Bank Card XX9876 at MYNTRA was declined due to insufficient limit."],
    ["VK-SBIUPI", "Rahul has requested money from you on SBI UPI. On approving, Rs 300 will be debited from your account."],
    ["VM-HDFCBK", "Your HDFC Bank Credit Card XX4321 statement is generated. Total Amt Due: Rs.12,500.00. Min Amt Due Rs.625 due by 05-11-26."],
    ["AX-ICICIB", "Congratulations! You are pre-approved for a Personal Loan of Rs 5,00,000. Apply now."],
    ["VM-HDFCBK", "Avl bal in your HDFC Bank A/c XX1234 is Rs.48,000.00 as on 20-10-26."],
  ];
  it.each(skip)("%s: %s", (address, body) => {
    expect(smsToCandidate(sms(address, body), rules)).toBeNull();
  });
});

describe("fingerprints", () => {
  it("are stable for the same SMS and differ by amount", () => {
    const a = smsToCandidate(sms("VK-SBIUPI", "A/C X1234 debited by 120.0 on date 20Oct26 trf to BLINKIT Refno 629377778888"), rules)!;
    const b = smsToCandidate(sms("VK-SBIUPI", "A/C X1234 debited by 120.0 on date 20Oct26 trf to BLINKIT Refno 629377778888"), rules)!;
    const c = smsToCandidate(sms("VK-SBIUPI", "A/C X1234 debited by 121.0 on date 20Oct26 trf to BLINKIT Refno 629377778889"), rules)!;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });
});

describe("balances", () => {
  it.each([
    ["VM-HDFCBK", "Update! INR 85,000.00 deposited in HDFC Bank A/c XX1234 on 01-OCT-26 for NEFT Cr. Avl bal INR 1,02,345.00", { bank: "HDFC", last4: "1234", kind: "account", balancePaise: 1_02_345_00 }],
    ["VM-HDFCBK", "Avl bal in your HDFC Bank A/c XX1234 is Rs.48,000.00 as on 20-10-26.", { last4: "1234", kind: "account", balancePaise: 48_000_00 }],
    ["BP-ATMSBI", "Rs.2000 withdrawn at SBI ATM from A/cX1234 on 20Oct26. Available Balance Rs.10500.", { bank: "SBI", kind: "account", balancePaise: 10_500_00 }],
    ["VM-ICICIT", "INR 2,340.00 spent using ICICI Bank Card XX9876 on 21-Oct-26 on UBER INDIA. Avl Limit: INR 1,45,660.00.", { bank: "ICICI", last4: "9876", kind: "card", balancePaise: 1_45_660_00 }],
  ])("%s: %s", (address, body, expected) => {
    expect(parseBalance({ address, body })).toMatchObject(expected);
  });

  it("ignores messages without a balance, OTPs and unknown senders", () => {
    expect(parseBalance({ address: "VM-HDFCBK", body: "Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY On 21/10/26" })).toBeNull();
    expect(parseBalance({ address: "VM-HDFCBK", body: "OTP 123456 for txn. Avl bal Rs.1,000 in A/c XX1234" })).toBeNull();
    expect(parseBalance({ address: "+919800000000", body: "Avl bal in A/c XX1234 is Rs.48,000.00" })).toBeNull();
  });
});

describe("merchant names", () => {
  it.each([
    ["Spent Rs.9,450.00 On HDFC Bank Card 4321 At MAKEMYTRIP INDI On 2026-10-21", "MakeMyTrip"],
    ["Spent Rs.499.00 On HDFC Bank Card 4321 At AMAZON PAY INDIA PRIVA On 2026-10-21", "Amazon Pay"],
    ["Spent Rs.299.00 On HDFC Bank Card 4321 At BUNDL TECHNOLOGIES PVT On 2026-10-21", "Swiggy"],
    ["Spent Rs.99.00 On HDFC Bank Card 4321 At CHAI POINT PVT LTD On 2026-10-21", "Chai Point"],
  ])("%s → %s", (body, name) => {
    expect(smsToCandidate(sms("VM-HDFCBK", body), rules)!.merchant).toBe(name);
  });
});
