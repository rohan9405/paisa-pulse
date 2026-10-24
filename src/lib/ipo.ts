import { bankForSender, findPayee, parseBankSms, type RawSms } from "./sms";
import { parseAmountToPaise } from "./money";
import type { FundHold, HoldEvent, Recurring } from "./types";

export interface IpoEvent extends HoldEvent {
  bank: string;
  account?: string;
  reference?: string;
  name: string;
  payee?: string;
  ambiguous?: boolean;
}

/** Only completed IPO/ASBA events, never a request, failure or future debit. */
export function parseIpoSms(sms: RawSms): IpoEvent | null {
  const bank = bankForSender(sms.address);
  const body = sms.body.replace(/\s+/g, " ").trim();
  if (!bank || !/\b(ipo|asba|initial public offer(?:ing)?)\b/i.test(body) || /\botp\b|failed|unsuccessful|could not|will be|to be (?:blocked|debited|unblocked)|request(?:ed)?\b/i.test(body)) return null;
  const type = /\b(unblocked|released|lien removed|lien revoked)\b/i.test(body) ? "released" : /\b(debited|deducted|paid)\b/i.test(body) ? "debited" : /\b(blocked|lien marked|lien created)\b/i.test(body) ? "blocked" : /\b(cancelled|revoked|expired)\b/i.test(body) ? "cancelled" : null;
  if (!type) return null;
  const amount = body.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
  const action = type === "released" ? "(?:unblocked|released)" : type === "debited" ? "(?:debited|deducted|paid)" : "blocked";
  const near = body.match(new RegExp(String.raw`(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:(?:has been|is|was|successfully)\s+){0,2}${action}\b`, "i"));
  const picked = near ?? amount;
  const amountPaise = picked ? parseAmountToPaise(picked[1]) ?? 0 : 0;
  const ambiguous = /\b(?:unblocked|released)\b/i.test(body) && /\b(?:debited|deducted|paid)\b/i.test(body);
  if (!amountPaise && type !== "cancelled") return null;
  const reference = body.match(/\b(?:umn|umrn|mandate (?:ref(?:erence)?|id)|application (?:id|no\.?))\s*[:#.-]?\s*([\w@.-]{5,})/i)?.[1]?.toLowerCase();
  const account = body.match(/\b(?:a\/c|acct|account)\s*[:#.-]?\s*[*xX]*(\d{3,6})\b/i)?.[1];
  const payee = findPayee(body);
  const name = body.match(/\b(?:for|towards|in favour of)\s+([a-z][a-z0-9 &.-]{1,55}?)\s+(?:ipo|asba)\b/i)?.[1]?.trim() ?? "IPO application";
  const payment = parseBankSms(sms)?.reference;
  // A mandate's block, allotment and release are each confirmed once. Repeated
  // bank acknowledgements with another inbox id must not double amounts.
  const id = reference ? `${bank}|${account ?? "unknown"}|${reference}|${type}|${amountPaise}|${type === "debited" ? payment ?? "allotment" : ""}` : `sms:${sms.id}:${sms.date}:${type}`;
  return { id, type, amountPaise, at: sms.date, raw: sms.body, bank, account, reference, name, payee, ambiguous };
}

export function summarizeHold(hold: Pick<FundHold, "events" | "reference">) {
  const events = [...hold.events].sort((a, b) => a.at - b.at);
  const blockedPaise = events.filter((e) => e.type === "blocked").at(-1)?.amountPaise ?? 0;
  const debitedPaise = events.filter((e) => e.type === "debited").reduce((s, e) => s + e.amountPaise, 0);
  const releasedPaise = events.filter((e) => e.type === "released").reduce((s, e) => s + e.amountPaise, 0);
  const remainingPaise = Math.max(0, blockedPaise - debitedPaise - releasedPaise);
  const needsReview = !hold.reference || !blockedPaise || debitedPaise + releasedPaise > blockedPaise || (events.some((e) => e.type === "cancelled") && remainingPaise > 0);
  const status: FundHold["status"] = needsReview ? "needs_review" : remainingPaise > 0 ? debitedPaise || releasedPaise ? "partial" : "blocked" : debitedPaise > 0 ? "settled" : "released";
  return { blockedPaise, debitedPaise, releasedPaise, remainingPaise, needsReview, status };
}

/** Explicit user classification wins; otherwise only a matching confirmed hold
 * reference can identify an older mandate as an IPO. No amount/name guessing. */
export function isIpoMandate(r: Recurring, holds: FundHold[] = []): boolean {
  if (r.purpose) return r.purpose === "ipo";
  return !!r.mandateRef && holds.some(h => h.reference?.toLowerCase() === r.mandateRef!.toLowerCase() && (!r.bank || h.bank === r.bank));
}
