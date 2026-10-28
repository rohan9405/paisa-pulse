import { isReimbursementKind } from "@/lib/reimbursements";
/**
 * Bank SMS provider. Only available inside the Android app (android/), which
 * exposes the phone's SMS inbox to the page as `window.PaisaSms`. Messages are
 * read and parsed on the device; nothing is uploaded anywhere.
 */
import { acceptedCandidate } from "@/features/accounts/recovery";
import { autoLinkRefund, learnFromLinked } from "@/lib/match";
import { toISTKey } from "@/lib/dates";
import { categorize } from "@/lib/categorize";
import { parseIpoSms } from "@/lib/ipo";
import { applyIpoEvent } from "../holds";
import { getConfig } from "@/lib/remoteConfig";
import { type SmsCandidate, type ParsedMandate, type RawSms, parseBalance, parseMandate, smsToCandidate } from "@/lib/sms";
import { type Account, DEFAULT_PREFS, type Transaction } from "@/lib/types";
import { type FinanceDB, uid } from "../db";
import { applyMandate } from "../repo";

export interface SmsBridge {
  hasPermission(): boolean;
  /** Shows Android's permission prompt; the app fires `paisa-sms-permission` when answered. */
  requestPermission(): void;
  /** JSON SmsPage: messages received strictly after `sinceMs`, oldest first, scanning at most `limit` inbox rows. */
  list(sinceMs: number, limit: number): string;
}

interface SmsPage {
  /** Non-personal senders only (phone numbers are dropped on the device side). */
  messages: RawSms[];
  /** Received time of the last inbox row scanned; the next page starts after it. */
  until: number;
  more: boolean;
}

declare global {
  interface Window {
    PaisaSms?: SmsBridge;
  }
}

export function smsBridge(): SmsBridge | null {
  return typeof window !== "undefined" && window.PaisaSms ? window.PaisaSms : null;
}

const PAGE = 500;
/** Bump when the parser learns new message formats: the next sync re-reads the inbox once. */
export const SMS_PARSER_VERSION = 5;
let queue: Promise<unknown> = Promise.resolve();

/**
 * Pull new bank SMS since the last cursor. If the tracking start has moved
 * earlier than anything scanned so far, first backfill from the new start.
 * Returns how many transactions were added. Calls run one at a time.
 */
export function syncSms(db: FinanceDB): Promise<number> {
  // A home-widget job and the foreground app may use separate WebViews.
  // The origin-wide lock keeps their cursor/deduplication writes serial too.
  const next = queue.then(async () => typeof navigator !== "undefined" && navigator.locks?.request
    ? await navigator.locks.request("drip-bank-sms-sync", () => doSync(db))
    : await doSync(db));
  queue = next.catch(() => undefined);
  return next;
}

const istMidnight = (k: string) => Date.parse(`${k}T00:00:00+05:30`);

async function doSync(db: FinanceDB): Promise<number> {
  const bridge = smsBridge();
  if (!bridge) return 0;
  const profile = await db.profile.get("me");
  if (!profile) return 0;
  const conn = await db.connections.get("sms");
  if (!bridge.hasPermission()) {
    if (conn?.status !== "disconnected" || conn.lastError !== "SMS permission not granted") await db.connections.put({ ...conn, providerId: "sms", status: "disconnected", lastError: "SMS permission not granted" });
    return 0;
  }

  const startOfTracking = istMidnight(profile.trackingStart) - 1;
  const from = conn?.syncedFrom;
  // Config/parser releases never rescan history. Only an explicit earlier start
  // or balance preference can request a backfill; existing transactions stay intact.
  const balanceOnly = !!from && !!conn?.balancesRescan;
  const metadataBackfill = !!from && conn?.accountMetadataVersion !== 2;
  const ranges: [number, number][] = [];
  if (!from || balanceOnly || metadataBackfill) ranges.push([Math.min(startOfTracking, from ? istMidnight(from) - 1 : startOfTracking), Infinity]);
  else {
    if (profile.trackingStart < from) ranges.push([startOfTracking, istMidnight(from)]);
    ranges.push([Math.max(Number(conn?.cursor ?? 0), startOfTracking), Infinity]);
  }
  const pages: RawSms[] = [];
  let scannedUntil = Number(conn?.cursor ?? startOfTracking);
  try {
    for (const [after, before] of ranges) {
      let scan = after;
      for (;;) {
        const page = JSON.parse(bridge.list(scan, PAGE)) as SmsPage;
        pages.push(...page.messages.filter((m) => m.date < before));
        scannedUntil = Math.max(scannedUntil, Math.min(page.until, before));
        if (!page.more || page.until <= scan || page.until >= before) break;
        scan = page.until;
      }
    }
  } catch (e) {
    await db.connections.put({ ...conn, providerId: "sms", status: "error", lastError: String(e) });
    throw e;
  }
  if (!pages.length && from && scannedUntil === Number(conn?.cursor ?? startOfTracking) && !balanceOnly && !metadataBackfill && profile.trackingStart >= from && conn?.status === "connected") return 0;
  // Only now load classification/dedup data: an empty minute tick does no table scans.
  let cursor = scannedUntil;
  const rules = await db.rules.toArray();
  const existing = await db.txns.toArray();
  const byFp = new Map(existing.filter((t) => t.fingerprint).map((t) => [t.fingerprint!, t]));
  const byRef = new Map(existing.filter((t) => t.source.externalRef).map((t) => [`${t.accountId ?? "unknown"}|${t.direction ?? (t.kind === "income" || isReimbursementKind(t.kind) ? "in" : "out")}|${t.source.externalRef!}`, t]));
  // Transactions you deleted are never brought back.
  const dismissed = new Set(conn?.dismissed ?? []);
  const batchId = uid("sms-");
  const created: Transaction[] = [];
  const readBalances = getConfig().features.balances && (profile.prefs?.balances ?? DEFAULT_PREFS.balances);
  const balances = new Map<string, Account>();
  const mandates: { m: ParsedMandate; on: string }[] = [];
  const ipoEvents: { event: NonNullable<ReturnType<typeof parseIpoSms>>; txnId?: string }[] = [];
  for (const sms of pages) {
    if (readBalances) {
      const b = parseBalance(sms);
      if (b) {
        const id = `${b.bank}-${b.kind}-${b.last4}`;
        if (sms.date >= (balances.get(id)?.asOf ?? 0)) balances.set(id, { id, bank: b.bank, last4: b.last4, kind: b.kind, balancePaise: b.balancePaise, asOf: sms.date });
      }
    }
    if (balanceOnly || sms.date <= startOfTracking) continue;
    const ipo = parseIpoSms(sms);
    if (ipo && ipo.type !== "debited") { ipoEvents.push({ event: ipo }); continue; }
    const mandate = ipo ? null : parseMandate(sms);
    if (mandate) { mandates.push({ m: mandate, on: toISTKey(sms.date) }); continue; }
    let c: SmsCandidate | null = smsToCandidate(sms, rules);
    if(!c){const learned=acceptedCandidate(sms,profile.acceptedSmsRules??[]);if(learned)c={...learned,date:toISTKey(sms.date),kind:learned.direction==='in'?'income':'expense',category:learned.direction==='in'?'Income':'Other',fingerprint:`sms|${sms.date}|${learned.direction}|${learned.amountPaise}`,raw:sms.body,bank:learned.bank,accountDigits:learned.accountNumber,accountKind:learned.kind,occurredAt:sms.date};}
    if (ipo) {
      c ??= { date: toISTKey(sms.date), amountPaise: ipo.amountPaise, direction: "out", kind: "investment", merchant: ipo.name, category: "Investments", tag: "IPO", payee: ipo.payee, method: "upi", fingerprint: `sms|${sms.date}|out|${ipo.amountPaise}`, raw: sms.body, reference: ipo.reference ? `${ipo.reference}:debit:${ipo.amountPaise}` : undefined };
      c = { ...c, reference: c.reference ?? `ipo:${ipo.bank}:${ipo.id}` };
      const personal = categorize(`${c.merchant} ${sms.body}`, rules.filter((r) => !r.builtIn), c.payee, { merchant: c.merchant, direction: "out" });
      if (!personal) c = { ...c, kind: "investment", category: "Investments", tag: "IPO" };
    }
    if (!c || dismissed.has(c.fingerprint)) { if (ipo) ipoEvents.push({ event: ipo }); continue; }
    const storageFingerprint = `${c.fingerprint}|${c.accountId ?? "unknown"}|${sms.id}`;
    if(dismissed.has(storageFingerprint))continue;
    const legacy = byFp.get(c.fingerprint);
    const sameLegacy = legacy && (legacy.source.raw === sms.body || (legacy.accountId === c.accountId && !!c.accountId && legacy.amountPaise === c.amountPaise));
    const already = byFp.get(storageFingerprint) ?? (sameLegacy ? legacy : undefined) ?? (c.reference ? byRef.get(`${c.accountId ?? "unknown"}|${c.direction}|${c.reference}`) : undefined) ?? existing.find(t=>t.source.providerId==='sms' && t.source.raw===sms.body && t.date===c!.date && t.amountPaise===c!.amountPaise);
    if (already) {
      if(!already.accountMappingEdited&&!already.accountId&&c.accountId){
        await db.txns.update(already.id,{accountId:c.accountId,direction:c.direction,occurredAt:sms.date,source:{...already.source,sender:sms.address}});
      }
      if(c.accountId&&c.bank&&c.accountDigits&&c.accountKind&&!balances.has(c.accountId))balances.set(c.accountId,{id:c.accountId,bank:c.bank,last4:c.accountDigits,kind:c.accountKind,balancePaise:0,asOf:0,balanceKnown:false,ownerConfirmed:false});
      if (ipo) ipoEvents.push({ event: ipo, txnId: already.id }); continue;
    }
    // Existing history is enriched only. Parser/account upgrades never import missed historical rows silently.
    if(metadataBackfill&&sms.date<=Number(conn?.cursor??0))continue;
    if(c.accountId&&c.bank&&c.accountDigits&&c.accountKind&&!balances.has(c.accountId))balances.set(c.accountId,{id:c.accountId,bank:c.bank,last4:c.accountDigits,kind:c.accountKind,balancePaise:0,asOf:0,balanceKnown:false,ownerConfirmed:false});
    const now = Date.now();
    let t: Transaction = { accountId:c.accountId,direction:c.direction,occurredAt:sms.date,accountingPending:c.accountingPending,needsReview:c.accountingPending||undefined,reviewReason:c.accountingPending?'Card payment: confirm ownership and classification before counting':undefined,id: uid("t-"), date: c.date, amountPaise: c.amountPaise, kind: c.kind, merchant: c.merchant, category: c.category, tag: c.tag, payee: c.payee, method: c.method, fingerprint:storageFingerprint, source: { providerId: "sms", sender:sms.address,importBatchId: batchId, externalRef: c.reference, raw: c.raw, importedAt: now }, createdAt: now, updatedAt: now };
    if (isReimbursementKind(t.kind)) t = { ...t, ...autoLinkRefund(t, [...existing, ...created, t]) };
    created.push(t);
    byFp.set(storageFingerprint, t);
    if (c.reference) byRef.set(`${c.accountId ?? "unknown"}|${c.direction}|${c.reference}`, t);
    if (ipo) ipoEvents.push({ event: ipo, txnId: t.id });
  }

  let changed = false;
  await db.transaction("rw", [db.txns, db.connections, db.accounts, db.recurring, db.holds], async () => {
    for (const { m, on } of mandates) changed = (await applyMandate(db, m, on, rules)) || changed;
    for (const { event, txnId } of ipoEvents) {
      const id = await applyIpoEvent(db, event);
      const t = created.find((row) => row.id === txnId);
      if (t) t.holdId = id;
      changed = true;
    }
    if (created.length) await db.txns.bulkAdd(created);
    for (const a of balances.values()) {
      const known = await db.accounts.get(a.id);
      if (!known || known.asOf < a.asOf) { await db.accounts.put({...known,...a,ownerConfirmed:known?.ownerConfirmed??false,alias:known?.alias,balanceKnown:a.balanceKnown??true,balanceSource:"sms"}); changed = true; }
    }
    await db.connections.put({
      ...conn,
      providerId: "sms",
      status: "connected",
      lastSyncAt: created.length || changed ? Date.now() : conn?.lastSyncAt,
      lastCount: created.length || conn?.lastCount,
      lastError: undefined,
      cursor: String(Math.max(cursor, Number(conn?.cursor ?? 0))),
      syncedFrom: from && from < profile.trackingStart ? from : profile.trackingStart,
      parserVersion: SMS_PARSER_VERSION,
      accountMetadataVersion: 2,
      balancesRescan: false,
    });
  });
  // Only newly imported payments can learn a previous user-linked plan line.
  if (created.length) {
    const ids = new Set(created.map((t) => t.id));
    const learned = learnFromLinked([...existing, ...created]).filter((t) => ids.has(t.id));
    if (learned.length) await db.txns.bulkPut(learned);
  }
  return created.length;
}
