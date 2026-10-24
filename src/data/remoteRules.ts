import { isReimbursementKind } from "@/lib/reimbursements";
import { categorize, outflowKind } from "@/lib/categorize";
import { taggingCutoff } from "@/lib/recipients";
import { toISTKey } from "@/lib/dates";
import { getConfig } from "@/lib/remoteConfig";
import { merchantFromSms } from "@/lib/sms";
import type { Transaction } from "@/lib/types";
import type { FinanceDB } from "./db";

export const isUserEdited = (t: Transaction) => !!t.userEdited || t.source.providerId === "manual" || t.updatedAt !== t.createdAt;

/** A rule's history checkbox is an explicit opt-in, not a reason to reread SMS.
 * Job receipts survive restarts/backups; unrelated config publishes do no work.
 */
export async function applyRemoteHistory(db: FinanceDB): Promise<number> {
  const config = getConfig();
  const conn = await db.connections.get("remote-rules");
  const previous = conn?.ruleHistory ?? {};
  const next = { ...previous };
  const enabled = new Set<string>();
  for (const [i, r] of config.rules.entries()) {
    const key = `${r.contains}|${r.direction ?? "both"}`;
    if (!r.applyToHistory) {
      if (previous[key] && previous[key] !== "off") next[key] = "off";
      continue;
    }
    const signature = JSON.stringify([r.contains, r.direction, r.category, r.tag, r.kind, r.priority, r.historyRevision ?? 0]);
    if (previous[key] !== signature) enabled.add(`remote-${i}-${r.contains}`);
    next[key] = signature;
  }
  if (!enabled.size && JSON.stringify(previous) === JSON.stringify(next)) return 0;
  return db.transaction("rw", [db.txns, db.rules, db.connections], async () => {
    const changes: Transaction[] = [];
    if (enabled.size) {
      const today = toISTKey();
      const txns = await db.txns.where("date").between(taggingCutoff(today), today, true, true).toArray();
      const rules = await db.rules.toArray();
      for (const t of txns) {
        if (isUserEdited(t) || t.commitmentId || t.holdId || isReimbursementKind(t.kind) || t.kind === "transfer") continue;
        const direction = t.kind === "income" ? "in" : "out";
        const c = categorize(`${t.merchant} ${t.source.raw ?? ""}`, rules, t.payee, { merchant: t.merchant, direction });
        if (!c?.ruleId || !enabled.has(c.ruleId)) continue;
        const kind = direction === "in" ? (c.kind === "settlement" || c.category === "Settlement" ? "settlement" : "income") : c.kind === "transfer" ? "transfer" : outflowKind(c.category);
        if (direction === "out" && ["Income", "Refunds", "Settlement"].includes(c.category)) continue;
        if (direction === "in" && !["Income", "Settlement"].includes(c.category)) continue;
        if (t.category === c.category && t.tag === c.tag && t.kind === kind) continue;
        // Keep automatic provenance: a later explicit history job may refine it.
        changes.push({ ...t, category: c.category, tag: c.tag, kind, ...(kind === "settlement" ? { needsReview: true, reviewReason: "Link this settlement to the original expense" } : {}) });
      }
      if (changes.length) await db.txns.bulkPut(changes);
    }
    await db.connections.put({ ...conn, providerId: "remote-rules", status: "connected", ruleHistory: next });
    return changes.length;
  });
}

/** Name the parser gives when an SMS has no readable merchant ("ICICI debit", "ATM cash"). */
const FALLBACK_NAME = /^(\S+ (debit|credit)|ATM cash)$/i;

/**
 * The config's explicit SMS re-read: re-parses stored SMS text (never the inbox)
 * for the chosen period and payments, once per run number. Transactions the user
 * edited, linked payments, holds and UPI Lite top-ups are never changed.
 */
export async function applySmsReread(db: FinanceDB): Promise<number> {
  const job = getConfig().smsReread;
  const conn = await db.connections.get("remote-rules");
  if (!job || job.run <= (conn?.smsRereadRun ?? 0)) return 0;
  return db.transaction("rw", [db.txns, db.rules, db.connections], async () => {
    const today = toISTKey();
    const from = toISTKey(Date.now() - job.months * 30.44 * 86_400_000);
    const contains = job.contains?.toLowerCase();
    const rules = job.categories ? await db.rules.toArray() : [];
    const changes: Transaction[] = [];
    for (const t of await db.txns.where("date").between(from, today, true, true).toArray()) {
      const raw = t.source.raw;
      if (t.source.providerId !== "sms" || !raw || isUserEdited(t) || t.commitmentId || t.holdId || t.tag === "UPI Lite") continue;
      if (job.only === "unnamed" && !FALLBACK_NAME.test(t.merchant)) continue;
      if (contains && !raw.toLowerCase().includes(contains)) continue;
      const direction = t.kind === "income" || isReimbursementKind(t.kind) ? "in" : "out";
      const next = { ...t };
      if (job.names) next.merchant = merchantFromSms(raw, direction) ?? t.merchant;
      if (job.categories && !isReimbursementKind(t.kind) && t.kind !== "transfer") {
        const c = categorize(`${next.merchant} ${raw}`, rules, t.payee, { merchant: next.merchant, direction });
        const kind = c && (direction === "in" ? (c.kind === "settlement" || c.category === "Settlement" ? "settlement" : "income") : c.kind === "transfer" ? "transfer" : outflowKind(c.category));
        if (c && kind && !(direction === "out" && ["Income", "Refunds", "Settlement"].includes(c.category)) && !(direction === "in" && !["Income", "Settlement"].includes(c.category))) Object.assign(next, { category: c.category, tag: c.tag, kind, ...(kind === "settlement" ? { needsReview: true, reviewReason: "Link this settlement to the original expense" } : {}) });
      }
      if (next.merchant !== t.merchant || next.category !== t.category || next.tag !== t.tag || next.kind !== t.kind) changes.push(next);
    }
    if (changes.length) await db.txns.bulkPut(changes);
    const latest = await db.connections.get("remote-rules");
    await db.connections.put({ ...latest, providerId: "remote-rules", status: "connected", smsRereadRun: job.run });
    return changes.length;
  });
}
