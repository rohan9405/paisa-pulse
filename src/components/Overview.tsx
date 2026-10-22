"use client";

import { formatDay } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import type { CalendarDay, Insight, MonthPace, WeekDay } from "@/lib/overview";
import type { ProviderConnection } from "@/lib/types";
import { smsBridge } from "@/data/providers/sms";
import { Card, Money, ProgressBar, cx } from "./ui";

/** Month so far against the allowance, with where it's heading. */
export function PaceCard({ pace, hasBudget, lastMonthByNowPaise }: { pace: MonthPace; hasBudget: boolean; lastMonthByNowPaise?: number }) {
  const month = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", month: "long" });
  if (!hasBudget) {
    return (
      <Card data-testid="pace">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold">{month} so far</span>
          <Money paise={pace.spentPaise} className="num font-semibold" />
        </div>
        {lastMonthByNowPaise !== undefined && lastMonthByNowPaise > 0 && (
          <p className="mt-1 text-xs text-ink-400">
            Last month by day {pace.dayOfMonth}: <Money paise={lastMonthByNowPaise} />
          </p>
        )}
      </Card>
    );
  }
  const ratio = pace.allocatedPaise > 0 ? pace.spentPaise / pace.allocatedPaise : 0;
  const delta = pace.projectedDeltaPaise;
  return (
    <Card data-testid="pace">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold">{month} pace</span>
        <span className="text-xs text-ink-400">
          day {pace.dayOfMonth} of {pace.daysInMonth}
        </span>
      </div>
      <div className="mt-2">
        <ProgressBar value={Math.min(1, ratio)} tone={ratio > 1 ? "coral" : ratio > 0.9 ? "amber" : "lime"} />
      </div>
      <p className="mt-1.5 text-xs text-ink-400">
        <Money paise={pace.spentPaise} decimals="never" /> of <Money paise={pace.allocatedPaise} decimals="never" /> so far ·{" "}
        {delta === null ? (pace.onTrack ? "on track" : "over so far") : delta >= 0 ? <span className="text-lime">likely to end {formatINR(delta, { decimals: "never" })} under</span> : <span className="text-coral">heading {formatINR(-delta, { decimals: "never" })} over</span>}
      </p>
    </Card>
  );
}

/** Monday–Sunday bars; the line marks each day's allowance. */
export function WeekBars({ days, hasBudget, today }: { days: WeekDay[]; hasBudget: boolean; today: string }) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.spentPaise, d.allocationPaise)));
  return (
    <Card data-testid="week">
      <div className="mb-3 text-sm font-semibold">This week</div>
      <div className="flex h-20 items-end gap-2">
        {days.map((d) => {
          const over = hasBudget && d.spentPaise > d.allocationPaise;
          return (
            <div key={d.date} className="relative flex h-full flex-1 items-end" title={`${formatDay(d.date, { weekday: true })}: ${formatINR(d.spentPaise)}`}>
              {hasBudget && d.allocationPaise > 0 && <div className="absolute inset-x-0 border-t border-dashed border-white/25" style={{ bottom: `${(d.allocationPaise / max) * 100}%` }} />}
              <div
                className={cx("w-full rounded-md", d.future || d.untracked ? "bg-white/[0.06]" : over ? "bg-coral" : "bg-lime", d.date === today && "ring-2 ring-white/40")}
                style={{ height: d.future || d.untracked ? "6%" : `${Math.max(4, (d.spentPaise / max) * 100)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-2 text-center text-[11px] text-ink-400">
        {days.map((d) => (
          <span key={d.date} className={cx("flex-1", d.date === today && "font-semibold text-white")}>
            {new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "narrow", timeZone: "UTC" })}
          </span>
        ))}
      </div>
    </Card>
  );
}

const CAL_TONE: Record<CalendarDay["state"], string> = {
  under: "bg-lime/25 text-lime",
  nospend: "bg-lime/40 text-ink-950",
  over: "bg-coral/25 text-coral",
  spent: "bg-violet/25 text-violet",
  today: "bg-white/10 text-white ring-1 ring-white/40",
  future: "bg-white/[0.03] text-ink-600",
  untracked: "bg-white/[0.03] text-ink-600",
};

/** Month at a glance; tapping a tracked day opens its report. */
export function MonthCalendar({ blanks, days, hasBudget, selected, onPick }: { blanks: number; days: CalendarDay[]; hasBudget: boolean; selected?: string; onPick: (date: string) => void }) {
  const good = days.filter((d) => d.state === "under" || d.state === "nospend").length;
  return (
    <Card data-testid="calendar">
      <div className="mb-3 flex items-baseline justify-between text-sm">
        <span className="font-semibold">{new Date(`${days[0].date}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" })}</span>
        <span className="text-xs text-ink-400">{hasBudget ? `${good} under-budget day${good === 1 ? "" : "s"}` : "tap a day for its report"}</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] text-ink-400">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {days.map((d) => {
          const tappable = d.state !== "future" && d.state !== "untracked";
          return (
            <button
              key={d.date}
              disabled={!tappable}
              onClick={() => onPick(d.date)}
              aria-label={`${formatDay(d.date, { weekday: true })}${tappable ? `, spent ${formatINR(d.spentPaise)}` : ""}`}
              className={cx("num grid aspect-square place-items-center rounded-lg text-xs font-semibold", CAL_TONE[d.state], selected === d.date && "ring-2 ring-lime")}
            >
              {Number(d.date.slice(8))}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

export function InsightCard({ insight }: { insight: Insight }) {
  return (
    <Card className={cx("text-sm", insight.tone === "warn" ? "border-amber/30 bg-amber/[0.07] text-amber" : "border-lime/25 bg-lime/[0.06] text-lime")} data-testid="insight">
      💡 {insight.text}
    </Card>
  );
}

/** "synced 2m ago", shown only in the Android app where SMS sync runs. */
export function SyncPill({ connection }: { connection?: ProviderConnection }) {
  if (!smsBridge() || !connection?.lastSyncAt) return null;
  const mins = Math.floor((Date.now() - connection.lastSyncAt) / 60_000);
  const ago = mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold", connection.status === "error" ? "bg-coral/15 text-coral" : "bg-lime/10 text-lime")} data-testid="sync-pill">
      {connection.status === "error" ? "⚠️ sync error" : `↻ synced ${ago}`}
    </span>
  );
}
