"use client";

import { categoryEmoji } from "@/lib/categorize";
import { formatINR } from "@/lib/money";
import type { Transaction } from "@/lib/types";
import { KIND_LABEL } from "./TxnEditor";
import { Pill, cx } from "./ui";

export function TxnRow({ t, onClick, commitmentName }: { t: Transaction; onClick?: () => void; commitmentName?: string }) {
  const inflow = t.kind === "income" || t.kind === "refund";
  const muted = t.kind === "transfer";
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition hover:bg-white/[0.03] active:bg-white/[0.05]" data-testid="txn-row">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/[0.05] text-xl">{categoryEmoji(t.kind === "refund" ? "Refunds" : t.kind === "transfer" ? "Transfers" : t.category)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{t.merchant}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-400">
          <span className="truncate">{t.category}</span>
          {t.kind !== "expense" && <Pill tone={t.kind === "commitment" ? "sky" : t.kind === "investment" ? "violet" : t.kind === "refund" || t.kind === "income" ? "lime" : "default"}>{commitmentName ?? KIND_LABEL[t.kind]}</Pill>}
          {t.needsReview && <Pill tone="amber">review</Pill>}
          {t.method === "upi" && <span className="text-[10px] uppercase tracking-wider">UPI</span>}
        </span>
      </span>
      <span className={cx("num shrink-0 text-[15px] font-semibold", inflow ? "text-lime" : muted ? "text-ink-400 line-through decoration-ink-600" : "text-white")}>
        {inflow ? "+" : "−"}
        {formatINR(t.amountPaise).replace("−", "")}
      </span>
    </button>
  );
}
