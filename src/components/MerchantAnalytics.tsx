"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Money, Segmented } from "./ui";
import { categoryColor } from "@/lib/categoryColors";
import { categoryEmoji } from "@/lib/categorize";
import { addMonths, endOfMonth, formatMonth, monthKey } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { hasMerchantMonthlyHistory, merchantBreakdown, merchantMonthlyHistory } from "@/lib/merchantAnalytics";
import type { categoryBreakdown } from "@/lib/budget";
import type { Transaction } from "@/lib/types";

type MonthlyRow = ReturnType<typeof merchantMonthlyHistory>[number];
export function MerchantAnalytics({ txns, from, to, trackingStart, categories }: { txns: Transaction[]; from: string; to: string; trackingStart: string; categories: ReturnType<typeof categoryBreakdown> }) {
  const rows = useMemo(() => merchantBreakdown(txns, from, to), [txns, from, to]);
  const [group, setGroup] = useState<"category" | "merchant">("category");
  const [chosen, setChosen] = useState("");
  const [showAll, setShowAll] = useState(false);
  // The selector ranks merchants by total net spend across the displayed twelve months,
  // independently of the Week/Month filter on the period breakdown.
  const historyMerchants = useMemo(() => merchantBreakdown(txns, `${addMonths(monthKey(to), -11)}-01`, to), [txns, to, trackingStart]);
  const selected = historyMerchants.find(r => r.key === chosen) ?? historyMerchants[0];
  const history = useMemo(() => merchantMonthlyHistory(txns, selected?.key ?? "", to, trackingStart), [txns, selected?.key, to, trackingStart]);
  const showHistory = useMemo(() => hasMerchantMonthlyHistory(txns, trackingStart, to), [txns, trackingStart, to]);
  const total = rows.reduce((s, r) => s + r.amountPaise, 0);
  const catTotal = categories.reduce((s, r) => s + r.amountPaise, 0);
  const catMax = Math.max(1, ...categories.map(r => r.amountPaise));
  const chart = history.map(h => ({ ...h, value: h.tracked ? h.amountPaise / 100 : null, label: formatMonth(h.month).split(" ")[0] }));
  return <>
    <Card data-testid="expense-breakdown">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Expenses by</h2><Segmented value={group} onChange={setGroup} options={[{ value: "category", label: "Category" }, { value: "merchant", label: "Merchant" }]} /></div>
      <p className="mb-4 text-xs text-ink-400">Share of expenses in this period · investments excluded</p>
      {group === "category" ? (!categories.length ? <p className="py-6 text-center text-sm text-ink-400">No expenses in this period.</p> : <div className="space-y-3" data-testid="category-breakdown">{categories.map(c => <Link key={c.category} href={`/transactions?month=${monthKey(to)}&category=${encodeURIComponent(c.category)}`} className="block rounded-lg p-1 hover:bg-white/[0.03] focus-visible:outline-lime" title={`${c.category}: ${formatINR(c.amountPaise)} across ${c.count} transactions`}>
        <div className="flex items-baseline justify-between gap-2 text-sm"><span className="min-w-0 truncate">{categoryEmoji(c.category)} {c.category}<span className="ml-1.5 text-xs text-ink-400">×{c.count}</span></span><span className="num shrink-0"><Money paise={c.amountPaise} /><span className="ml-2 inline-block w-9 text-right text-xs text-ink-400">{Math.round(c.amountPaise / Math.max(1, catTotal) * 100)}%</span></span></div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full" style={{ width: `${c.amountPaise / catMax * 100}%`, backgroundColor: categoryColor(c.category) }} /></div>
      </Link>)}</div>) : (!rows.length ? <p className="py-6 text-center text-sm text-ink-400">No expenses in this period.</p> : <div className="space-y-3" data-testid="merchant-breakdown">
        {(showAll ? rows : rows.slice(0, 8)).map(r => <button key={r.key} onClick={() => setChosen(r.key)} aria-pressed={selected?.key === r.key} className="block w-full rounded-xl p-1 text-left hover:bg-white/[0.04] focus-visible:outline-lime">
          <div className="flex items-baseline justify-between gap-2 text-sm"><span className="min-w-0 truncate">{r.name}<span className="ml-1.5 text-xs text-ink-400">×{r.count}</span></span><span className="num shrink-0"><Money paise={r.amountPaise} /><span className="ml-2 inline-block w-9 text-right text-xs text-ink-400">{Math.round(r.amountPaise / Math.max(1, total) * 100)}%</span></span></div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full" style={{ width: `${r.amountPaise / rows[0].amountPaise * 100}%`, backgroundColor: categoryColor(r.category) }} /></div>
        </button>)}
        {rows.length > 8 && <button className="btn-ghost w-full" onClick={() => setShowAll(!showAll)}>{showAll ? "Show top 8" : `Show all ${rows.length} merchants`}</button>}
      </div>)}
    </Card>
    {showHistory && selected && <Card data-testid="merchant-history">
      <h2 className="font-semibold">Merchant monthly spends</h2>
      <label className="mt-3 block"><span className="sr-only">Merchant for monthly spends</span><select className="input" value={selected.key} onChange={e => setChosen(e.target.value)}>{historyMerchants.map(r => <option key={r.key} value={r.key}>{r.name} · {formatINR(r.amountPaise)}</option>)}</select></label>
      <p className="mt-2 text-[11px] text-ink-400">Merchants ranked by total spend in these 12 months</p>
      <div className="mt-4 flex items-start justify-between gap-3"><div><p className="text-xs text-ink-400">{formatMonth(monthKey(to))}{to < endOfMonth(to) ? " · through " + Number(to.slice(8)) : ""}</p><p className="mt-1 text-2xl font-bold num"><Money paise={history.at(-1)!.amountPaise} /></p></div><p className="max-w-36 text-right text-xs text-ink-400">Net of linked refunds and repayments</p></div>
      <div className="mt-4 h-60" role="img" aria-label={`${selected.name}, monthly spends over twelve months. ${history.map(h => `${formatMonth(h.month)}: ${h.tracked ? formatINR(h.amountPaise) + (h.partial ? " (partial month)" : "") : "not tracked"}`).join("; ")}`}>
        <ResponsiveContainer width="100%" height="100%"><BarChart data={chart} margin={{ top: 12, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#ffffff10" vertical={false} /><XAxis dataKey="label" tick={{ fill: "#8b8b9e", fontSize: 9 }} tickLine={false} axisLine={false} interval={0} /><YAxis tick={{ fill: "#8b8b9e", fontSize: 10 }} tickLine={false} axisLine={false} width={60} tickFormatter={v => formatINR(v * 100, { compact: true })} />
          <Tooltip filterNull={false} cursor={{ fill: "#ffffff08" }} content={<MerchantMonthTooltip />} /><Bar dataKey="value" name="Spent" fill="#c6ff3d" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart></ResponsiveContainer>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-400">{formatMonth(history[0].month)} – {formatMonth(history.at(-1)!.month)}. Tap a month for its amount. Current and first tracking months may be partial; earlier untracked months aren’t zero spending.</p>
    </Card>}
  </>;
}
function MerchantMonthTooltip({ active, payload }: { active?: boolean; payload?: { payload?: MonthlyRow }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return <div className="rounded-xl border border-white/10 bg-ink-900 p-3 text-xs shadow-xl"><p className="text-ink-400">{formatMonth(row.month)}{row.tracked && row.partial ? " · partial" : ""}</p><p className="mt-1 font-semibold">{row.tracked ? formatINR(row.amountPaise) : "Not tracked"}</p></div>;
}
