"use client";

import { TAGS } from "@/lib/categorize";
import { paiseToRupeeInput, rupeesInputToPaise } from "@/lib/money";
import type { Commitment, CommitmentKind } from "@/lib/types";
import { uid } from "@/data/db";
import { AmountInput, cx } from "./ui";

export interface CommitmentDraft {
  id: string;
  name: string;
  kind: CommitmentKind;
  tag: string;
  amount: string;
  dueDay: string;
  matchHint: string;
  alreadyPaid: boolean;
}

export const PRESETS: { name: string; kind: CommitmentKind; tag: string; dueDay: number; hint?: string }[] = [
  { name: "Rent", kind: "bill", tag: "Rent", dueDay: 1 },
  { name: "Electricity", kind: "bill", tag: "Utility", dueDay: 10 },
  { name: "Internet", kind: "bill", tag: "Phone & internet", dueDay: 8 },
  { name: "Phone", kind: "bill", tag: "Phone & internet", dueDay: 15 },
  { name: "EMI", kind: "bill", tag: "EMI", dueDay: 5 },
  { name: "Insurance", kind: "bill", tag: "Insurance", dueDay: 20 },
  { name: "SIP", kind: "investment", tag: "SIP", dueDay: 5 },
  { name: "RD / FD", kind: "investment", tag: "RD / FD", dueDay: 10 },
];

const KIND_CHIPS: { kind: CommitmentKind; label: string }[] = [
  { kind: "bill", label: "🧾 Bills" },
  { kind: "investment", label: "📈 Investments" },
];
const KIND_CATEGORY: Record<CommitmentKind, string> = { bill: "Bills", investment: "Investments", savings: "Investments" };

export function newDraft(p?: Partial<CommitmentDraft>): CommitmentDraft {
  return { id: uid("c-"), name: "", kind: "bill", tag: "", amount: "", dueDay: "1", matchHint: "", alreadyPaid: false, ...p };
}

export function draftFromCommitment(c: Commitment): CommitmentDraft {
  return { id: c.id, name: c.name, kind: c.kind, tag: c.tag ?? "", amount: paiseToRupeeInput(c.amountPaise), dueDay: String(c.dueDay), matchHint: c.matchHint ?? "", alreadyPaid: false };
}

export function validateDrafts(drafts: CommitmentDraft[]): { commitments: Commitment[]; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const commitments: Commitment[] = [];
  for (const d of drafts) {
    const amount = rupeesInputToPaise(d.amount);
    const day = Number(d.dueDay);
    if (!d.name.trim()) errors[d.id] = "Give it a name";
    else if (!amount) errors[d.id] = "Enter an amount above ₹0";
    else if (!Number.isInteger(day) || day < 1 || day > 31) errors[d.id] = "Due day must be 1–31";
    else commitments.push({ id: d.id, name: d.name.trim(), kind: d.kind, tag: d.tag.trim() || undefined, amountPaise: amount, dueDay: day, matchHint: d.matchHint.trim() || undefined });
  }
  return { commitments, errors };
}

export function CommitmentList({
  drafts,
  onChange,
  errors,
  showPaid,
}: {
  drafts: CommitmentDraft[];
  onChange: (d: CommitmentDraft[]) => void;
  errors: Record<string, string>;
  showPaid?: boolean;
}) {
  const set = (id: string, patch: Partial<CommitmentDraft>) => onChange(drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  return (
    <div className="space-y-3">
      {drafts.map((d) => (
        <div key={d.id} className="card space-y-3 bg-ink-900" data-testid="commitment-row">
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="Name (e.g. Rent)" value={d.name} onChange={(e) => set(d.id, { name: e.target.value })} aria-label="Commitment name" />
            <button className="btn-ghost w-11 px-0 text-ink-300" onClick={() => onChange(drafts.filter((x) => x.id !== d.id))} aria-label={`Remove ${d.name || "commitment"}`}>
              ✕
            </button>
          </div>
          <div className="grid grid-cols-[1fr_88px] gap-2">
            <AmountInput value={d.amount} onChange={(v) => set(d.id, { amount: v })} aria-label="Monthly amount" />
            <input className="input num text-center" inputMode="numeric" value={d.dueDay} onChange={(e) => set(d.id, { dueDay: e.target.value.replace(/\D/g, "").slice(0, 2) })} aria-label="Due day of month" placeholder="Day" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {KIND_CHIPS.map(({ kind: k, label }) => (
              <button key={k} className={cx("chip", (d.kind === "savings" ? "investment" : d.kind) === k && "chip-on")} onClick={() => set(d.id, { kind: k, tag: (TAGS[KIND_CATEGORY[k]] ?? []).includes(d.tag) ? d.tag : "" })}>
                {label}
              </button>
            ))}
            {showPaid && (
              <label className="ml-auto flex min-h-[36px] items-center gap-2 text-[13px] text-ink-300">
                <input type="checkbox" className="h-4 w-4 accent-lime" checked={d.alreadyPaid} onChange={(e) => set(d.id, { alreadyPaid: e.target.checked })} />
                Paid this month
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(TAGS[KIND_CATEGORY[d.kind]] ?? []).map((t) => (
              <button key={t} className={cx("chip min-h-[30px] text-[12px]", d.tag === t && "chip-on")} onClick={() => set(d.id, { tag: d.tag === t ? "" : t })}>
                {t}
              </button>
            ))}
          </div>
          <input className="input text-sm" placeholder="UPI ID or text in the bank SMS (optional, e.g. ramesh@okaxis)" value={d.matchHint} onChange={(e) => set(d.id, { matchHint: e.target.value })} aria-label="Match hint" />
          {errors[d.id] && <p className="text-xs text-coral">{errors[d.id]}</p>}
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.filter((p) => !drafts.some((d) => d.name === p.name)).map((p) => (
          <button key={p.name} className="chip" onClick={() => onChange([...drafts, newDraft({ name: p.name, kind: p.kind, tag: p.tag, dueDay: String(p.dueDay), matchHint: p.hint ?? "" })])}>
            + {p.name}
          </button>
        ))}
        <button className="chip" onClick={() => onChange([...drafts, newDraft()])}>
          + Custom
        </button>
      </div>
    </div>
  );
}
