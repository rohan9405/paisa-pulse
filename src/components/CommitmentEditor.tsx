"use client";

import { paiseToRupeeInput, rupeesInputToPaise } from "@/lib/money";
import type { Commitment, CommitmentKind } from "@/lib/types";
import { uid } from "@/data/db";
import { AmountInput, cx } from "./ui";

export interface CommitmentDraft {
  id: string;
  name: string;
  kind: CommitmentKind;
  amount: string;
  dueDay: string;
  matchHint: string;
  alreadyPaid: boolean;
}

export const PRESETS: { name: string; kind: CommitmentKind; dueDay: number; hint?: string }[] = [
  { name: "Rent", kind: "bill", dueDay: 1, hint: "rent" },
  { name: "Electricity", kind: "bill", dueDay: 10, hint: "electricity" },
  { name: "Internet", kind: "bill", dueDay: 8, hint: "fiber" },
  { name: "Phone", kind: "bill", dueDay: 15 },
  { name: "EMI", kind: "bill", dueDay: 5, hint: "emi" },
  { name: "Insurance", kind: "bill", dueDay: 20, hint: "insurance" },
  { name: "SIP", kind: "savings", dueDay: 5, hint: "sip" },
  { name: "RD / savings", kind: "savings", dueDay: 10 },
];

export function newDraft(p?: Partial<CommitmentDraft>): CommitmentDraft {
  return { id: uid("c-"), name: "", kind: "bill", amount: "", dueDay: "1", matchHint: "", alreadyPaid: false, ...p };
}

export function draftFromCommitment(c: Commitment): CommitmentDraft {
  return { id: c.id, name: c.name, kind: c.kind, amount: paiseToRupeeInput(c.amountPaise), dueDay: String(c.dueDay), matchHint: c.matchHint ?? "", alreadyPaid: false };
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
    else commitments.push({ id: d.id, name: d.name.trim(), kind: d.kind, amountPaise: amount, dueDay: day, matchHint: d.matchHint.trim() || undefined });
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
            {(["bill", "savings"] as const).map((k) => (
              <button key={k} className={cx("chip", d.kind === k && "chip-on")} onClick={() => set(d.id, { kind: k })}>
                {k === "bill" ? "🧾 Fixed bill" : "🏦 Savings / SIP"}
              </button>
            ))}
            {showPaid && (
              <label className="ml-auto flex min-h-[36px] items-center gap-2 text-[13px] text-ink-300">
                <input type="checkbox" className="h-4 w-4 accent-lime" checked={d.alreadyPaid} onChange={(e) => set(d.id, { alreadyPaid: e.target.checked })} />
                Paid this month
              </label>
            )}
          </div>
          <input className="input text-sm" placeholder="Match text in bank narration (optional, e.g. nobroker)" value={d.matchHint} onChange={(e) => set(d.id, { matchHint: e.target.value })} aria-label="Match hint" />
          {errors[d.id] && <p className="text-xs text-coral">{errors[d.id]}</p>}
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.filter((p) => !drafts.some((d) => d.name === p.name)).map((p) => (
          <button key={p.name} className="chip" onClick={() => onChange([...drafts, newDraft({ name: p.name, kind: p.kind, dueDay: String(p.dueDay), matchHint: p.hint ?? "" })])}>
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
