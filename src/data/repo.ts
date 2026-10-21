/**
 * Data operations. UI calls these; they keep financial rules (categorisation,
 * refund linking, provenance) out of components.
 */
import { DEFAULT_RULES, categorize, detectMethod } from "@/lib/categorize";
import { type CandidateRow, fingerprint } from "@/lib/csv";
import { autoLinkRefund } from "@/lib/match";
import type { DateKey } from "@/lib/dates";
import type { AppMode, BudgetPlan, CategoryRule, Commitment, ImportBatch, Profile, Transaction, TxnKind, PaymentMethod } from "@/lib/types";
import { type FinanceDB, uid } from "./db";
import { generateDemoData } from "./providers/demo";

export async function ensureRules(db: FinanceDB) {
  if ((await db.rules.count()) === 0) {
    await db.rules.bulkAdd(DEFAULT_RULES.map((r, i) => ({ ...r, id: `builtin-${i}` })));
  }
}

export async function ensureConnections(db: FinanceDB, mode: AppMode) {
  const base = mode === "demo" ? ["demo"] : ["manual", "csv"];
  for (const providerId of [...base, "account-aggregator"]) {
    if (!(await db.connections.get(providerId))) {
      await db.connections.put({ providerId, status: providerId === "account-aggregator" ? "not_available" : "connected" });
    }
  }
}

export async function seedDemo(db: FinanceDB, today: DateKey) {
  const { profile, plan, txns } = generateDemoData(today);
  await db.transaction("rw", [db.profile, db.plans, db.txns, db.connections, db.rules], async () => {
    await db.profile.clear();
    await db.plans.clear();
    await db.txns.clear();
    await db.profile.put(profile);
    await db.plans.put(plan);
    await db.txns.bulkPut(txns);
    await ensureRules(db);
    await db.connections.put({ providerId: "demo", status: "connected", lastSyncAt: Date.now(), lastCount: txns.length });
    await ensureConnections(db, "demo");
  });
}

export interface OnboardingInput {
  name?: string;
  incomePaise: number | null;
  commitments: Commitment[];
  trackingStart: DateKey;
  openingAdjustmentPaise: number;
  /** Commitment ids already paid this month (shown as paid, still deducted from the pool). */
  alreadyPaidIds: string[];
  /** Month the "already paid" ticks refer to (the current month). */
  paidMonth: string;
}

export async function completeOnboarding(db: FinanceDB, input: OnboardingInput) {
  const now = Date.now();
  const profile: Profile = {
    id: "me",
    name: input.name?.trim() || undefined,
    trackingStart: input.trackingStart,
    openingAdjustmentPaise: input.openingAdjustmentPaise,
    onboardedAt: now,
    manuallyPaid: input.alreadyPaidIds.map((id) => `${id}@${input.paidMonth}`),
  };
  const plan: BudgetPlan = { id: uid("plan-"), effectiveFrom: input.trackingStart, incomePaise: input.incomePaise, commitments: input.commitments, createdAt: now };
  await db.transaction("rw", [db.profile, db.plans, db.rules, db.connections], async () => {
    await db.profile.put(profile);
    await db.plans.clear();
    await db.plans.put(plan);
    await ensureRules(db);
    await ensureConnections(db, "personal");
  });
}

/** Budget changes never rewrite history: a new plan takes effect from `effectiveFrom`. */
export async function addPlanVersion(db: FinanceDB, p: Omit<BudgetPlan, "id" | "createdAt">) {
  // Replacing a plan with the same start date keeps the timeline tidy.
  const same = await db.plans.where("effectiveFrom").equals(p.effectiveFrom).toArray();
  await db.transaction("rw", db.plans, async () => {
    for (const s of same) await db.plans.delete(s.id);
    await db.plans.put({ ...p, id: uid("plan-"), createdAt: Date.now() });
  });
}

export interface NewTxnInput {
  date: DateKey;
  amountPaise: number;
  merchant: string;
  category?: string;
  kind?: TxnKind;
  method?: PaymentMethod;
  note?: string;
  commitmentId?: string;
}

export async function addManualTxn(db: FinanceDB, input: NewTxnInput): Promise<Transaction> {
  const rules = await db.rules.toArray();
  const guess = categorize(input.merchant, rules);
  const now = Date.now();
  const kind: TxnKind = input.kind ?? (guess?.kind === "investment" || guess?.kind === "transfer" ? guess.kind : "expense");
  let t: Transaction = {
    id: uid("t-"),
    date: input.date,
    amountPaise: input.amountPaise,
    merchant: input.merchant.trim() || "Unknown",
    category: input.category || guess?.category || "Other",
    kind,
    method: input.method ?? detectMethod(input.merchant),
    note: input.note?.trim() || undefined,
    commitmentId: input.commitmentId,
    source: { providerId: "manual", importedAt: now },
    createdAt: now,
    updatedAt: now,
  };
  if (t.kind === "refund") t = { ...t, ...autoLinkRefund(t, await db.txns.toArray()) };
  await db.txns.add(t);
  await db.connections.update("manual", { lastSyncAt: now, lastCount: 1, status: "connected" });
  return t;
}

export async function updateTxn(db: FinanceDB, id: string, patch: Partial<Transaction>) {
  const cleaned: Partial<Transaction> = { ...patch, updatedAt: Date.now() };
  if (patch.kind && patch.kind !== "commitment") cleaned.commitmentId = undefined;
  if (patch.kind && patch.kind !== "refund") cleaned.refundOf = undefined;
  if (patch.refundOf) Object.assign(cleaned, { needsReview: false, reviewReason: undefined });
  if (patch.kind === "commitment" && patch.commitmentId) Object.assign(cleaned, { needsReview: false, reviewReason: undefined });
  await db.txns.update(id, cleaned);
}

export async function deleteTxn(db: FinanceDB, id: string) {
  await db.transaction("rw", [db.txns, db.connections], async () => {
    const t = await db.txns.get(id);
    // Refunds pointing at this expense become unmatched and need review.
    const refunds = await db.txns.where("refundOf").equals(id).toArray();
    for (const r of refunds) await db.txns.update(r.id, { refundOf: undefined, needsReview: true, reviewReason: "Original expense was deleted" });
    await db.txns.delete(id);
    // Remember deleted SMS transactions so re-reading the inbox never brings them back.
    if (t?.source.providerId === "sms" && t.fingerprint) {
      const conn = await db.connections.get("sms");
      await db.connections.put({ ...conn, providerId: "sms", status: conn?.status ?? "connected", dismissed: [...(conn?.dismissed ?? []), t.fingerprint] });
    }
  });
}

/** Apply a category correction and optionally remember it as a rule for that merchant. */
export async function correctCategory(db: FinanceDB, txn: Transaction, category: string, remember: boolean) {
  await updateTxn(db, txn.id, { category });
  if (remember) {
    const pattern = txn.merchant.trim().toLowerCase();
    const existing = (await db.rules.toArray()).find((r) => !r.builtIn && r.pattern.toLowerCase() === pattern);
    if (existing) await db.rules.update(existing.id, { category });
    else await db.rules.add({ id: uid("rule-"), pattern, category, priority: 10 });
  }
}

export async function importCandidates(db: FinanceDB, rows: CandidateRow[], fileName: string) {
  const now = Date.now();
  const batchId = uid("imp-");
  const chosen = rows.filter((r) => r.status === "valid");
  const existing = await db.txns.toArray();
  const created: Transaction[] = [];
  for (const r of chosen) {
    let t: Transaction = {
      id: uid("t-"),
      date: r.date!,
      amountPaise: r.amountPaise!,
      kind: r.kind!,
      merchant: r.merchant,
      category: r.category ?? "Other",
      method: r.method ?? "other",
      fingerprint: r.fingerprint,
      source: { providerId: "csv", importBatchId: batchId, externalRef: r.reference, raw: r.description, importedAt: now },
      createdAt: now,
      updatedAt: now,
    };
    if (t.kind === "refund") t = { ...t, ...autoLinkRefund(t, [...existing, ...created, t]) };
    created.push(t);
  }
  const batch: ImportBatch = {
    id: batchId,
    providerId: "csv",
    fileName,
    importedAt: now,
    rowCount: rows.length,
    importedCount: created.length,
    skippedDuplicates: rows.filter((r) => r.status === "duplicate").length,
    invalidCount: rows.filter((r) => r.status === "invalid").length,
  };
  await db.transaction("rw", [db.txns, db.imports, db.connections], async () => {
    await db.txns.bulkAdd(created);
    await db.imports.add(batch);
    await db.connections.put({ providerId: "csv", status: "connected", lastSyncAt: now, lastCount: created.length });
  });
  return batch;
}

export async function undoImport(db: FinanceDB, batchId: string) {
  await db.transaction("rw", [db.txns, db.imports], async () => {
    const ids = (await db.txns.toArray()).filter((t) => t.source.importBatchId === batchId).map((t) => t.id);
    await db.txns.bulkDelete(ids);
    await db.imports.delete(batchId);
  });
}

export async function existingFingerprints(db: FinanceDB): Promise<Set<string>> {
  const all = await db.txns.toArray();
  return new Set(
    all.map((t) => t.fingerprint ?? fingerprint({ date: t.date, amountPaise: t.amountPaise, direction: ["income", "refund"].includes(t.kind) ? "in" : "out", description: t.source.raw ?? t.merchant, reference: t.source.externalRef })),
  );
}

export async function saveRule(db: FinanceDB, rule: Omit<CategoryRule, "id"> & { id?: string }) {
  await db.rules.put({ ...rule, id: rule.id ?? uid("rule-") });
}

export async function recategorizeAll(db: FinanceDB) {
  const rules = await db.rules.toArray();
  const txns = await db.txns.toArray();
  let changed = 0;
  for (const t of txns) {
    if (t.kind !== "expense") continue;
    const c = categorize(`${t.merchant} ${t.source.raw ?? ""}`, rules);
    if (c && c.category !== t.category && !c.kind) {
      await db.txns.update(t.id, { category: c.category, updatedAt: Date.now() });
      changed++;
    }
  }
  return changed;
}

export async function markCommitmentPaid(db: FinanceDB, key: string, paid: boolean) {
  const p = await db.profile.get("me");
  if (!p) return;
  const set = new Set(p.manuallyPaid);
  if (paid) set.add(key);
  else set.delete(key);
  await db.profile.update("me", { manuallyPaid: [...set] });
}

// ---------------------------------------------------------------- backup

export const EXPORT_FORMAT = "paisa-pulse-backup";

export async function exportAll(db: FinanceDB, mode: AppMode) {
  return {
    format: EXPORT_FORMAT,
    version: 1,
    mode,
    exportedAt: new Date().toISOString(),
    profile: await db.profile.get("me"),
    plans: await db.plans.toArray(),
    txns: await db.txns.toArray(),
    rules: await db.rules.toArray(),
    imports: await db.imports.toArray(),
    connections: await db.connections.toArray(),
  };
}

export async function importBackup(db: FinanceDB, data: unknown) {
  const d = data as Awaited<ReturnType<typeof exportAll>>;
  if (!d || d.format !== EXPORT_FORMAT || !Array.isArray(d.txns) || !Array.isArray(d.plans) || !d.profile) {
    throw new Error("This file isn't a Drip backup.");
  }
  for (const t of d.txns) {
    if (!t.id || typeof t.date !== "string" || !Number.isSafeInteger(t.amountPaise)) throw new Error("Backup contains an invalid transaction; nothing was restored.");
  }
  await db.transaction("rw", [db.profile, db.plans, db.txns, db.rules, db.imports, db.connections], async () => {
    await Promise.all([db.profile.clear(), db.plans.clear(), db.txns.clear(), db.rules.clear(), db.imports.clear()]);
    await db.profile.put(d.profile!);
    await db.plans.bulkPut(d.plans);
    await db.txns.bulkPut(d.txns);
    await db.rules.bulkPut(d.rules ?? []);
    await db.imports.bulkPut(d.imports ?? []);
    // Older backups have no connections; then SMS sync rescans from the tracking start (duplicates are skipped).
    if (d.connections) {
      await db.connections.clear();
      await db.connections.bulkPut(d.connections);
    }
  });
  await ensureRules(db);
}

export function txnsToCsv(txns: Transaction[]): string {
  const head = ["date", "amount_inr", "kind", "merchant", "category", "method", "note", "source", "commitment_id", "refund_of"];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = txns
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((t) => [t.date, (t.amountPaise / 100).toFixed(2), t.kind, t.merchant, t.category, t.method, t.note, t.source.providerId, t.commitmentId, t.refundOf].map(esc).join(","));
  return [head.join(","), ...lines].join("\n");
}
