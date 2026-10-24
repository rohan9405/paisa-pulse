"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDay, formatMonth } from "@/lib/dates";
import { spendHeatmap } from "@/lib/spendHeatmap";
import type { Transaction } from "@/lib/types";
import { Card, Money, cx } from "./ui";

// Low spend is pale; high spend is darker, all within the same blue hue.
const SHADES = ["#e5edf3", "#bed3e2", "#8eafc7", "#5b86a6", "#315b7a"];
export function SpendHeatmap({ txns, trackingStart, today, endMonth }: { txns: Transaction[]; trackingStart: string; today: string; endMonth: string }) {
  const view = useMemo(() => spendHeatmap(txns, trackingStart, today, endMonth), [txns, trackingStart, today, endMonth]);
  const scroller = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = view.days.find(d => d.date === picked && d.state === "tracked");
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [endMonth]);
  return <Card className="lg:col-span-2" data-testid="spend-heatmap">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">Spending activity</h2><span className="text-[11px] text-ink-400">{formatMonth(view.from.slice(0, 7))} – {formatMonth(endMonth)}</span></div>
    <div ref={scroller} className="mt-4 overflow-x-auto pb-2 [scrollbar-width:thin]" data-testid="heatmap-scroll">
      <div className="min-w-[820px]">
        <div className="mb-2 grid h-4 text-[10px] text-ink-400" style={{ gridTemplateColumns: `repeat(${view.weeks}, minmax(0, 1fr))`, gap: 3 }}>{view.months.map(m => <span className="whitespace-nowrap" key={m.month} style={{ gridColumn: m.column }}>{formatMonth(m.month).split(" ")[0]}</span>)}</div>
        <div className="grid grid-flow-col gap-[3px]" style={{ gridTemplateColumns: `repeat(${view.weeks}, minmax(0, 1fr))`, gridTemplateRows: "repeat(7, 14px)" }}>
          {view.days.map(d => <button key={d.date} type="button" disabled={d.state !== "tracked"} onClick={() => setPicked(d.date)} aria-label={`${formatDay(d.date, { weekday: true, year: true })}, ${d.amountPaise === null ? d.state : `${d.amountPaise / 100} rupees`}`} aria-pressed={selected?.date === d.date} title={`${formatDay(d.date)} · ${d.amountPaise === null ? d.state : `₹${d.amountPaise / 100}`}`} className={cx("rounded-[3px] border border-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white", d.state === "outside" && "invisible", selected?.date === d.date && "ring-2 ring-white ring-offset-1 ring-offset-ink-850")} style={{ backgroundColor: d.state === "tracked" ? SHADES[d.level] : "#ffffff08" }} data-testid={`heatmap-${d.date}`} data-level={d.level} data-state={d.state} />)}
        </div>
      </div>
    </div>
    <div className="mt-3 flex min-h-5 flex-wrap items-center justify-between gap-2 text-[10px] text-ink-400"><span aria-live="polite" data-testid="heatmap-value">{selected ? <>{formatDay(selected.date, { year: true })} · <Money paise={selected.amountPaise!} /></> : "Last 12 months"}</span><span className="flex items-center gap-1.5">Less{SHADES.map(shade => <span key={shade} className="h-2.5 w-2.5 rounded-sm border border-white/10" style={{ backgroundColor: shade }} />)}More</span></div>
  </Card>;
}
