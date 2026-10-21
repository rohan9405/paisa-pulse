/**
 * Bank SMS provider. Only available inside the Android app (android/), which
 * exposes the phone's SMS inbox to the page as `window.PaisaSms`. Messages are
 * read and parsed on the device; nothing is uploaded anywhere.
 */
import { autoLinkRefund } from "@/lib/match";
import { type RawSms, smsToCandidate } from "@/lib/sms";
import type { Transaction } from "@/lib/types";
import { type FinanceDB, uid } from "../db";

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
  // Each range scans messages received in (after, before).
  const ranges: [number, number][] = [];
  const from = conn?.syncedFrom;
  if (!from) ranges.push([startOfTracking, Infinity]);
  else {
    // Only the newly uncovered days, so transactions you deleted after the first scan don't come back.
    if (profile.trackingStart < from) ranges.push([startOfTracking, istMidnight(from)]);
    ranges.push([Math.max(Number(conn?.cursor ?? 0), startOfTracking), Infinity]);
  }
  let cursor = 0;
  const rules = await db.rules.toArray();
  const existing = await db.txns.toArray();
  const seenFp = new Set(existing.map((t) => t.fingerprint).filter(Boolean));
  const seenRef = new Set(existing.map((t) => t.source.externalRef).filter(Boolean));
  const batchId = uid("sms-");
  const created: Transaction[] = [];

  try {
    for (const [after, before] of ranges) {
      cursor = after;
      for (;;) {
        const page = JSON.parse(bridge.list(cursor, PAGE)) as SmsPage;
        for (const sms of page.messages) {
          if (sms.date >= before) break;
          const c = smsToCandidate(sms, rules);
          if (!c || seenFp.has(c.fingerprint) || (c.reference && seenRef.has(c.reference))) continue;
          const now = Date.now();
          let t: Transaction = {
            id: uid("t-"),
            date: c.date,
            amountPaise: c.amountPaise,
            kind: c.kind,
            merchant: c.merchant,
            category: c.category,
            method: c.method,
            fingerprint: c.fingerprint,
            source: { providerId: "sms", importBatchId: batchId, externalRef: c.reference, raw: c.raw, importedAt: now },
            createdAt: now,
            updatedAt: now,
          };
          if (t.kind === "refund") t = { ...t, ...autoLinkRefund(t, [...existing, ...created, t]) };
          created.push(t);
          seenFp.add(c.fingerprint);
          if (c.reference) seenRef.add(c.reference);
        }
        cursor = Math.max(cursor, page.until);
        if (!page.more || cursor >= before) break;
      }
    }
  } catch (e) {
    await db.connections.put({ ...conn, providerId: "sms", status: "error", lastError: e instanceof Error ? e.message : String(e) });
    throw e;
  }

  await db.transaction("rw", [db.txns, db.connections], async () => {
    if (created.length) await db.txns.bulkAdd(created);
    await db.connections.put({
      providerId: "sms",
      status: "connected",
      lastSyncAt: Date.now(),
      lastCount: created.length || conn?.lastCount,
      lastError: undefined,
      cursor: String(cursor),
      syncedFrom: from && from < profile.trackingStart ? from : profile.trackingStart,
    });
  });
  return created.length;
}
