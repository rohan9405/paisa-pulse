"use client";

import { useState } from "react";
import { categoryColor } from "@/lib/categoryColors";
import { formatDay } from "@/lib/dates";
import type { dailyAnalytics, MoneyFlow } from "@/lib/dailyAnalytics";
import { formatINR } from "@/lib/money";
import { Money, Segmented, cx } from "./ui";

type Snapshot = ReturnType<typeof dailyAnalytics>;

export function CategoryStrip({ stats, flow }: { stats: Snapshot; flow: MoneyFlow }) {
  const [picked, setPicked] = useState<string | null>(null);
  const key = (label: string) => `${stats.asOf}:${flow}:${label}`;
  const pick = (label: string) => setPicked(picked === key(label) ? null : key(label));
  return <div className="mt-4" data-testid="day-breakdown">
    <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-white/5" aria-label={flow === "spent" ? "Spending breakdown" : "Income sources"}>
      {stats.breakdown.map(c => <button type="button" key={c.label} onClick={() => pick(c.label)} aria-label={`${c.label}, ${formatINR(c.amountPaise)}`} style={{ flex: c.amountPaise, backgroundColor: categoryColor(flow === "income" ? "Income" : c.label) }} title={`${c.label} · ${formatINR(c.amountPaise)} · ${Math.round(100 * c.amountPaise / Math.max(1, stats.dayPaise))}%`} />)}
    </div>
    <div className="mt-2 grid h-[84px] grid-cols-2 content-start gap-x-4 gap-y-1 overflow-y-auto [scrollbar-width:thin]">
      {stats.breakdown.length ? stats.breakdown.map(c => <button key={c.label} type="button" onClick={() => pick(c.label)} aria-expanded={picked === key(c.label)} className="grid h-10 min-w-0 grid-cols-[6px_minmax(0,1fr)_auto] grid-rows-[16px_14px] items-center gap-x-1.5 py-1 text-left text-[11px]" data-testid={`category-${c.label}`}><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: categoryColor(flow === "income" ? "Income" : c.label) }} /><span className="truncate text-ink-300">{c.label}</span><span className="num text-right text-white">{Math.round(100 * c.amountPaise / Math.max(1, stats.dayPaise))}%</span><span className={cx("num col-span-2 col-start-2 row-start-2 text-[10px] text-white", picked !== key(c.label) && "invisible")}><Money paise={c.amountPaise} decimals="never" /></span></button>) : <span className="col-span-2 text-xs text-ink-400">No {flow === "spent" ? "expenses" : "income"} recorded.</span>}
    </div>
  </div>;
}

export function SnapshotVisuals({ stats, live, month, flow }: { stats: Snapshot; live: boolean; month: string; flow: MoneyFlow }) {
  const [period, setPeriod] = useState<"week" | "month">("month");
  return <div data-testid="snapshot-metrics" className="mt-2 space-y-3">
    <Segmented value={period} onChange={setPeriod} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
    {period === "week" ? <PeriodComparison current={stats.weekPaise} previous={stats.lastWeekPaise} currentLabel={live ? "This week (till date)" : "Week (till date)"} previousLabel="last week" flow={flow} id="week" /> : <PeriodComparison current={stats.monthPaise} previous={stats.lastMonthPaise} currentLabel={`${month} cumulative (till date)`} previousLabel="last month" flow={flow} id="month" />}
  </div>;
}

function PeriodComparison({ current, previous, currentLabel, previousLabel, flow, id }: { current: number; previous: number | null; currentLabel: string; previousLabel: string; flow: MoneyFlow; id: string }) {
  const max = Math.max(1, current, previous ?? 0);
  const shared = previous === null ? current : Math.min(current, previous);
  const difference = previous === null ? 0 : Math.abs(current - previous);
  const delta = previous ? Math.round((current / previous - 1) * 100) : current === 0 && previous === 0 ? 0 : null;
  const good = previous !== null && (flow === "spent" ? current < previous : current > previous);
  const tone = current === previous || previous === null ? "#8b8b9e" : good ? "#c6ff3d" : "#ff6b6b";
  const accent = flow === "spent" ? "#a78bfa" : "#c6ff3d";
  return <div className="rounded-2xl border border-white/[0.04] bg-white/[0.025] p-3" data-testid={`${id}-comparison`}>
    <div className="flex items-center justify-between gap-3 text-[11px]"><span className="text-ink-300">{currentLabel}</span><span className="num h-5 rounded-full px-2 py-0.5" style={{ color: tone, backgroundColor: `${tone}14` }} data-testid={`${id}-change`}>{delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}%`}</span></div>
    <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><span className="num text-xl font-semibold" data-testid={`${id}-total`}><Money paise={current} decimals="never" /></span><span className="text-[11px] text-ink-400">vs</span><span className="num text-xs text-ink-300" data-testid={`last-${id}-total`}>{previous === null ? "—" : <Money paise={previous} decimals="never" />}</span><span className="text-[10px] text-ink-400">{previousLabel}</span></div>
    <div className="relative my-3 h-3 rounded-full bg-white/5" role="img" aria-label={`${currentLabel}: ${formatINR(current)}; ${previousLabel}: ${previous === null ? "unavailable" : formatINR(previous)}`}>
      <div className="absolute inset-0 flex overflow-hidden rounded-full">
        <span className="h-full" style={{ width: `${100 * shared / max}%`, backgroundColor: accent }} />
        <span className="h-full" style={{ width: `${100 * difference / max}%`, backgroundColor: tone, opacity: current < (previous ?? 0) ? 0.4 : 1, backgroundImage: current < (previous ?? 0) ? "repeating-linear-gradient(120deg, transparent, transparent 3px, #07070a80 3px, #07070a80 5px)" : undefined }} />
      </div>
      {previous !== null && <span className="absolute -top-1 h-5 w-0.5 rounded-full bg-white" style={{ left: `clamp(0px, calc(${100 * previous / max}% - 1px), calc(100% - 2px))` }} />}
    </div>

  </div>;
}

export const HEAT_COLORS = ["bg-lime/10 text-lime", "bg-lime/25 text-lime", "bg-amber/30 text-amber", "bg-coral/35 text-[#ffb3b3]", "bg-coral text-ink-950"];

export const INCOME_HEAT_COLORS = ["bg-white/[0.025] text-ink-400", "bg-lime/10 text-lime", "bg-lime/25 text-lime", "bg-lime/50 text-white", "bg-lime text-ink-950"];

export function DailyDelta({ stats, flow }: { stats: Snapshot; flow: MoneyFlow }) {
  const avg = stats.rolling28DailyAvgPaise;
  const delta = avg ? Math.round((stats.dayPaise / avg - 1) * 100) : avg === 0 && stats.dayPaise === 0 ? 0 : null;
  const good = delta !== null && (flow === "spent" ? delta < 0 : delta > 0);
  return <span className={cx("num shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold", delta === null || delta === 0 ? "bg-white/5 text-ink-300" : good ? "bg-lime/10 text-lime" : "bg-coral/10 text-coral")} title={`Previous 28 completed days’ daily average: ${avg === null ? "unavailable" : formatINR(avg)}`} data-testid="daily-change">{delta === null ? "— vs 28d avg" : `${delta > 0 ? "+" : ""}${delta}% vs 28d avg`}</span>;
}

export function WeeklyTrend({ stats, flow, selected, onSelect }: { stats: Snapshot; flow: MoneyFlow; selected: string | null; onSelect: (date: string) => void }) {
  const avg = stats.rolling7DailyAvgPaise;
  const max = Math.max(1, (avg ?? 0) * 1.25, ...stats.trend7.map(d => d.amountPaise));
  const tone = (amount: number) => {
    if (avg === null) return "bg-violet";
    const low = amount < avg * 0.8 || amount === 0;
    const high = amount > avg * 1.2;
    return flow === "spent" ? low ? "bg-lime" : high ? "bg-coral" : "bg-amber" : low ? "bg-coral" : high ? "bg-lime" : "bg-amber";
  };
  return <>
    <div className="relative mt-3 h-24">
      <div className="flex h-full items-end gap-2">{stats.trend7.map(d => <button key={d.date} disabled={d.future || d.untracked} aria-label={`${formatDay(d.date, { weekday: true })}, ${flow} ${formatINR(d.amountPaise)}`} aria-pressed={selected === d.date} className="relative flex h-full min-w-0 flex-1 items-end rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" onClick={() => onSelect(d.date)} data-testid={`trend-${d.date}`}>
        <span className={cx("block w-full rounded-md", d.future || d.untracked ? "bg-white/[0.03]" : tone(d.amountPaise), selected === d.date && "ring-2 ring-white ring-offset-2 ring-offset-ink-850")} style={{ height: `${d.future || d.untracked ? 4 : Math.max(3, 100 * d.amountPaise / max)}%` }} />
      </button>)}</div>
      {avg !== null && <span data-testid="week-average-line" className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-dotted border-white/65" style={{ bottom: `${100 * avg / max}%` }} />}
    </div>
    <div className="mt-2 flex gap-2 text-center text-[11px] text-ink-400">{stats.trend7.map(d => <span key={d.date} className="flex-1">{new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "narrow", timeZone: "UTC" })}</span>)}</div>
    <div className="mt-3 flex min-h-4 items-center gap-2 text-[10px] text-ink-400" data-testid="week-average-label"><span className="w-5 border-t-2 border-dotted border-white/65" />7-day daily avg{avg === null ? " · unavailable" : ` · ${formatINR(avg)}`}</div>
  </>;
}
