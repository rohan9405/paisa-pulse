"use client";

import { useEffect, useMemo, useState } from "react";
import { planForDate } from "@/lib/budget";
import { CATEGORIES, categoryEmoji } from "@/lib/categorize";
import { formatDay } from "@/lib/dates";
import { commitmentCandidates, refundCandidates } from "@/lib/match";
import { formatINR, paiseToRupeeInput, rupeesInputToPaise } from "@/lib/money";
import type { Transaction, TxnKind } from "@/lib/types";
import { correctCategory, deleteTxn, updateTxn } from "@/data/repo";
import { useAppData, useStore } from "@/data/store";
import { providerName } from "@/data/providers/registry";
import { AmountInput, Field, Pill, Sheet, cx } from "./ui";

export const KIND_LABEL: Record<TxnKind, string> = {
  expense: "Expense",
  commitment: "Bill / savings",
  investment: "Investment",
  transfer: "Own transfer",
  refund: "Refund",
  income: "Income",
};

export const KIND_HELP: Record<TxnKind, string> = {
  expense: "Counts against your daily budget.",
  commitment: "Pays a reserved bill or savings target — already set aside, not deducted again.",
  investment: "Money invested outside your savings targets. Shown in outgoings, not as spending.",
  transfer: "Between your own accounts. Ignored everywhere.",
  refund: "Money back. Link it to the original expense to restore budget.",
  income: "Money in. Doesn't change the daily budget.",
};

export function TxnEditor({ txn, onClose }: { txn: Transaction | null; onClose: () => void }) {
  const { db, today } = useStore();
  const data = useAppData();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("");
  const [remember, setRemember] = useState(false);
  const [kind, setKind] = useState<TxnKind>("expense");
  const [commitmentId, setCommitmentId] = useState("");
  const [refundOf, setRefundOf] = useState("");
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!txn) return;
    setAmount(paiseToRupeeInput(txn.amountPaise));
    setDate(txn.date);
    setMerchant(txn.merchant);
    setCategory(txn.category);
    setRemember(false);
    setKind(txn.kind);
    setCommitmentId(txn.commitmentId ?? "");
    setRefundOf(txn.refundOf ?? "");
    setNote(txn.note ?? "");
    setConfirmDelete(false);
    setError(null);
  }, [txn]);

  const plans = data?.plans ?? [];
  const txns = data?.txns ?? [];
  const draft = useMemo<Transaction | null>(
    () => (txn ? { ...txn, date: date || txn.date, merchant, amountPaise: rupeesInputToPaise(amount) ?? txn.amountPaise } : null),
    [txn, date, merchant, amount],
  );
  const commitmentOpts = useMemo(() => (draft ? planForDate(plans, draft.date)?.commitments ?? [] : []), [draft, plans]);
  const commitSuggest = useMemo(() => (draft ? commitmentCandidates(draft, plans, txns) : []), [draft, plans, txns]);
  const refundOpts = useMemo(() => {
    if (!draft) return [];
    const strong = refundCandidates(draft, txns).map((c) => c.expense);
    const recent = txns
      .filter((t) => t.kind === "expense" && t.date <= draft.date && t.amountPaise >= draft.amountPaise && !strong.some((s) => s.id === t.id))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 30);
    return [...strong.map((t) => ({ t, suggested: true })), ...recent.map((t) => ({ t, suggested: false }))];
  }, [draft, txns]);

  if (!txn) return null;

  const save = async () => {
    if (!db) return;
    const p = rupeesInputToPaise(amount);
    if (!p) return setError("Enter an amount above ₹0");
    if (!date || date > today) return setError("Pick a date up to today");
    if (kind === "commitment" && !commitmentId) return setError("Choose which bill or savings target this pays");
    const patch: Partial<Transaction> = {
      amountPaise: p,
      date,
      merchant: merchant.trim() || "Unknown",
      kind,
      note: note.trim() || undefined,
      commitmentId: kind === "commitment" ? commitmentId : undefined,
      refundOf: kind === "refund" && refundOf ? refundOf : undefined,
    };
    if (kind === "refund" && !refundOf) Object.assign(patch, { needsReview: true, reviewReason: "No original expense linked" });
    if (kind !== "refund" && txn.needsReview) Object.assign(patch, { needsReview: false, reviewReason: undefined });
    await updateTxn(db, txn.id, patch);
    if (category !== txn.category || remember) await correctCategory(db, { ...txn, merchant: patch.merchant! }, category, remember);
    onClose();
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
            <button className="btn-primary flex-1" onClick={save} data-testid="txn-save">
              Save changes
            </button>
          </div>
        )
      }
    >
      <div className="space-y-4">
        {txn.needsReview && <p className="rounded-xl bg-amber/10 p-3 text-sm text-amber">⚠️ {txn.reviewReason ?? "Needs review"}</p>}
        {(() => {
          const refunded = txns.filter((t) => t.kind === "refund" && t.refundOf === txn.id).reduce((s, t) => s + t.amountPaise, 0);
          return refunded > 0 ? (
            <p className="rounded-xl bg-lime/10 p-3 text-sm text-lime">
              ↩️ {formatINR(refunded)} refunded — {formatINR(Math.max(0, txn.amountPaise - refunded))} counts against your budget.
            </p>
          ) : null;
        })()}
        <AmountInput big value={amount} onChange={setAmount} aria-label="Amount" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input type="date" className="input" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Merchant">
            <input className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
          </Field>
        </div>

        <div>
          <span className="label">Type</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(KIND_LABEL) as TxnKind[]).map((k) => (
              <button key={k} className={cx("chip", kind === k && "chip-on")} onClick={() => setKind(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-400">{KIND_HELP[kind]}</p>
        </div>

        {kind === "commitment" && (
          <Field label="Pays which reservation?" hint={commitSuggest[0] ? `Suggested: ${commitSuggest[0].commitment.name} (${commitSuggest[0].reason})` : undefined}>
            <select className="input" value={commitmentId} onChange={(e) => setCommitmentId(e.target.value)} data-testid="txn-commitment">
              <option value="">Choose…</option>
              {commitmentOpts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {formatINR(c.amountPaise)} · due {c.dueDay}
                </option>
              ))}
            </select>
          </Field>
        )}
        {kind === "commitment" && commitmentOpts.length === 0 && <p className="text-xs text-amber">No bills or savings targets in your budget yet — add them in Settings.</p>}

        {kind === "refund" && (
          <Field label="Refund for which expense?" hint="Linked refunds restore budget on the original expense's day. Unlinked refunds stay flagged.">
            <select className="input" value={refundOf} onChange={(e) => setRefundOf(e.target.value)}>
              <option value="">Not linked (flag for review)</option>
              {refundOpts.map(({ t, suggested }) => (
                <option key={t.id} value={t.id}>
                  {suggested ? "★ " : ""}
                  {formatDay(t.date)} · {t.merchant} · {formatINR(t.amountPaise)}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Category">
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="txn-category">
            {[...new Set([...CATEGORIES, category])].map((c) => (
              <option key={c} value={c}>
                {categoryEmoji(c)} {c}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink-300">
          <input type="checkbox" className="h-4 w-4 accent-lime" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Always use this category for “{merchant || "this merchant"}”
        </label>

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
