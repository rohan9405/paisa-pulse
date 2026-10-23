/**
 * Data operations. UI calls these; they keep financial rules (categorisation,
 * refund linking, provenance) out of components.
 */
import { categorize, detectMethod, normalize, outflowKind } from "@/lib/categorize";
import { type CandidateRow, fingerprint } from "@/lib/csv";
import { recipientKey, recipientMatches, taggingFlow, taggingCutoff, withinTaggingWindow } from "@/lib/recipients";
import { autoLinkRefund, learnFromLinked } from "@/lib/match";
import { type DateKey, parseKey, toISTKey } from "@/lib/dates";
import type { ParsedMandate } from "@/lib/sms";
import type { AppMode, SetAsideMode, BudgetPlan, CategoryRule, Commitment, ImportBatch, Prefs, Profile, Recurring, Transaction, TxnKind, PaymentMethod } from "@/lib/types";
import { currentBuiltInRules, migratePlan, migrateRule, migrateTxn } from "./migrate";
import { type FinanceDB, uid } from "./db";
import { generateDemoData } from "./providers/demo";

/** Keeps the built-in rules in step with this version of the app; your own rules are untouched. */
export async function ensureRules(db: FinanceDB) {
  const fresh = currentBuiltInRules();
  const have = await db.rules.filter((r) => !!r.builtIn).toArray();
  const same = have.length === fresh.length && fresh.every((r) => {
    const h = have.find((x) => x.id === r.id);
    return h && h.pattern === r.pattern && h.category === r.category && h.tag === r.tag && h.kind === r.kind && h.direction === r.direction && h.priority === r.priority;
  });
  if (same) return;
  await db.transaction("rw", db.rules, async () => {
    await db.rules.bulkDelete(have.map((r) => r.id));
    await db.rules.bulkPut(fresh);
  });
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
  const { profile, plan, txns, recurring } = generateDemoData(today);
  await db.transaction("rw", [db.profile, db.plans, db.txns, db.connections, db.rules, db.recurring], async () => {
    await db.profile.clear();
    await db.plans.clear();
    await db.txns.clear();
    await db.recurring.clear();
    await db.profile.put(profile);
    await db.plans.put(plan);
    await db.txns.bulkPut(txns);
    await db.recurring.bulkPut(recurring);
    await ensureRules(db);
    await db.connections.put({ providerId: "demo", status: "connected", lastSyncAt: Date.now(), lastCount: txns.length });
    await ensureConnections(db, "demo");
  });
}

export interface OnboardingInput {
  budgetMode?: BudgetPlan["budgetMode"];
  name?: string;
  incomePaise: number | null;
  commitments: Commitment[];
  setAsideMode?: SetAsideMode;
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
  const plan: BudgetPlan = { id: uid("plan-"), effectiveFrom: input.trackingStart, budgetMode: input.budgetMode, incomePaise: input.incomePaise, commitments: input.commitments, setAsideMode: input.setAsideMode, createdAt: now };
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
  tag?: string;
  kind?: TxnKind;
  method?: PaymentMethod;
  note?: string;
  commitmentId?: string;
}

export async function addManualTxn(db: FinanceDB, input: NewTxnInput): Promise<Transaction> {
  const rules = await db.rules.toArray();
  const guess = categorize(input.merchant, rules);
  const now = Date.now();
  const category = input.category || guess?.category || "Other";
  const kind: TxnKind = input.kind ?? (category === "Income" ? "income" : !input.category && guess?.kind === "transfer" ? "transfer" : outflowKind(category));
  let t: Transaction = {
    id: uid("t-"),
    date: input.date,
    amountPaise: input.amountPaise,
    merchant: input.merchant.trim() || "Unknown",
    category,
    tag: input.tag ?? (category === guess?.category ? guess?.tag : undefined),
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
  // Linking a payment to a planned line teaches drip about that payee's other payments.
  if (patch.commitmentId) {
    const learned = learnFromLinked(await db.txns.toArray());
    if (learned.length) await db.txns.bulkPut(learned);
  }
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

const isOut = (k: TxnKind) => k === "expense" || k === "investment" || k === "commitment";

/** Category + tag for one transaction; an outflow becomes an investment or an expense to match. */
function classify(t: Transaction, category: string, tag: string | undefined): Partial<Transaction> {
  const patch: Partial<Transaction> = { category, tag: tag?.trim() || undefined };
  if (isOut(t.kind) && t.kind !== "commitment") patch.kind = outflowKind(category) === "transfer" ? "transfer" : outflowKind(category);
  return patch;
}

export interface TaggingOptions {
  remember: boolean;
  scope: "one" | "month" | "all";
}

/** Apply a category and tag to one payment, a recipient's month, or their payments within the last twelve months.
 * Remembering saves a separate rule for future payments. Boolean options retain
 * the older API's behavior (true also updates past payments).
 * Returns the number of other transactions changed.
 */
export async function applyCategory(db: FinanceDB, txn: Transaction, category: string, tag: string | undefined, options: boolean | TaggingOptions): Promise<number> {
  const { remember, scope }: TaggingOptions = typeof options === "boolean" ? { remember: options, scope: options ? "all" : "one" } : options;
  return db.transaction("rw", [db.txns, db.rules], async () => {
    const current = await db.txns.get(txn.id);
    if (!current) throw new Error("This transaction no longer exists.");
    const today = toISTKey();
    const cleanTag = tag?.trim() || undefined;
    // Explicit individual edits can reach older history; bulk edits never do.
    if ((scope === "one" || withinTaggingWindow(current, today)) && (current.category !== category || current.tag !== cleanTag)) {
      await updateTxn(db, txn.id, classify(current, category, cleanTag));
    }
    const key = recipientKey(txn);
    if (remember && key) {
      const payee = txn.payee ? normalize(txn.payee) : undefined;
      const merchant = payee ? undefined : normalize(txn.merchant);
      const direction = taggingFlow(txn) === "income" ? "in" : "out";
      const existing = (await db.rules.toArray()).find((r) => !r.builtIn && (!r.direction || r.direction === direction) && (payee ? normalize(r.payee ?? "") === payee : !r.payee && normalize(r.merchant ?? r.pattern) === merchant));
      const rule: CategoryRule = { id: existing?.id ?? uid("rule-"), pattern: payee ?? merchant!, payee, merchant, direction, category, tag: cleanTag, priority: 10 };
      if (category === "Transfers") rule.kind = "transfer";
      if (txn.kind === "income") rule.kind = "income";
      await db.rules.put(rule);
    }
    // Use the date index so older years are not loaded during a bulk edit.
    const recent = scope === "one" ? [] : await db.txns.where("date").between(taggingCutoff(today), today, true, true).toArray();
    const same = scope === "one" ? [] : recipientMatches(recent, txn, scope, today).filter((t) => t.category !== category || t.tag !== cleanTag);
    if (same.length) {
      const updatedAt = Date.now();
      await db.txns.bulkPut(same.map((t) => ({ ...t, ...classify(t, category, cleanTag), updatedAt })));
    }
    return same.length;
  });
}

/** @deprecated use applyCategory */
export async function correctCategory(db: FinanceDB, txn: Transaction, category: string, remember: boolean) {
  await applyCategory(db, txn, category, txn.tag, remember);
}

// ---------------------------------------------------------------- recurring

const recurringKey = (r: Pick<Recurring, "payee" | "name">) => (r.payee ? `p:${normalize(r.payee)}` : `n:${normalize(r.name)}`);

/** Mark (or unmark) a transaction as a regular monthly payment. */
export async function setRecurringFromTxn(db: FinanceDB, txn: Transaction, on: boolean) {
  const key = recurringKey({ payee: txn.payee, name: txn.merchant });
  const existing = (await db.recurring.toArray()).find((r) => recurringKey(r) === key);
  const now = Date.now();
  await db.transaction("rw", [db.txns, db.recurring], async () => {
    await db.txns.update(txn.id, { recurring: on || undefined, updatedAt: now });
    if (on) {
      await db.recurring.put({
        id: existing?.id ?? uid("rec-"),
        name: txn.merchant,
        payee: txn.payee,
        amountPaise: txn.amountPaise,
        frequency: existing?.frequency ?? "monthly",
        dueDay: parseKey(txn.date).d,
        category: txn.category,
        tag: txn.tag,
        source: existing?.source ?? "manual",
        mandateRef: existing?.mandateRef,
        status: "active",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    } else if (existing && existing.source === "manual") {
      await db.recurring.delete(existing.id);
    }
  });
}

/** Record an autopay / e-mandate from a bank SMS. Returns true if something changed. */
export async function applyMandate(db: FinanceDB, m: ParsedMandate, receivedOn: DateKey, rules: CategoryRule[]): Promise<boolean> {
  const name = m.name ?? m.payee ?? "Autopay";
  const all = await db.recurring.toArray();
  const existing = all.find((r) => (m.ref && r.mandateRef === m.ref) || recurringKey(r) === recurringKey({ payee: m.payee, name }));
  const now = Date.now();
  if (m.event === "revoked") {
    if (!existing || existing.status === "revoked") return false;
    await db.recurring.update(existing.id, { status: "revoked", updatedAt: now });
    return true;
  }
  const guess = categorize(name, rules, m.payee);
  const due = m.startDate ?? receivedOn;
  const { d, m: month } = parseKey(due);
  const next: Recurring = {
    id: existing?.id ?? uid("rec-"),
    name: existing?.name ?? name,
    payee: m.payee ?? existing?.payee,
    amountPaise: m.amountPaise ?? existing?.amountPaise ?? 0,
    frequency: m.frequency,
    dueDay: existing && m.event === "modified" && !m.startDate ? existing.dueDay : d,
    dueMonth: m.frequency === "yearly" || m.frequency === "quarterly" ? month : undefined,
    category: existing?.category ?? guess?.category ?? "Bills",
    tag: existing?.tag ?? guess?.tag,
    source: "mandate",
    mandateRef: m.ref ?? existing?.mandateRef,
    status: "active",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.recurring.put(next);
  return true;
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
      tag: r.tag,
      payee: r.payee,
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
  return db.transaction("rw", [db.txns, db.rules], async () => {
    const rules = await db.rules.toArray();
    const today = toISTKey();
    const txns = await db.txns.where("date").between(taggingCutoff(today), today, true, true).toArray();
    const changed: Transaction[] = [];
    for (const t of txns) {
      // Money out only; preserve explicit planned-line links.
      if (t.kind !== "expense" && t.kind !== "investment") continue;
      const c = categorize(`${t.merchant} ${t.source.raw ?? ""}`, rules, t.payee, { merchant: t.merchant, direction: "out" });
      if (!c || (c.kind && c.kind !== "investment" && c.kind !== "transfer")) continue;
      const tag = c.tag ?? (c.category === t.category ? t.tag : undefined);
      if (c.category === t.category && tag === t.tag) continue;
      changed.push({ ...t, ...classify(t, c.category, tag), updatedAt: Date.now() });
    }
    if (changed.length) await db.txns.bulkPut(changed);
    return changed.length;
  });
}

/** Remember a "No" on a suggestion so it never comes back, across visits and devices restored from backup. */
export async function dismissSuggestion(db: FinanceDB, key: string) {
  const p = await db.profile.get("me");
  if (!p || p.dismissedSuggestions?.includes(key)) return;
  await db.profile.update("me", { dismissedSuggestions: [...(p.dismissedSuggestions ?? []), key] });
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
    accounts: await db.accounts.toArray(),
    recurring: await db.recurring.toArray(),
  };
}

export async function importBackup(db: FinanceDB, data: unknown) {
  const d = data as Awaited<ReturnType<typeof exportAll>>;
  if (!d || d.format !== EXPORT_FORMAT || !Array.isArray(d.txns) || !Array.isArray(d.plans) || !d.profile) {
    throw new Error("This file isn't a drip backup.");
  }
  for (const t of d.txns) {
    if (!t.id || typeof t.date !== "string" || !Number.isSafeInteger(t.amountPaise)) throw new Error("Backup contains an invalid transaction; nothing was restored.");
  }
  await db.transaction("rw", [db.profile, db.plans, db.txns, db.rules, db.imports, db.connections, db.accounts, db.recurring], async () => {
    await Promise.all([db.profile.clear(), db.plans.clear(), db.txns.clear(), db.rules.clear(), db.imports.clear(), db.recurring.clear()]);
    await db.profile.put(d.profile!);
    // Older backups use the old categories; bring them up to date.
    await db.plans.bulkPut(d.plans.map(migratePlan));
    await db.txns.bulkPut(d.txns.map(migrateTxn));
    await db.rules.bulkPut((d.rules ?? []).filter((r) => !r.builtIn).map(migrateRule));
    await db.recurring.bulkPut(d.recurring ?? []);
    await db.imports.bulkPut(d.imports ?? []);
    // Older backups have no connections; then SMS sync rescans from the tracking start (duplicates are skipped).
    if (d.connections) {
      await db.connections.clear();
      await db.connections.bulkPut(d.connections);
    }
    await db.accounts.clear();
    await db.accounts.bulkPut(d.accounts ?? []);
  });
  await ensureRules(db);
}

export function txnsToCsv(txns: Transaction[]): string {
  const head = ["date", "amount_inr", "kind", "merchant", "category", "tag", "payee", "method", "note", "source", "commitment_id", "refund_of"];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = txns
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((t) => [t.date, (t.amountPaise / 100).toFixed(2), t.kind, t.merchant, t.category, t.tag, t.payee, t.method, t.note, t.source.providerId, t.commitmentId, t.refundOf].map(esc).join(","));
  return [head.join(","), ...lines].join("\n");
}

export async function setPrefs(db: FinanceDB, patch: Partial<Prefs>) {
  const p = await db.profile.get("me");
  if (!p) return;
  await db.profile.update("me", { prefs: { ...p.prefs, ...patch } });
  // Balances off: forget the ones already read. Back on: re-read the inbox once to find them again.
  if (patch.balances === false) await db.accounts.clear();
  if (patch.balances === true) await db.connections.update("sms", { parserVersion: 0 });
}
