/**
 * Bank SMS provider. Only available inside the Android app (android/), which
 * exposes the phone's SMS inbox to the page as `window.PaisaSms`. Messages are
 * read and parsed on the device; nothing is uploaded anywhere.
 */
import { autoLinkRefund } from "@/lib/match";
import { toISTKey } from "@/lib/dates";
import { type ParsedMandate, type RawSms, parseBalance, parseMandate, smsToCandidate } from "@/lib/sms";
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
export const SMS_PARSER_VERSION = 4;
let queue: Promise<unknown> = Promise.resolve();

/**
 * Pull new bank SMS since the last cursor. If the tracking start has moved
 * earlier than anything scanned so far, first backfill from the new start.
 * Returns how many transactions were added. Calls run one at a time.
 */
export function syncSms(db: FinanceDB): Promise<number> {
  const next = queue.then(() => doSync(db));
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
    await db.connections.put({ ...conn, providerId: "sms", status: "disconnected", lastError: "SMS permission not granted" });
    return 0;
  }

  const startOfTracking = istMidnight(profile.trackingStart) - 1;
  const from = conn?.syncedFrom;
  // A newer parser re-reads everything already scanned once, to pick up messages it used to miss.
  const reread = !!from && (conn?.parserVersion ?? 1) < SMS_PARSER_VERSION;
  // Each range scans messages received in (after, before).
  const ranges: [number, number][] = [];
  if (!from || reread) ranges.push([Math.min(startOfTracking, from ? istMidnight(from) - 1 : startOfTracking), Infinity]);
  else {
    if (profile.trackingStart < from) ranges.push([startOfTracking, istMidnight(from)]);
    ranges.push([Math.max(Number(conn?.cursor ?? 0), startOfTracking), Infinity]);
  }
  let cursor = 0;
  const rules = await db.rules.toArray();
  const existing = await db.txns.toArray();
  const byFp = new Map(existing.filter((t) => t.fingerprint).map((t) => [t.fingerprint!, t]));
  const byRef = new Map(existing.filter((t) => t.source.externalRef).map((t) => [t.source.externalRef!, t]));
  // Transactions you deleted are never brought back.
  const dismissed = new Set(conn?.dismissed ?? []);
  const batchId = uid("sms-");
  const created: Transaction[] = [];
  const corrected: Transaction[] = [];
  const readBalances = profile.prefs?.balances ?? DEFAULT_PREFS.balances;
  const balances = new Map<string, Account>();
  const mandates: { m: ParsedMandate; on: string }[] = [];

  try {
    for (const [after, before] of ranges) {
      cursor = after;
      for (;;) {
        const page = JSON.parse(bridge.list(cursor, PAGE)) as SmsPage;
        for (const sms of page.messages) {
          if (sms.date >= before) break;
          if (readBalances) {
            const b = parseBalance(sms);
            const id = b && `${b.bank}-${b.last4}`;
            if (b && id && sms.date >= (balances.get(id)?.asOf ?? 0)) balances.set(id, { id, bank: b.bank, last4: b.last4, kind: b.kind, balancePaise: b.balancePaise, asOf: sms.date });
          }
          if (sms.date <= startOfTracking) continue;
          const mandate = parseMandate(sms);
          if (mandate) {
            mandates.push({ m: mandate, on: toISTKey(sms.date) });
            continue;
          }
          const c = smsToCandidate(sms, rules);
          if (!c || dismissed.has(c.fingerprint)) continue;
          const already = byFp.get(c.fingerprint) ?? (c.reference ? byRef.get(c.reference) : undefined);
          if (already) {
            // Read before: only fix how it was classified, and never override your own edits.
            const untouched = already.source.providerId === "sms" && already.updatedAt === already.createdAt;
            if (reread && untouched && (already.kind !== c.kind || already.category !== c.category || already.merchant !== c.merchant || already.tag !== c.tag || already.payee !== c.payee)) {
              let t: Transaction = { ...already, kind: c.kind, category: c.category, tag: c.tag, payee: c.payee, merchant: c.merchant, method: c.method };
              if (t.kind === "refund" && !t.refundOf) t = { ...t, ...autoLinkRefund(t, [...existing, ...created]) };
              corrected.push(t);
            }
            continue;
          }
          const now = Date.now();
          let t: Transaction = {
            id: uid("t-"),
            date: c.date,
            amountPaise: c.amountPaise,
            kind: c.kind,
            merchant: c.merchant,
            category: c.category,
            tag: c.tag,
            payee: c.payee,
            method: c.method,
            fingerprint: c.fingerprint,
            source: { providerId: "sms", importBatchId: batchId, externalRef: c.reference, raw: c.raw, importedAt: now },
            createdAt: now,
            updatedAt: now,
          };
          if (t.kind === "refund") t = { ...t, ...autoLinkRefund(t, [...existing, ...created, t]) };
          created.push(t);
          byFp.set(c.fingerprint, t);
          if (c.reference) byRef.set(c.reference, t);
        }
        cursor = Math.max(cursor, page.until);
        if (!page.more || cursor >= before) break;
      }
    }
  } catch (e) {
    await db.connections.put({ ...conn, providerId: "sms", status: "error", lastError: e instanceof Error ? e.message : String(e) });
    throw e;
  }

  for (const { m, on } of mandates) await applyMandate(db, m, on, rules);
  await db.transaction("rw", [db.txns, db.connections, db.accounts], async () => {
    if (created.length) await db.txns.bulkAdd(created);
    if (corrected.length) await db.txns.bulkPut(corrected);
    for (const a of balances.values()) {
      const known = await db.accounts.get(a.id);
      if (!known || known.asOf <= a.asOf) await db.accounts.put(a);
    }
    await db.connections.put({
      ...conn,
      providerId: "sms",
      status: "connected",
      lastSyncAt: Date.now(),
      lastCount: created.length || conn?.lastCount,
      lastError: undefined,
      cursor: String(Math.max(cursor, Number(conn?.cursor ?? 0))),
      syncedFrom: from && from < profile.trackingStart ? from : profile.trackingStart,
      parserVersion: SMS_PARSER_VERSION,
    });
  });
  return created.length;
}
