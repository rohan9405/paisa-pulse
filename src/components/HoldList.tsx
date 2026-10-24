"use client";

import { useState } from "react";
import type { FundHold } from "@/lib/types";
import { Card, Money, SectionTitle, Sheet } from "./ui";
import { formatDay, toISTKey } from "@/lib/dates";

const LABEL: Record<FundHold["status"], string> = { blocked: "Funds blocked", partial: "Partly settled", settled: "Investment completed", released: "Funds released", needs_review: "Needs review" };
export function HoldList({ holds, history = false }: { holds: FundHold[]; history?: boolean }) {
  const [selected, setSelected] = useState<FundHold | null>(null);
  const rows = holds.filter((h) => history || h.remainingPaise > 0 || h.needsReview).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!rows.length) return null;
  return <section data-testid="ipo-holds">
    <SectionTitle>IPO · blocked funds</SectionTitle>
    <p className="mb-2 text-xs text-ink-400">Blocks are separate from spending. Only a confirmed debit counts as an investment.</p>
    <Card className="divide-y divide-white/5 py-1">{rows.map((h) => <button key={h.id} className="flex min-h-[56px] w-full items-center justify-between gap-3 py-3 text-left text-sm" onClick={() => setSelected(h)}>
      <span><span className="block font-semibold">{h.name}</span><span className="text-xs text-ink-400">{h.bank}{h.account ? ` ··${h.account}` : ""} · {LABEL[h.status]}</span></span>
      <Money paise={h.remainingPaise} className="shrink-0 text-amber" />
    </button>)}</Card>
    <Sheet open={!!selected} onClose={() => setSelected(null)} title="IPO funds">{selected && <div className="space-y-3 text-sm">
      <p className="font-semibold">{selected.name} · {LABEL[selected.status]}</p>
      <p className="break-all text-xs text-ink-400">{selected.reference || "No mandate reference in the message"}</p>
      <p>Blocked: <Money paise={selected.blockedPaise} /></p><p>Invested: <Money paise={selected.debitedPaise} /></p><p>Released: <Money paise={selected.releasedPaise} /></p><p>Still blocked: <Money paise={selected.remainingPaise} /></p>
      {selected.needsReview && <p className="rounded-xl bg-amber/10 p-3 text-amber">Some confirmations are missing or could not be linked safely. Check your bank’s IPO status. Expiry or cancellation alone does not confirm funds were released.</p>}
      <p className="text-xs text-ink-400">Bank balances are shown as reported; the block is not subtracted again.</p>
      {selected.events.map((e) => <details key={e.id} className="rounded-xl bg-white/[0.03] p-3"><summary>{formatDay(toISTKey(e.at))} · {e.type} · <Money paise={e.amountPaise} /></summary><p className="mt-2 break-words text-xs text-ink-400">{e.raw}</p></details>)}
    </div>}</Sheet>
  </section>;
}
