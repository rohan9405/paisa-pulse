import { categorize, outflowKind } from "@/lib/categorize";
import { taggingCutoff } from "@/lib/recipients";
import { toISTKey } from "@/lib/dates";
import { getConfig } from "@/lib/remoteConfig";
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
        if (isUserEdited(t) || t.commitmentId || t.holdId || t.kind === "refund" || t.kind === "transfer") continue;
        const direction = t.kind === "income" ? "in" : "out";
        const c = categorize(`${t.merchant} ${t.source.raw ?? ""}`, rules, t.payee, { merchant: t.merchant, direction });
        if (!c?.ruleId || !enabled.has(c.ruleId)) continue;
        const kind = direction === "in" ? "income" : c.kind === "transfer" ? "transfer" : outflowKind(c.category);
        if (direction === "out" && ["Income", "Refunds"].includes(c.category)) continue;
        if (direction === "in" && c.category !== "Income") continue;
        if (t.category === c.category && t.tag === c.tag && t.kind === kind) continue;
        // Keep automatic provenance: a later explicit history job may refine it.
        changes.push({ ...t, category: c.category, tag: c.tag, kind });
      }
      if (changes.length) await db.txns.bulkPut(changes);
    }
    await db.connections.put({ ...conn, providerId: "remote-rules", status: "connected", ruleHistory: next });
    return changes.length;
  });
}
