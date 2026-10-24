/**
 * Bank SMS → transaction. Runs on-device only; the Android shell hands us the
 * raw inbox rows (see android/) and nothing leaves the phone.
 *
 * We only trust messages from known bank sender IDs (e.g. "VM-HDFCBK-S"), skip
 * OTPs, offers, reminders and failed/declined attempts, and read amount,
 * direction, account, counterparty and bank reference from the body.
 */
import { getConfig } from "./remoteConfig";
import { type DateKey, toISTKey, isDateKey } from "./dates";
import { type Paise, parseAmountToPaise } from "./money";
import { categorize, detectMethod, extractMerchant, outflowKind } from "./categorize";
import { cleanMerchantName } from "./merchants";
import type { CategoryRule, PaymentMethod, TxnKind, Recurring } from "./types";

export interface RawSms {
  /** Inbox row id on the phone. */
  id: string;
  /** Sender, e.g. "VM-HDFCBK" or "JD-ICICIT-S". */
  address: string;
  body: string;
  /** Received time, epoch ms. */
  date: number;
}

/** Built-in banks; the remote config can add more (any name). */
export type Bank = "HDFC" | "ICICI" | "SBI" | "Axis" | "Kotak" | (string & {});

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
  return getConfig().banks.find((b) => b.sender === core)?.bank ?? null;
}

export interface ParsedSms {
  bank: Bank;
  direction: "out" | "in";
  amountPaise: Paise;
  /** Last digits of the account / card, when present. */
  account?: string;
  isCard: boolean;
  counterparty?: string;
  /** Lowercased UPI ID of the other side, when the message shows one. */
  payee?: string;
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
  const lower = body.toLowerCase();
  if (getConfig().smsIgnore.some((p) => lower.includes(p))) return null;

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
    payee: findPayee(body),
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

/** Text right before the merchant name in some debit SMS ("on 20-Oct-26 VIN*NETFLIX"). Owned by the remote config; none built in. */
const merchantMarkers = () => getConfig().merchantMarkers;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const STOP = String.raw`(?=\s+(?:on|via|using|thru|through|towards|ref|refno|upi|txn|avl|avbl|bal|from|for|info|not|if|call|dated|at)\b|[.;,(]|\s*-\s*[A-Z]|$)`;

function findCounterparty(body: string, direction: "out" | "in"): string | undefined {
  const tries: RegExp[] =
    direction === "out"
      ? [
          /;\s*([^;.]+?)\s+credited\b/i, // ICICI
          new RegExp(String.raw`\bon\s+\d{1,2}[-\/ ]?[a-z0-9]{2,3}[-\/ ]?\d{2,4}\s+(?:on|at)\s+([A-Za-z0-9][\w&.' *\-]{1,50}?)${STOP}`, "i"), // ICICI card: "on 20-Oct-26 on UBER"
          ...merchantMarkers().map((m) => new RegExp(String.raw`${escapeRegExp(m)}\s*([A-Za-z0-9][\w&.' *\-]{1,50}?)${STOP}`, "i")),
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

/** First UPI ID in the message ("ramesh.k@okaxis"); email addresses don't count. */
export function findPayee(body: string): string | undefined {
  const m = body.match(/(?:^|[\s:(])([a-z0-9][\w.\-]{1,}@[a-z]{2,})(?![\w.@])/i);
  return m?.[1].toLowerCase();
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
  tag?: string;
  payee?: string;
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
  const rule = categorize(`${merchant} ${sms.body}`, rules, p.payee, { merchant, direction: p.direction });

  let kind: TxnKind = p.direction === "out" ? "expense" : "income";
  // Same precedence as CSV import (csv.ts validateRows).
  if (rule?.kind && (rule.kind === "transfer" || (p.direction === "out" && rule.kind !== "income" && rule.kind !== "refund") || (p.direction === "in" && rule.kind === "income"))) kind = rule.kind;
  if (p.refund) kind = "refund";
  // Money back from a shop or service (e.g. "credited … from WWW MYNTRA COM") is a refund, not income.
  if (p.direction === "in" && rule && !rule.kind && rule.category !== "Income") kind = "refund";
  // A rule that only sets Investments / Savings still makes the payment an investment.
  if (p.direction === "out" && kind === "expense" && rule && !rule.kind) kind = outflowKind(rule.category);
  // Paying a card bill: the card spends were already counted when they happened.
  if (p.cardBillPayment) kind = "transfer";

  let category = kind === "transfer" ? "Transfers" : kind === "refund" ? "Refunds" : kind === "income" && !rule ? "Income" : (rule?.category ?? "Other");
  let tag = kind === "transfer" || kind === "refund" ? undefined : rule?.tag;
  // Lite payments send no SMS, so the top-up stands in for the everyday spends it pays for.
  if (p.upiLiteTopUp) [kind, category, tag] = ["expense", "Other", "UPI Lite"];

  return {
    date: toISTKey(sms.date),
    amountPaise: p.amountPaise,
    direction: p.direction,
    kind,
    merchant,
    category,
    tag,
    payee: p.payee,
    method: p.method,
    reference: p.reference,
    fingerprint: `sms|${sms.date}|${p.direction}|${p.amountPaise}`,
    raw: sms.body,
  };
}

// ------------------------------------------------------------- mandates

export interface ParsedMandate {
  bank: Bank;
  event: "created" | "modified" | "revoked";
  /** Mandate amount (for "up to" mandates, the maximum). */
  amountPaise: Paise | null;
  /** Who it pays, e.g. "Netflix", "Groww". */
  name?: string;
  payee?: string;
  frequency: Recurring["frequency"];
  /** UMN / UMRN / mandate reference. */
  ref?: string;
  /** First / next debit date if the message says so. */
  startDate?: DateKey;
}

const MANDATE = /\b(mandate|auto\s?pay|e-?mandate|si\b|standing instruction|nach)\b/i;

/**
 * Autopay / e-mandate / standing-instruction set-up, change or cancellation.
 * These aren't transactions; they tell us a regular payment exists.
 */
export function parseMandate(sms: Pick<RawSms, "address" | "body" | "date">): ParsedMandate | null {
  const bank = bankForSender(sms.address);
  if (!bank) return null;
  const body = sms.body.replace(/\s+/g, " ").trim();
  if (!MANDATE.test(body) || NOT_A_TXN[0].test(body) || /\b(ipo|asba)\b/i.test(body) || /\b(failed|unsuccessful|could not)\b/i.test(body)) return null;
  let event: ParsedMandate["event"] | null = null;
  if (/\b(revoked|cancell?ed|deleted|paused|deactivated|stopped)\b/i.test(body)) event = "revoked";
  else if (/\b(modified|updated|amended|changed)\b/i.test(body)) event = "modified";
  else if (/\b(created|registered|set ?up|activated|approved|successful(ly)?)\b/i.test(body)) event = "created";
  if (!event) return null;
  // A debit made under a mandate is a transaction, handled by parseBankSms.
  if (/\b(debited|deducted|paid|spent)\b/i.test(body) && event === "created" && !/\b(mandate|auto\s?pay)\b.{0,40}\b(created|registered|set ?up)/i.test(body)) return null;

  const freq = body.match(/\b(daily|weekly|monthly|quarterly|half[- ]?yearly|yearly|annually|annual|one[- ]?time|once|as presented)\b/i)?.[1].toLowerCase();
  const frequency: ParsedMandate["frequency"] = !freq || freq === "as presented" ? "unknown" : /one|once/.test(freq) ? "once" : freq.startsWith("daily") ? "daily" : freq.startsWith("week") ? "weekly" : freq.startsWith("quarter") ? "quarterly" : freq.startsWith("half") ? "half-yearly" : /year|annual/.test(freq) ? "yearly" : "monthly";
  // Most specific wording first; "for Rs 649" or "to your a/c" aren't names.
  let name: string | undefined;
  for (const kw of ["towards", "in favou?r of", "for merchant", "payee", "for", "to"]) {
    for (const m of body.matchAll(new RegExp(String.raw`\b(?:${kw})\s*:?\s+([A-Za-z][\w&.' \-]{1,40}?)${STOP}`, "gi"))) {
      if (/^(rs|inr|your|a\/c|account|upi|the|mandate|auto ?pay|frequency|amount|max)\b/i.test(m[1])) continue;
      name = cleanCounterparty(m[1]);
      if (name) break;
    }
    if (name) break;
  }
  const ref = body.match(/\b(?:umn|umrn|mandate (?:ref(?:erence)?|id)|ref(?:erence)? no\.?)[\s:#.-]*([A-Za-z0-9@.\-]{6,})/i)?.[1];
  const dateM = body.match(/\b(?:from|starting|start date|first debit|next debit|on)\s*(?:on|:)?\s*(\d{1,2})[-\/ ]([a-z]{3}|\d{1,2})[-\/ ](\d{2,4})\b/i);
  let startDate: DateKey | undefined;
  if (dateM) {
    const mon = /^\d+$/.test(dateM[2]) ? Number(dateM[2]) : ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(dateM[2].toLowerCase()) + 1;
    const yr = dateM[3].length === 2 ? 2000 + Number(dateM[3]) : Number(dateM[3]);
    if (mon >= 1 && mon <= 12) startDate = `${yr}-${String(mon).padStart(2, "0")}-${String(Number(dateM[1])).padStart(2, "0")}`;
  }
  if (startDate && !isDateKey(startDate)) startDate = undefined;
  return { bank, event, amountPaise: findAmount(body), name, payee: findPayee(body), frequency, ref, startDate };
}
