"use client";

import { useMemo, useState } from "react";
import { dailyAnalytics, type MoneyFlow } from "@/lib/dailyAnalytics";
import { addDays, formatDay } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import type { Transaction } from "@/lib/types";
import { WeeklyTrend } from "./DailyVisuals";
import { Card } from "./ui";

/** Keyed by selected snapshot/flow in Today: calendar changes reset the range,
 * while inspecting older chart ranges leaves the daily snapshot untouched.
 */
export function TrendExplorer({ txns, trackingStart, asOf, today, flow }: { txns: Transaction[]; trackingStart: string; asOf: string; today: string; flow: MoneyFlow }) {
  const [end, setEnd] = useState(asOf);
  const [bar, setBar] = useState<string | null>(asOf);
  const stats = useMemo(() => dailyAnalytics(txns, trackingStart, end, flow), [txns, trackingStart, end, flow]);
  const first = stats.trend7[0].date;
  const selected = stats.trend7.find(d => d.date === bar);
  const move = (next: string) => { const clamped = next > today ? today : next; setEnd(clamped); setBar(clamped); };
  const year = first.slice(0, 4) !== end.slice(0, 4);
  return <Card className="mt-1 p-4" data-testid="week">
    <div className="flex h-6 items-center justify-between gap-2"><h2 className="text-sm font-semibold">{end === today ? "Last 7 days" : "7-day trend"}</h2><span className="num text-xs text-ink-300" aria-live="polite" data-testid="bar-value">{selected ? `${formatDay(selected.date)} · ${formatINR(selected.amountPaise)}` : "Slide or tap"}</span></div>
    <div className="mt-2 grid h-9 grid-cols-[36px_minmax(0,1fr)_36px] items-center gap-2">
      <button className="btn-ghost h-9 w-9 min-h-0 px-0" disabled={first <= trackingStart} aria-label="Previous 7 days" onClick={() => move(addDays(end, -7))}>‹</button>
      <span className="text-center text-[11px] text-ink-300" data-testid="trend-range">{formatDay(first, { year })} – {formatDay(end, { year })}</span>
      <button className="btn-ghost h-9 w-9 min-h-0 px-0" disabled={end >= today} aria-label="Next 7 days" onClick={() => move(addDays(end, 7))}>›</button>
    </div>
    <WeeklyTrend stats={stats} flow={flow} selected={bar} onSelect={setBar} />
  </Card>;
}
