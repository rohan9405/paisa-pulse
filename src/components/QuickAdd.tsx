"use client";

import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, categorize, categoryEmoji } from "@/lib/categorize";
import { formatINR, rupeesInputToPaise } from "@/lib/money";
import type { PaymentMethod } from "@/lib/types";
import { useAppData, useStore } from "@/data/store";
import { addManualTxn } from "@/data/repo";
import { AmountInput, Field, Sheet, Toast, cx } from "./ui";

const QUICK_CATS = ["Food & Dining", "Groceries", "Transport", "Shopping", "Entertainment", "Bills", "Health", "Other"];
const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "cash", label: "Cash" },
  { value: "netbanking", label: "Netbanking" },
  { value: "wallet", label: "Wallet" },
];

export function QuickAddSheet({ open, onClose, presetDate }: { open: boolean; onClose: () => void; presetDate?: string }) {
  const { db, today } = useStore();
  const data = useAppData();
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState<string>("");
  const [catTouched, setCatTouched] = useState(false);
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount("");
      setMerchant("");
      setCategory("");
      setCatTouched(false);
      setDate(presetDate ?? today);
      setMethod("upi");
      setNote("");
      setError(null);
    }
  }, [open, presetDate, today]);

  // Suggest a category from merchant rules until the user picks one.
  const suggestion = useMemo(() => (merchant && data ? categorize(merchant, data.rules) : null), [merchant, data]);
  useEffect(() => {
    if (!catTouched) setCategory(suggestion?.category ?? "");
  }, [suggestion, catTouched]);

  const trackingStart = data?.profile?.trackingStart;
  const paise = rupeesInputToPaise(amount);

  const save = async () => {
    if (!db) return;
    if (!paise) return setError("Enter an amount above ₹0");
    if (paise > 1_00_00_000_00) return setError("That's over ₹1 crore — double-check the amount");
    if (!date) return setError("Pick a date");
    if (date > today) return setError("Date can't be in the future");
    setSaving(true);
    try {
      await addManualTxn(db, { amountPaise: paise, merchant: merchant || category || "Expense", category: category || undefined, kind: category === "Income" ? "income" : undefined, date, method, note });
      const warn = trackingStart && date < trackingStart ? " (before tracking start — outside tracking summaries)" : "";
      setToast(`Added ${formatINR(paise)}${warn}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const allCats = useMemo(() => CATEGORIES.filter((c) => !["Refunds", "Transfers"].includes(c)), []);

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Add expense"
        footer={
          <button className="btn-primary h-12 w-full text-base" onClick={save} disabled={saving} data-testid="qa-save">
            {saving ? "Saving…" : paise ? `Add ${formatINR(paise)}` : "Add expense"}
          </button>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <AmountInput big value={amount} onChange={(v) => (setAmount(v), setError(null))} data-autofocus aria-label="Amount in rupees" data-testid="qa-amount" />
          {error && <p className="-mt-2 text-sm text-coral">{error}</p>}
          <Field label="Merchant / what">
            <input className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Swiggy, auto, chai…" maxLength={60} data-testid="qa-merchant" />
          </Field>
          <div>
            <span className="label">Category {suggestion && !catTouched && <span className="normal-case tracking-normal text-lime">· auto</span>}</span>
            <div className="-mx-1 flex flex-wrap gap-1.5">
              {QUICK_CATS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => (setCategory(c), setCatTouched(true))}
                  className={cx("chip", category === c && "chip-on")}
                >
                  {categoryEmoji(c)} {c}
                </button>
              ))}
              <select
                className={cx("chip bg-transparent pr-2", category && !QUICK_CATS.includes(category) && "chip-on")}
                value={QUICK_CATS.includes(category) ? "" : category}
                onChange={(e) => (setCategory(e.target.value), setCatTouched(true))}
                aria-label="More categories"
              >
                <option value="">More…</option>
                {allCats.filter((c) => !QUICK_CATS.includes(c)).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input type="date" className="input" value={date} max={today} onChange={(e) => setDate(e.target.value)} data-testid="qa-date" />
            </Field>
            <Field label="Paid via">
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Note (optional)">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Split with Riya…" maxLength={140} />
          </Field>
          <button type="submit" className="hidden" />
        </form>
      </Sheet>
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}
