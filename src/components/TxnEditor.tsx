"use client";

import { useEffect, useMemo, useState } from "react";
import { hasBudget, commitmentCategory, matchCommitment, modeOf, planForDate, setAsideOf } from "@/lib/budget";
import { ACTIVE_CATEGORIES as CATEGORIES, TAGS, categoryEmoji, displayCategory, outflowKind } from "@/lib/categorize";
import { formatDay } from "@/lib/dates";
import { recipientKey, recipientMatches } from "@/lib/recipients";
import { isReimbursementKind, settlementCandidates } from "@/lib/reimbursements";
import { refundCandidates } from "@/lib/match";
import { formatINR, paiseToRupeeInput, rupeesInputToPaise } from "@/lib/money";
import type { Transaction, TxnKind } from "@/lib/types";
import { applyCategory, deleteTxn, updateTxn } from "@/data/repo";
import { useAppData, useStore } from "@/data/store";
import { providerName } from "@/data/providers/registry";
import { AmountInput, Field, Pill, Sheet, cx } from "./ui";

export const KIND_LABEL: Record<TxnKind, string> = {
  expense: "Expense",
  commitment: "Planned",
  investment: "Investment",
  transfer: "Own transfer",
  refund: "Refund",
  settlement: "Settlement",
  income: "Income",
};

type Flow = "out" | "transfer" | "refund" | "settlement" | "income";
const FLOW_LABEL: Record<Flow, string> = { out: "Money out", transfer: "Own transfer", refund: "Refund", settlement: "Settlement", income: "Income" };
const FLOW_HELP: Record<Flow, string> = {
  out: "Spending, a bill or an investment: the category decides which.",
  transfer: "Between your own accounts, or paying your credit card bill. Ignored everywhere.",
  settlement: "Someone paid back their share. Link it to your original expense.",
  refund: "Money back. Link it to the original payment to reduce its net cost.",
  income: "Money in, e.g. salary or dividends. Funds the allowance in actual set-aside mode.",
};
const flowOf = (k: TxnKind): Flow => (k === "transfer" ? "transfer" : k === "settlement" ? "settlement" : k === "refund" ? "refund" : k === "income" ? "income" : "out");

export function TxnEditor({ txn, onClose }: { txn: Transaction | null; onClose: () => void }) {
  const { db, today } = useStore();
  const data = useAppData();
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [remember, setRemember] = useState(true);
  const [applyPast, setApplyPast] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flow, setFlow] = useState<Flow>("out");
  const [commitmentId, setCommitmentId] = useState("");
  const [refundOf, setRefundOf] = useState("");
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!txn) return;
    setAccountId(txn.accountId ?? "");
    setAmount(paiseToRupeeInput(txn.amountPaise));
    setDate(txn.date);
    setMerchant(txn.merchant);
    setCategory(txn.category);
    setTag(txn.tag ?? "");
    setRemember(true);
    setApplyPast(true);
    setSaving(false);
    setFlow(flowOf(txn.kind));
    setCommitmentId(txn.kind === "commitment" ? (txn.commitmentId ?? "") : "");
    setRefundOf(txn.refundOf ?? "");
    setNote(txn.note ?? "");
    setConfirmDelete(false);
    setError(null);
  }, [txn]);

  const plans = data?.plans ?? [];
  const txns = data?.txns ?? [];
  const draft = useMemo<Transaction | null>(
    () => (txn ? { ...txn, kind: flow === "settlement" ? "settlement" : txn.kind, date: date || txn.date, merchant, category, tag: tag || undefined, commitmentId: undefined, amountPaise: rupeesInputToPaise(amount) ?? txn.amountPaise } : null),
    [txn, date, merchant, amount, category, tag, flow],
  );
  const plan = useMemo(() => (draft ? planForDate(plans, draft.date) : null), [draft, plans]);
  // Planned lines this payment could belong to (planned mode, set-aside category).
  const lineOpts = useMemo(
    () => (hasBudget(plan) && plan && modeOf(plan) === "planned" && setAsideOf(plan).includes(category) ? plan.commitments.filter((c) => commitmentCategory(c) === category) : []),
    [plan, category],
  );
  const autoLine = useMemo(() => (draft && lineOpts.length ? matchCommitment(draft, plan) : null), [draft, plan, lineOpts]);
  const refundOpts = useMemo(() => {
    if (!draft) return [];
    if (draft.kind === "settlement") return settlementCandidates(draft, txns).map(t => ({ t, suggested: false }));
    const strong = refundCandidates(draft, txns).map((c) => c.expense);
    const recent = txns
      .filter((t) => t.kind === "expense" && t.date <= draft.date && t.amountPaise >= draft.amountPaise && !strong.some((s) => s.id === t.id))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 30);
    return [...strong.map((t) => ({ t, suggested: true })), ...recent.map((t) => ({ t, suggested: false }))];
  }, [draft, txns]);

  // Rules and bulk edits only follow an actual category / tag change, never a note or amount fix.
  const classChanged = !!txn && (category !== txn.category || (tag.trim() || undefined) !== txn.tag);
  const matching = classChanged && draft && txn && flow === flowOf(txn.kind) ? recipientMatches(txns, draft, "all", today).filter((t) => t.category !== category || t.tag !== (tag.trim() || undefined)) : [];

  if (!txn) return null;

  const save = async () => {
    if (!db || saving) return;
    const p = rupeesInputToPaise(amount);
    if (!p) return setError("Enter an amount above ₹0");
    if (!date || date > today) return setError("Pick a date up to today");
    const kind: TxnKind = flow === "out" ? (commitmentId && commitmentId !== "none" ? "commitment" : outflowKind(category) === "transfer" ? "transfer" : outflowKind(category)) : flow;
    const cat = flow === "settlement" ? "Settlement" : flow === "transfer" ? "Transfers" : flow === "refund" ? "Refunds" : flow === "income" && category !== "Income" ? "Income" : category;
    const patch: Partial<Transaction> = {
      amountPaise: p,
      date,
      merchant: merchant.trim() || "Unknown",
      category: cat,
      tag: flow === "refund" || flow === "settlement" || flow === "transfer" ? undefined : tag.trim() || undefined,
      kind,
      note: note.trim() || undefined,
      commitmentId: kind === "commitment" ? commitmentId : undefined,
      refundOf: isReimbursementKind(kind) && refundOf ? refundOf : undefined,
    };
    if (isReimbursementKind(kind) && !refundOf) Object.assign(patch, { needsReview: true, reviewReason: "No original expense linked" });
    if (!isReimbursementKind(kind) && txn.needsReview) Object.assign(patch, { needsReview: false, reviewReason: undefined });
    setSaving(true);
    try {
      if (txn.transferGroupId && (accountId !== (txn.accountId ?? "") || patch.kind !== txn.kind || patch.amountPaise !== txn.amountPaise)) throw new Error("Unlink a confirmed transfer before changing its account, type or amount.");
      if (flow === "transfer" && !txn.transferGroupId) throw new Error("Use Transfer review to confirm both owned accounts and link the two sides.");
      patch.accountingPending = false;
      patch.direction = kind === "income" || kind === "refund" || kind === "settlement" ? "in" : kind === "transfer" ? txn.direction : "out";
      if (accountId !== (txn.accountId ?? "")) patch.accountMappingEdited = true;
      patch.accountId = accountId || undefined;
      await updateTxn(db, txn.id, patch);
      const saved = { ...txn, ...patch } as Transaction;
      if (classChanged && (flow === "out" || flow === "income")) await applyCategory(db, saved, cat, tag, { remember, scope: applyPast && matching.length > 0 ? "all" : "one" });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save changes. Please try again."); } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!db) return;
    await deleteTxn(db, txn.id);
    onClose();
  };

  return (
    <Sheet
      open={!!txn}
      onClose={onClose}
      title="Edit transaction"
      footer={
        confirmDelete ? (
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
            <button className="btn-danger flex-1 bg-coral text-ink-950 hover:bg-coral" onClick={remove} data-testid="txn-confirm-delete">
              Delete permanently
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button className="btn-danger" onClick={() => setConfirmDelete(true)} data-testid="txn-delete">
              Delete
            </button>
            <button className="btn-primary flex-1" onClick={save} disabled={saving} data-testid="txn-save">
              Save changes
            </button>
          </div>
        )
      }
    >
      <div className="space-y-4">
        {txn.needsReview && <p className="rounded-xl bg-amber/10 p-3 text-sm text-amber">⚠️ {txn.reviewReason ?? "Needs review"}</p>}
        {(() => {
          const refunded = txns.filter((t) => isReimbursementKind(t.kind) && t.refundOf === txn.id).reduce((s, t) => s + t.amountPaise, 0);
          return refunded > 0 ? (
            <p className="rounded-xl bg-lime/10 p-3 text-sm text-lime">
              ↩️ {formatINR(refunded)} returned — {formatINR(Math.max(0, txn.amountPaise - refunded))} net payment after refunds and settlements.
            </p>
          ) : null;
        })()}
        <AmountInput big value={amount} onChange={setAmount} aria-label="Amount" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Account"><select aria-label="Transaction account" className="input" value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Account unknown</option>{data?.accounts.map(a=><option key={a.id} value={a.id}>{a.bank} {a.kind} ··{a.last4}</option>)}</select></Field>
          <Field label="Date">
            <input type="date" className="input" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Merchant">
            <input data-preserve-case className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
          </Field>
        </div>

        <div>
          <span className="label">Type</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(FLOW_LABEL) as Flow[]).map((f) => (
              <button
                key={f}
                className={cx("chip", flow === f && "chip-on")}
                onClick={() => {
                  setFlow(f);
                  if (f === "income" && category !== "Income") (setCategory("Income"), setTag(""));
                  if (f === "out" && ["Income", "Refunds", "Settlement", "Transfers"].includes(category)) (setCategory("Other"), setTag(""));
                }}
              >
                {FLOW_LABEL[f]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-400">{FLOW_HELP[flow]}</p>
        </div>
        {(flow === "refund" || flow === "settlement") && (
          <Field label={flow === "settlement" ? "Settlement for which expense?" : "Refund for which expense?"} hint="Linked refunds and settlements reduce the original payment’s net cost. Unlinked credits stay flagged.">
            <select className="input" value={refundOf} onChange={(e) => setRefundOf(e.target.value)} data-testid="txn-original-expense">
              <option value="">Not linked (flag for review)</option>
              {refundOpts.map(({ t, suggested }) => (
                <option data-preserve-case key={t.id} value={t.id}>
                  {suggested ? "★ " : ""}
                  {formatDay(t.date)} · {t.merchant} · {formatINR(t.amountPaise)}
                </option>
              ))}
            </select>
          </Field>
        )}

        {(flow === "out" || flow === "income") && (
          <>
            <Field label="Category">
              <select className="input" value={category} onChange={(e) => (setCategory(e.target.value), setTag(""), setCommitmentId(""))} data-testid="txn-category">
                {[...new Set([...CATEGORIES.filter((c) => (flow === "income" ? c === "Income" : !["Income", "Refunds", "Settlement", "Transfers"].includes(c))), category])].map((c) => (
                  <option key={c} value={c}>
                    {categoryEmoji(c)} {displayCategory(c)}
                  </option>
                ))}
              </select>
            </Field>
            <div>
              <span className="label">Tag</span>
              <div className="flex flex-wrap gap-1.5" data-testid="txn-tags">
                {[...new Set([...(TAGS[category] ?? []), ...(tag ? [tag] : [])])].map((t) => (
                  <button key={t} className={cx("chip", tag === t && "chip-on")} onClick={() => setTag(tag === t ? "" : t)}>
                    {t}
                  </button>
                ))}
                <input className="input min-h-[36px] w-32 rounded-full px-3 text-[13px]" placeholder="Other tag" value={(TAGS[category] ?? []).includes(tag) ? "" : tag} onChange={(e) => setTag(e.target.value)} maxLength={24} aria-label="Custom tag" />
              </div>
            </div>
            {flow === "out" && lineOpts.length > 0 && (
              <Field label="Planned line" hint={autoLine ? `Auto-matched to ${autoLine.name}. A difference from the planned amount moves that day's budget.` : "Not matched to a planned line: the full amount counts against today's budget."}>
                <select className="input" value={commitmentId} onChange={(e) => setCommitmentId(e.target.value)} data-testid="txn-commitment">
                  <option value="">Auto{autoLine ? ` (${autoLine.name})` : ""}</option>
                  {lineOpts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {formatINR(c.amountPaise)} · due {c.dueDay}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {matching.length > 0 && (
              <label className="flex items-start gap-2 rounded-xl bg-lime/10 p-3 text-sm text-ink-200">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-lime" checked={applyPast} onChange={(e) => setApplyPast(e.target.checked)} data-testid="txn-apply-past" />
                <span>Apply the same category and tag to {matching.length} other transaction{matching.length === 1 ? "" : "s"} in the last 12 months?
                  <span className="block text-xs text-ink-400">Same recipient: {txn.payee || merchant}. Older payments stay unchanged.</span>
                </span>
              </label>
            )}
            {classChanged && recipientKey({ ...txn, merchant }) && <label className="flex items-center gap-2 text-sm text-ink-300">
              <input type="checkbox" className="h-4 w-4 accent-lime" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="txn-remember" />
              <span className="min-w-0">
                Remember for future payments to{" "}
                {txn.payee ? <span className="num text-white">{txn.payee}</span> : <>“{merchant || "this merchant"}”</>}
                <span className="block text-xs text-ink-400">New transactions will use this category and tag automatically.</span>
              </span>
            </label>}
          </>
        )}

        <Field label="Note">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} />
        </Field>

        {error && <p className="text-sm text-coral">{error}</p>}

        <div className="rounded-2xl bg-white/[0.03] p-3 text-xs text-ink-400">
          <div className="mb-1 flex items-center gap-2">
            Source <Pill tone={txn.source.providerId === "demo" ? "violet" : "default"}>{providerName(txn.source.providerId)}</Pill>
            <Pill>{txn.method.toUpperCase()}</Pill>
          </div>
          {txn.source.raw && <div className="break-all">“{txn.source.raw}”</div>}
          {txn.source.externalRef && <div>Ref: {txn.source.externalRef}</div>}
          <div>Added {new Date(txn.source.importedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</div>
        </div>
      </div>
    </Sheet>
  );
}
