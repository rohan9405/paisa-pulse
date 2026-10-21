/**
 * Bank SMS → transaction. Runs on-device only; the Android shell hands us the
 * raw inbox rows (see android/) and nothing leaves the phone.
 *
 * We only trust messages from known bank sender IDs (e.g. "VM-HDFCBK-S"), skip
 * OTPs, offers, reminders and failed/declined attempts, and read amount,
 * direction, account, counterparty and bank reference from the body.
 */
import { type DateKey, toISTKey } from "./dates";
import { type Paise, parseAmountToPaise } from "./money";
import { categorize, detectMethod, extractMerchant } from "./categorize";
import { cleanMerchantName } from "./merchants";
import type { CategoryRule, PaymentMethod, TxnKind } from "./types";

export interface RawSms {
  /** Inbox row id on the phone. */
  id: string;
  /** Sender, e.g. "VM-HDFCBK" or "JD-ICICIT-S". */
  address: string;
  body: string;
  /** Received time, epoch ms. */
  date: number;
}

export type Bank = "HDFC" | "ICICI" | "SBI" | "Axis" | "Kotak";

/** Sender-ID cores after stripping the operator prefix ("VM-") and the DLT suffix ("-S"). */
const SENDERS: [RegExp, Bank][] = [
  [/^HDFC(BK|BN|CC|SC)?$/, "HDFC"],
  [/^ICICI[A-Z]?$|^ICICBK$|^ICIOTP$/, "ICICI"],
  [/^(SBI[A-Z]*|ATMSBI|CBSSBI|SBMSBI|SBICRD|CRDSBI)$/, "SBI"],
  [/^AXIS[A-Z]*$/, "Axis"],
  [/^KOTAK[A-Z]*$/, "Kotak"],
];

export function bankForSender(address: string): Bank | null {
  const parts = address.toUpperCase().split("-").filter(Boolean);
  // "VM-HDFCBK-S" → "HDFCBK"; "HDFCBK" → "HDFCBK".
  const core = parts.length >= 2 && parts[0].length === 2 ? parts[1] : parts[0];
  if (!core) return null;
  for (const [re, bank] of SENDERS) if (re.test(core)) return bank;
  return null;
}

export interface ParsedSms {
  bank: Bank;
  direction: "out" | "in";
  amountPaise: Paise;
  /** Last digits of the account / card, when present. */
  account?: string;
  isCard: boolean;
  counterparty?: string;
  reference?: string;
  method: PaymentMethod;
  /** Credit-card bill payments (either side) — moving money between your own accounts. */
  cardBillPayment: boolean;
  refund: boolean;
  /** Money moved into UPI Lite. Lite payments themselves send no bank SMS, so the top-up is counted as the spend. */
  upiLiteTopUp: boolean;
}

/** Messages that mention money but aren't a completed transaction. */
const NOT_A_TXN = [
  /\botp\b|one[\s-]time password|verification code|\bcode is\b/i,
  /\b(declined|failed|unsuccessful|not processed|could not be processed|insufficient)\b/i,
  /\b(requested|request(ed)? money|collect request|has requested)\b/i,
  /\b(will be debited|to be debited|is due|due on|due date|due by|min(imum)?\.? amt|minimum amount|total amt due|statement (is|for|generated))\b/i,
  /\b(pre-?approved|eligible|apply now|offer|congratulations|you (have )?won|voucher|reward points?)\b/i,
  /\b(mandate|autopay|e-?mandate|standing instruction)\b.*\b(created|registered|set up|successfully registered|scheduled)\b/i,
];

const DEBIT = /\b(debited|spent|sent|withdrawn|paid|purchase|txn of|transaction of|used for|deducted)\b/i;
const CREDIT = /\b(credited|received|deposited|refund(ed)?|revers(ed|al))\b/i;

export function parseBankSms(sms: Pick<RawSms, "address" | "body">): ParsedSms | null {
  const bank = bankForSender(sms.address);
  if (!bank) return null;
  const body = sms.body.replace(/\s+/g, " ").trim();
  if (NOT_A_TXN.some((re) => re.test(body))) return null;

  // "UPI LITE top-up amounting to Rs 1850.00 is successful" has no debit wording at all.
  const upiLiteTopUp = /\bupi\s*lite\b/i.test(body) && /\b(top-?\s?up|topped up|add(ed)? money|loaded)\b/i.test(body);
  const d = upiLiteTopUp ? 0 : body.search(DEBIT);
  const c = body.search(CREDIT);
  if (d < 0 && c < 0) return null;
  // ICICI: "Acct XX1 debited for Rs 250 ...; SWIGGY credited." — whichever comes first wins.
  const direction: "out" | "in" = d >= 0 && (c < 0 || d < c) ? "out" : "in";

  const amountPaise = findAmount(body);
  if (!amountPaise) return null;

  // A bank-account alert that merely mentions a card (e.g. paying the card bill) isn't a card spend.
  const isCard = /\bcard\b/i.test(body) && !/\b(a\/c|acct|account)\b/i.test(body);
  const cardBillPayment = /(credit card|card) (bill|payment)|payment (of|for) .{0,30}received .{0,30}(credit )?card|towards your .{0,20}card|\bcc (bill|payment)\b|creditcard/i.test(body);
  const refund = direction === "in" && /\b(refund(ed)?|revers(ed|al)|cashback|chargeback)\b/i.test(body);

  return {
    bank,
    direction,
    amountPaise,
    account: findAccount(body),
    isCard,
    counterparty: findCounterparty(body, direction),
    reference: findReference(body),
    method: findMethod(body, isCard),
    cardBillPayment,
    refund,
    upiLiteTopUp,
  };
}

export interface ParsedBalance {
  bank: Bank;
  last4: string;
  kind: "account" | "card";
  balancePaise: Paise;
}

/**
 * "Avl bal INR 1,02,345.00", "Bal Rs.48,501.00", "Avl Limit: INR 1,45,660.00",
 * "Avl bal in your HDFC Bank A/c XX1234 is Rs.48,000.00". Works on transaction
 * alerts and balance-only messages alike; needs the account/card digits.
 */
export function parseBalance(sms: Pick<RawSms, "address" | "body">): ParsedBalance | null {
  const bank = bankForSender(sms.address);
  if (!bank) return null;
  const body = sms.body.replace(/\s+/g, " ").trim();
  if (NOT_A_TXN[0].test(body) || NOT_A_TXN[4].test(body)) return null; // OTPs, offers
  const m = body.match(/\b(?:avl|avbl|avail(?:able)?|clear|closing)?\.?\s*(bal(?:ance)?|lmt|limit)\b.{0,60}?(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
  const last4 = findAccount(body);
  if (!m || !last4) return null;
  const balancePaise = parseAmountToPaise(m[2]);
  if (balancePaise === null) return null;
  const card = /lmt|limit/i.test(m[1]) || (/\bcard\b/i.test(body) && !/\b(a\/c|acct|account)\b/i.test(body));
  return { bank, last4, kind: card ? "card" : "account", balancePaise };
}

/** First money amount that isn't a balance or limit. Handles "Rs.1,234.50", "INR 500", "₹99", and SBI's "debited by 250.0". */
function findAmount(body: string): Paise | null {
  const re = /(?:(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?))|(?:\b(?:debited|credited) by\s+(?:rs\.?\s*|inr\s*|₹\s*)?([\d,]+(?:\.\d{1,2})?))/gi;
  for (const m of body.matchAll(re)) {
    const before = body.slice(Math.max(0, m.index! - 24), m.index).toLowerCase();
    if (/(bal(ance)?|avl|available|limit|outstanding)[\s:.]*(is|of)?[\s:.]*$/.test(before)) continue;
    const p = parseAmountToPaise(m[1] ?? m[2]);
    if (p && p > 0) return p;
  }
  return null;
}

function findAccount(body: string): string | undefined {
  // "A/c XX1234", "A/cX1234" (SBI), "Acct XX567", "Card ending 4321", "A/C *1234"
  const m = body.match(/\b(?:a\/c|acct|account|card)(?:\s*(?:no\.?|number|ending(?:\s*with)?))?[\s:.*x]*(\d{3,6})\b/i);
  return m?.[1];
}

function findReference(body: string): string | undefined {
  const m = body.match(/\b(?:upi\s*ref(?:erence)?|ref(?:erence)?|refno|rrn|txn\s*(?:id|no)|upi)\b[\s:.#-]*(?:no\.?|number|id)?[\s:.#-]*(?:is\s+)?(\d{6,})/i);
  return m?.[1];
}

function findMethod(body: string, isCard: boolean): PaymentMethod {
  if (/\b(upi|vpa)\b|@[a-z]{2,}/i.test(body)) return "upi";
  if (/\batm\b|cash withdrawal|withdrawn/i.test(body)) return "cash";
  if (isCard) return "card";
  if (/\b(neft|imps|rtgs|net ?banking|nach|ach)\b/i.test(body)) return "netbanking";
  return detectMethod(body);
}

const STOP = String.raw`(?=\s+(?:on|via|using|thru|through|towards|ref|refno|upi|txn|avl|avbl|bal|from|for|info|not|if|call|dated|at)\b|[.;,(]|\s*-\s*[A-Z]|$)`;

function findCounterparty(body: string, direction: "out" | "in"): string | undefined {
  const tries: RegExp[] =
    direction === "out"
      ? [
          /;\s*([^;.]+?)\s+credited\b/i, // ICICI
          new RegExp(String.raw`\bon\s+\d{1,2}[-\/ ]?[a-z0-9]{2,3}[-\/ ]?\d{2,4}\s+(?:on|at)\s+([A-Za-z0-9][\w&.' *\-]{1,50}?)${STOP}`, "i"), // ICICI card: "on 20-Oct-26 on UBER"
          new RegExp(String.raw`\bto\s+vpa\s+([\w.\-]+@[\w]+)`, "i"),
          new RegExp(String.raw`\b(?:at|to|towards|trf to|transfer to)\s+([A-Za-z0-9@][\w&.@' *\-]{1,50}?)${STOP}`, "i"),
          /\binfo[:\s-]+([^.]+)/i,
        ]
      : [
          new RegExp(String.raw`\bvpa\s+([\w.\-]+@[\w]+)`, "i"),
          new RegExp(String.raw`\b(?:from|by)\s+([A-Za-z@][\w&.@' *\-]{1,50}?)${STOP}`, "i"),
          /\binfo[:\s-]+([^.]+)/i,
        ];
  for (const re of tries) {
    const raw = body.match(re)?.[1]?.trim();
    if (!raw) continue;
    // "to HDFC Bank A/C", "from your a/c" — that's the user's own account, not a counterparty.
    if (/\b(a\/c|acct|account|your|card|bank a)\b|^(hdfc|icici|sbi|axis|kotak)( bank)?$/i.test(raw)) continue;
    const name = cleanCounterparty(raw);
    if (name) return name;
  }
  return undefined;
}

function cleanCounterparty(raw: string): string | undefined {
  if (/^upi[\/\- :]/i.test(raw)) return extractMerchant(raw);
  const vpa = raw.match(/^([\w.\-]+)@[\w]+$/);
  if (vpa) {
    const local = vpa[1].replace(/^(paytmqr|paytm|q\d+|bharatpe|gpay|pay)[.\-]?/i, "").replace(/[\d._\-]+/g, " ").trim();
    return local.length >= 3 ? cleanMerchantName(local) : undefined;
  }
  // "WWW MYNTRA COM" → "Myntra"
  const s = raw.replace(/\*+/g, " ").replace(/\s+/g, " ").trim().replace(/^www[.\s]+/i, "").replace(/[.\s]+(com|in|co[.\s]in|net)$/i, "");
  if (!/[a-z]/i.test(s)) return undefined;
  return cleanMerchantName(s.slice(0, 40));
}

export interface SmsCandidate {
  date: DateKey;
  amountPaise: Paise;
  direction: "out" | "in";
  kind: TxnKind;
  merchant: string;
  category: string;
  method: PaymentMethod;
  reference?: string;
  /** Stable per SMS: received time + direction + amount. */
  fingerprint: string;
  raw: string;
}

/** Parse and classify one SMS. Returns null for anything that isn't a completed bank transaction. */
export function smsToCandidate(sms: RawSms, rules: CategoryRule[]): SmsCandidate | null {
  const p = parseBankSms(sms);
  if (!p) return null;
  const merchant = p.upiLiteTopUp ? "UPI Lite top-up" : (p.counterparty ?? (p.method === "cash" ? "ATM cash" : `${p.bank} ${p.direction === "out" ? "debit" : "credit"}`));
  const rule = categorize(`${merchant} ${sms.body}`, rules);

  let kind: TxnKind = p.direction === "out" ? "expense" : "income";
  // Same precedence as CSV import (csv.ts validateRows).
  if (rule?.kind && (rule.kind === "transfer" || (p.direction === "out" && rule.kind !== "income" && rule.kind !== "refund") || (p.direction === "in" && rule.kind === "income"))) kind = rule.kind;
  if (p.refund) kind = "refund";
  // Money back from a shop or service (e.g. "credited … from WWW MYNTRA COM") is a refund, not income.
  if (p.direction === "in" && rule && !rule.kind && rule.category !== "Income") kind = "refund";
  // Paying a card bill: the card spends were already counted when they happened.
  if (p.cardBillPayment) kind = "transfer";

  let category = kind === "transfer" ? "Transfers" : kind === "refund" ? "Refunds" : kind === "income" && !rule ? "Income" : (rule?.category ?? "Other");
  if (p.upiLiteTopUp) [kind, category] = ["expense", "Bills & Utilities"];

  return {
    date: toISTKey(sms.date),
    amountPaise: p.amountPaise,
    direction: p.direction,
    kind,
    merchant,
    category,
    method: p.method,
    reference: p.reference,
    fingerprint: `sms|${sms.date}|${p.direction}|${p.amountPaise}`,
    raw: sms.body,
  };
}
