"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { computeLedger } from "@/lib/budget";
import { addDays, addMonths, diffDays, formatDay, formatMonth, isDateKey, monthKey, toISTKey } from "@/lib/dates";
import { calendarSlots, dailyAnalytics, type MoneyFlow } from "@/lib/dailyAnalytics";
import { weeklyInsight } from "@/lib/overview";
import { formatINR } from "@/lib/money";
import { DEFAULT_PREFS, type Transaction } from "@/lib/types";
import { useBudget } from "@/data/useBudget";
import { useRemoteConfig } from "@/data/remoteConfigLoader";
import { useQuickAdd } from "@/components/AppShell";
import { HoldList } from "@/components/HoldList";
import { Notices } from "@/components/Notices";
import { InsightCard, SyncPill } from "@/components/Overview";
import { TxnEditor } from "@/components/TxnEditor";
import { TxnRow } from "@/components/TxnRow";
import { CategoryStrip, SnapshotVisuals, DailyDelta, WeeklyTrend, HEAT_COLORS, INCOME_HEAT_COLORS } from "@/components/DailyVisuals";
import { Card, EmptyState, Money, SectionTitle, cx } from "@/components/ui";

export default function TodayPage() {
  const { data, derived, today } = useBudget();
  const config = useRemoteConfig();
  const { open } = useQuickAdd();
  const [selected, setSelected] = useState<string | null>(null);
  const [flow, setFlow] = useState<MoneyFlow>("spent");
  const [calendarMonth, setCalendarMonth] = useState(monthKey(today));
  const [bar, setBar] = useState<string | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);
  const day = selected ?? today;

  // Older briefing/widget links open the same unified view, including its date.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("day");
    if (requested && isDateKey(requested) && requested <= today && data?.profile && requested >= data.profile.trackingStart) {
      setSelected(requested); setCalendarMonth(monthKey(requested));
    }
  }, [today, data?.profile?.trackingStart]);

  const stats = useMemo(() => data?.profile ? dailyAnalytics(data.txns, data.profile.trackingStart, day, flow) : null, [data?.txns, data?.profile?.trackingStart, day, flow]);
  const insight = useMemo(() => config.features.insights && data?.profile && diffDays(data.profile.trackingStart, day) >= 35 ? weeklyInsight(data.txns, data.plans, day, { categoryOnly: true }) : null, [data?.txns, data?.plans, day, config.features.insights]);
  const slots = useMemo(() => calendarSlots(calendarMonth), [calendarMonth]);
  const calendarValues = useMemo(() => {
    if (!data?.profile) return new Map<string, number>();
    // Calendar is a date picker; no amounts from later dates enter the selected snapshot.
    const values = new Map<string, number>();
    // Calendar intensity uses confirmed entries, not budget performance.
    const entries = flow === "spent" ? computeLedger({ plans: data.plans, profile: data.profile, txns: data.txns, today }).days.map((r) => ({ date: r.date, value: r.expensePaise })) : data.txns.filter((t) => t.kind === "income" && t.date <= today).map((t) => ({ date: t.date, value: t.amountPaise }));
    for (const e of entries) values.set(e.date, (values.get(e.date) ?? 0) + e.value);
    return values;
  }, [data?.txns, data?.plans, data?.profile, flow, today]);

  const heatReference = useMemo(() => {
    const values = [...calendarValues].filter(([date, amount]) => monthKey(date) === calendarMonth && amount > 0).map(([, amount]) => amount).sort((a, b) => a - b);
    return values.length ? values[Math.floor(values.length / 2)] : 1;
  }, [calendarValues, calendarMonth]);
  const heatLevel = (date: string) => {
    const amount = calendarValues.get(date) ?? 0;
    return amount <= 0 ? 0 : amount <= heatReference * 0.5 ? 1 : amount <= heatReference ? 2 : amount <= heatReference * 2 ? 3 : 4;
  };

  // Keep the calendar at the same viewport position even if category names or
  // remote notices change height above it. No scroll-to-top or route navigation.
  const keepAnchor = () => { anchor.current = calendarRef.current?.getBoundingClientRect().top ?? null; };
  useLayoutEffect(() => {
    if (anchor.current !== null && calendarRef.current) {
      const delta = calendarRef.current.getBoundingClientRect().top - anchor.current;
      if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: "instant" });
      anchor.current = null;
    }
  }, [day, flow, calendarMonth]);
  const pickDay = (date: string) => { if (date === day) return; keepAnchor(); setSelected(date === today ? null : date); setBar(null); };
  const pickFlow = (value: MoneyFlow) => { if (value === flow) return; setFlow(value); setBar(null); };

  if (!data?.profile || !derived || !stats) return null;
  const live = day === today;
  const trackingStart = data.profile.trackingStart;
  const hasStarted = day >= trackingStart;
  const selectedBar = stats.trend7.find((d) => d.date === bar);
  const summary = flow === "spent" ? "Spent" : "Income";
  const dayLabel = live ? "today" : formatDay(day);
  const dayTxns = stats.dayEntries.map((e) => data.txns.find((t) => t.id === e.id)!).filter(Boolean);
  const sms = data.connections.find((c) => c.providerId === "sms");
  const showBalances = config.features.balances && (data.profile.prefs?.balances ?? DEFAULT_PREFS.balances);
  const reviewCount = data.txns.filter((t) => t.needsReview).length;
  const upcoming = derived.upcoming;

  return <div className="mx-auto max-w-2xl pb-2" data-testid="unified-today">
    <div className="mb-4 mt-3 flex min-h-8 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2"><h1 className="truncate text-lg font-semibold">{config.screens.today?.title ?? "Today"}</h1><span className="shrink-0 text-xs text-ink-400">{formatDay(day, { weekday: true })}</span></div>
      <SyncPill connection={sms} />
    </div>
    <Notices />
    {!hasStarted ? <EmptyState emoji="⏳" title={`Tracking starts ${formatDay(trackingStart)}`} /> : <>
      <Card className="overflow-hidden p-4 sm:p-5" data-testid="money-summary">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex gap-1 rounded-full bg-white/[0.04] p-1" role="tablist" aria-label="Money flow">
            {(["spent", "income"] as const).map((f) => <button key={f} role="tab" aria-selected={flow === f} className={cx("min-h-9 rounded-full px-4 text-sm font-semibold", flow === f ? "bg-white/10 text-white" : "text-ink-400")} onClick={() => pickFlow(f)}>{f === "spent" ? "Spent" : "Income"}</button>)}
          </div>
          <button className={cx("btn-ghost min-h-9 px-3 text-xs", live && "invisible")} onClick={() => pickDay(today)}>Back to today</button>
        </div>
        <div className="mt-4 text-xs text-ink-400" data-testid="summary-date">{summary} {dayLabel}</div>
        <div className="mt-1 flex flex-wrap items-center gap-3"><div className={cx("num truncate text-[40px] font-bold leading-tight sm:text-5xl", flow === "income" && "text-lime")} data-testid={flow === "spent" ? "spent-today" : "income-today"}><Money paise={stats.dayPaise} decimals="never" /></div><DailyDelta stats={stats} flow={flow} /></div>
        <CategoryStrip stats={stats} flow={flow} />
        <SnapshotVisuals stats={stats} live={live} month={formatMonth(monthKey(day)).split(" ")[0]} flow={flow} />

      </Card>

      {flow === "spent" && insight && <div className="my-3" data-testid="pattern-insights"><InsightCard insight={insight} /></div>}

      <Card className="mt-1 p-4" data-testid="week">
        <div className="flex h-6 items-center justify-between gap-2"><h2 className="text-sm font-semibold">Last 7 days</h2><span className="num text-xs text-ink-300" aria-live="polite" data-testid="bar-value">{selectedBar ? `${formatDay(selectedBar.date)} · ${formatINR(selectedBar.amountPaise)}` : "Tap a bar"}</span></div>
        <WeeklyTrend stats={stats} flow={flow} selected={bar} onSelect={setBar} />
      </Card>

      <div ref={calendarRef} className="mt-3 [overflow-anchor:none]" data-testid="calendar-anchor">
        <Card className="p-4" data-testid="calendar">
          <div className="mb-3 flex h-9 items-center justify-between gap-2"><button className="btn-ghost h-9 w-9 min-h-0 px-0" aria-label="Previous calendar month" disabled={calendarMonth <= monthKey(trackingStart)} onClick={() => { keepAnchor(); setCalendarMonth(addMonths(calendarMonth, -1)); }}>‹</button><h2 className="text-sm font-semibold">{formatMonth(calendarMonth)}</h2><button className="btn-ghost h-9 w-9 min-h-0 px-0" aria-label="Next calendar month" disabled={calendarMonth >= monthKey(today)} onClick={() => { keepAnchor(); setCalendarMonth(addMonths(calendarMonth, 1)); }}>›</button></div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-400">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={`weekday-${i}`} className="pb-1">{d}</span>)}
            {slots.map((date, i) => date ? <button key={date} className={cx("num flex h-9 items-center justify-center rounded-lg text-xs font-semibold sm:h-10", (flow === "spent" ? HEAT_COLORS : INCOME_HEAT_COLORS)[heatLevel(date)], date === day ? "ring-2 ring-lime ring-offset-2 ring-offset-ink-850" : date === today ? "ring-1 ring-white/40" : "", (date > today || date < trackingStart) && "opacity-20")} disabled={date > today || date < trackingStart} aria-label={`Select ${formatDay(date, { weekday: true, year: true })}`} aria-pressed={date === day} onClick={() => pickDay(date)} data-level={heatLevel(date)} data-testid={`calendar-${date}`}>{Number(date.slice(8))}</button> : <span key={`empty-${i}`} className="h-9 sm:h-10" />)}
          </div>
          <div className="mt-3 flex h-11 items-center justify-between gap-2 border-t border-white/5 pt-2 text-xs" aria-live="polite" data-testid="calendar-summary"><span className="text-ink-400">{formatDay(day)} · {summary.toLowerCase()}</span><Money paise={stats.dayPaise} className="num font-semibold" /></div>
        </Card>
      </div>

      <details className="mt-3 rounded-2xl border border-white/5 bg-white/[0.02] p-4" data-testid="day-payments"><summary className="cursor-pointer text-sm font-semibold">{dayTxns.length} {flow === "spent" ? "payment" : "credit"}{dayTxns.length === 1 ? "" : "s"} · {dayLabel}</summary><div className="mt-2" data-testid="today-list">{dayTxns.map((t) => <TxnRow key={t.id} t={t} onClick={() => setEditing(t)} />)}{!dayTxns.length && <p className="text-xs text-ink-400">Nothing recorded.</p>}</div></details>
    </>}

    <SectionTitle action={<Link href="/transactions" className="text-xs text-ink-400">{reviewCount ? `Review ${reviewCount}` : "Activity"} →</Link>}>Upcoming · now</SectionTitle>
    <Card className="divide-y divide-white/5 py-1" data-testid="coming-up">{upcoming.length ? upcoming.slice(0, 5).map((u) => <div key={u.key} className="flex min-h-14 items-center justify-between gap-3 py-2 text-sm" data-testid="due-item"><span className="min-w-0"><span className="block truncate">{u.name}</span><span className={cx("text-[11px]", ["overdue", "missed"].includes(u.state) ? "text-amber" : "text-ink-400")}>{u.state === "missed" ? "Payment not seen" : u.state === "overdue" ? "Overdue" : u.dueDate === today ? "Today" : diffDays(today, u.dueDate) === 1 ? "Tomorrow" : formatDay(u.dueDate)}</span></span><Money paise={u.amountPaise} decimals="never" className="num shrink-0" /></div>) : <p className="py-3 text-xs text-ink-400">No upcoming payments.</p>}{upcoming.length > 5 && <Link className="block py-3 text-xs text-lime" href="/settings">All {upcoming.length} reminders →</Link>}</Card>
    {showBalances && <><SectionTitle>Current balances</SectionTitle><Card className="divide-y divide-white/5 py-1" data-testid="balances">{data.accounts.length ? data.accounts.map((a) => <div key={a.id} className="flex min-h-14 items-center justify-between gap-3 py-2 text-sm" data-testid="balance"><span>{a.bank} ··{a.last4}<span className="block text-[11px] text-ink-400">{a.kind === "card" ? "Available limit" : "Balance"} · {formatDay(toISTKey(a.asOf))}</span></span><Money paise={a.balancePaise} decimals="never" className="num shrink-0" /></div>) : <p className="py-3 text-xs text-ink-400">No balances reported yet.</p>}</Card></>}
    <HoldList holds={data.holds} />
    <div className="mt-4 flex justify-end"><button className="btn-ghost text-xs" onClick={() => open()} data-testid="today-add">+ Cash spend</button></div>
    <TxnEditor txn={editing} onClose={() => setEditing(null)} />
  </div>;
}
