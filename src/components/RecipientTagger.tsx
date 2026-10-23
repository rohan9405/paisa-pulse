"use client";

import { useState } from "react";
import { applyCategory } from "@/data/repo";
import { useStore } from "@/data/store";
import { CATEGORIES, TAGS, categoryEmoji } from "@/lib/categorize";
import { withinTaggingWindow } from "@/lib/recipients";
import type { Transaction } from "@/lib/types";
import { Field, Sheet, cx } from "./ui";

export function RecipientTagger({ txns, onClose }: { txns: Transaction[]; onClose: () => void }) {
  const { db, today } = useStore();
  const txn = txns[0];
  const [category, setCategory] = useState(txn.category);
  const [tag, setTag] = useState(txn.tag ?? "");
  const [remember, setRemember] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const eligible = txns.filter((t) => withinTaggingWindow(t, today));
  const changed = eligible.filter((t) => t.category !== category || t.tag !== (tag.trim() || undefined)).length;
  const save = async () => {
    if (!db || saving) return;
    setSaving(true);
    try {
      await applyCategory(db, txn, category, tag, { remember, scope: "all" });
      onClose();
    } catch { setError("Could not save tags. Please try again."); }
    finally { setSaving(false); }
  };
  return <Sheet open onClose={onClose} title="Tag recipient" footer={<button className="btn-primary w-full" disabled={saving} onClick={save} data-testid="recipient-save">{saving ? "Saving…" : `Apply to ${changed} transaction${changed === 1 ? "" : "s"}`}</button>}>
    <div className="space-y-4">
      <div><p className="font-semibold">{txn.merchant}</p>{txn.payee && <p className="break-all text-sm text-ink-400">{txn.payee}</p>}<p className="mt-1 text-sm text-ink-300">Updates matching {txn.kind === "income" ? "incoming" : "outgoing"} transactions in the last 12 months ({eligible.length} eligible). Only payments needing a category or tag change are updated. Older payments stay unchanged.</p></div>
      <Field label="Category"><select className="input" value={category} onChange={(e) => { setCategory(e.target.value); setTag(""); }} data-testid="recipient-category">
        {[...new Set([...(txn.kind === "income" ? ["Income"] : CATEGORIES.filter((c) => !["Income", "Refunds", "Transfers"].includes(c))), category])].map((c) => <option key={c} value={c}>{categoryEmoji(c)} {c}</option>)}
      </select></Field>
      <Field label="Tag"><div className="mb-2 flex flex-wrap gap-2">{(TAGS[category] ?? []).map((t) => <button key={t} className={cx("chip", tag === t && "chip-on")} onClick={() => setTag(tag === t ? "" : t)}>{t}</button>)}</div><input className="input" aria-label="Recipient tag" placeholder="Add a tag" maxLength={24} value={tag} onChange={(e) => setTag(e.target.value)} /></Field>
      <label className="flex items-start gap-2 text-sm text-ink-300"><input type="checkbox" className="mt-1 h-4 w-4 accent-lime" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span>Remember for future transactions<span className="block text-xs text-ink-400">Automatically use this category and tag for this recipient.</span></span></label>
      {error && <p role="alert" className="text-sm text-coral">{error}</p>}
    </div>
  </Sheet>;
}
