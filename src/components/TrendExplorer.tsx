"use client";

import { useMemo, useState } from "react";
import { dailyAnalytics, type MoneyFlow } from "@/lib/dailyAnalytics";
import { addDays, formatDay } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import type { Transaction } from "@/lib/types";
import { WeeklyTrend } from "./DailyVisuals";
import { Card, cx } from "./ui";

/** Keyed by selected snapshot/flow in Today: calendar changes reset the range,
 * while inspecting older chart ranges leaves the daily snapshot untouched.
 */
export function TrendExplorer({ txns, trackingStart, asOf, flow }: { txns: Transaction[]; trackingStart: string; asOf: string; flow: MoneyFlow }) {
  const [offset, setOffset] = useState(0);
  const [bar, setBar] = useState<string | null>(asOf);
  const end = addDays(asOf, offset * 7);
  const stats = useMemo(() => dailyAnalytics(txns, trackingStart, end, flow), [txns, trackingStart, end, flow]);
  const first = stats.trend7[0].date;
  const selected = stats.trend7.find(d => d.date === bar);
  const move = (next: number) => { setOffset(next); setBar(addDays(asOf, next * 7)); };
  const year = first.slice(0, 4) !== end.slice(0, 4);
  return <Card className="mt-1 p-4" data-testid="week">
    <div className="flex h-6 items-center justify-between gap-2"><h2 className="text-sm font-semibold">{offset === 0 ? "Last 7 days" : "7-day trend"}</h2><span className="num text-xs text-ink-300" aria-live="polite" data-testid="bar-value">{selected ? `${formatDay(selected.date)} · ${formatINR(selected.amountPaise)}` : "Slide or tap"}</span></div>
    <div className="mt-2 flex h-9 items-center justify-between gap-1"><button className="btn-ghost h-9 w-9 min-h-0 px-0" disabled={first <= trackingStart} aria-label="Previous 7 days" onClick={() => move(offset - 1)}>‹</button><span className="text-[11px] text-ink-300" data-testid="trend-range">{formatDay(first, { year })} – {formatDay(end, { year })}</span><button className={cx("btn-ghost min-h-0 px-2 py-1 text-[10px]", offset === 0 && "invisible")} onClick={() => move(0)} aria-label="Latest 7 days">Latest</button><button className="btn-ghost h-9 w-9 min-h-0 px-0" disabled={offset >= 0} aria-label="Next 7 days" onClick={() => move(Math.min(0, offset + 1))}>›</button></div>
    <WeeklyTrend stats={stats} flow={flow} selected={bar} onSelect={setBar} />
  </Card>;
}
