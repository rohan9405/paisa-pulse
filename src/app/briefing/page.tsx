"use client";

import { useState } from "react";
import { addDays, diffDays, formatDay, istHour } from "@/lib/dates";
import { categoryEmoji } from "@/lib/categorize";
import { formatINR } from "@/lib/money";
import { badges, eveningReport, morningBriefing } from "@/lib/insights";
import { monthCalendar, monthPace, tomorrowAllocation, weekDays, weeklyInsight } from "@/lib/overview";
import { useBudget } from "@/data/useBudget";
import { InsightCard, MonthCalendar, PaceCard, WeekBars } from "@/components/Overview";
import { Card, EmptyState, Money, PageHeader, Pill, SectionTitle, cx } from "@/components/ui";

/** Split-bar colours for the top categories; the rest share the last one. */
const SPLIT = ["bg-lime", "bg-violet", "bg-sky", "bg-amber", "bg-ink-600"];

export default function BriefingPage() {
  const { data, derived, today } = useBudget();
  // Morning brief until 5 pm, night brief after; a day picked on the calendar shows that day's report.
  const [night, setNight] = useState(() => istHour() >= 17);
  const [day, setDay] = useState<string | null>(null);
  if (!data || !derived) return null;
  const { ledger } = derived;
  const hasBudget = ledger.hasBudget;
  const showingPast = day !== null && day !== today;
  const isNight = night || showingPast;
  const reportDay = day ?? today;
  const cal = monthCalendar(ledger, reportDay);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={showingPast ? "Day report" : isNight ? "Night brief" : "Morning brief"}
        subtitle={formatDay(reportDay, { weekday: true, year: reportDay.slice(0, 4) !== today.slice(0, 4) })}
        right={
          showingPast ? (
            <button className="btn-ghost min-h-[36px] text-xs" onClick={() => setDay(null)}>
              ← Today
            </button>
          ) : (
            <button className="btn-ghost min-h-[36px] text-xs" onClick={() => setNight(!night)} data-testid="brief-switch">
              {night ? "☀️ Morning" : "🌙 Night"}
            </button>
          )
        }
      />

      {!ledger.started ? (
        <EmptyState emoji="⏳" title="Tracking hasn't started yet" body={`Your first brief arrives on ${formatDay(data.profile!.trackingStart, { weekday: true })}.`} />
      ) : (
        <div className="space-y-3">
          {isNight ? <Night day={reportDay} isToday={reportDay === today} /> : <Morning />}
          {!showingPast && <WeekBars days={weekDays(ledger, today)} hasBudget={hasBudget} today={today} />}
          {!showingPast && !isNight && <PaceCard pace={monthPace(ledger, today)} hasBudget={hasBudget} />}
          <MonthCalendar blanks={cal.blanks} days={cal.days} hasBudget={hasBudget} selected={day ?? undefined} onPick={(d) => setDay(d === today ? null : d)} />
          {!showingPast && hasBudget && <Badges />}
        </div>
      )}
    </div>
  );
}

function Morning() {
  const { data, derived, today } = useBudget();
  if (!data || !derived) return null;
  const { ledger, statuses } = derived;
  const b = morningBriefing(ledger, statuses, data.txns, today);
  const yesterday = addDays(today, -1);
  const yTop = eveningReport(ledger, data.txns, data.plans, yesterday).byCategory[0];
  const dueToday = [...b.overdue, ...b.billsSoon].filter((s) => diffDays(today, s.dueDate) <= 1);
  const insight = weeklyInsight(data.txns, data.plans, today);

  return (
    <>
      <Card className="bg-gradient-to-br from-amber/15 to-ink-850 text-center" data-testid="morning">
        {ledger.hasBudget ? (
          <>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber">You can spend today</div>
            <div className={cx("num mt-1 text-5xl font-bold", b.availablePaise < 0 ? "text-coral" : "text-white")}>
              <Money paise={b.availablePaise} decimals="never" />
            </div>
            <div className="mt-2 text-xs text-ink-400">
              <Money paise={b.allocationPaise} decimals="never" /> base · <Money paise={b.carriedPaise} decimals="never" sign /> {b.carriedPaise >= 0 ? "carried over" : "deficit"}
            </div>
          </>
        ) : (
          <>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber">Good morning</div>
            <div className="mt-1 text-lg font-semibold">Here's how yesterday went</div>
          </>
        )}
      </Card>

      {b.yesterday && (
        <Card className="text-sm">
          <div className="flex items-center justify-between gap-2">
            <span>
              <span className="text-ink-400">Yesterday:</span> <Money paise={b.yesterday.spentPaise} decimals="never" className="font-semibold" />
              {yTop && <span className="text-ink-400"> · mostly {yTop.category}</span>}
            </span>
            {ledger.hasBudget && <Pill tone={b.yesterday.underBudget ? "lime" : "coral"}>{b.yesterday.underBudget ? "under ✓" : `${Math.round((b.yesterday.spentPaise / Math.max(1, b.yesterday.allocationPaise) - 1) * 100)}% over`}</Pill>}
          </div>
        </Card>
      )}

      {dueToday.length > 0 && (
        <Card className="space-y-2 text-sm">
          <div className="font-semibold">Due today or tomorrow</div>
          {dueToday.map((s) => (
            <div key={s.commitment.id} className="flex justify-between">
              <span>
                {s.commitment.name} <span className="text-xs text-ink-400">· {s.state === "overdue" ? "overdue" : s.dueDate === today ? "today" : "tomorrow"}</span>
              </span>
              <Money paise={s.commitment.amountPaise - s.paidPaise} decimals="never" className={s.state === "overdue" ? "text-coral" : ""} />
            </div>
          ))}
          <p className="text-[11px] text-ink-400">Already set aside, so they don't come out of today's budget.</p>
        </Card>
      )}

      {insight && <InsightCard insight={insight} />}
    </>
  );
}

function Night({ day, isToday }: { day: string; isToday: boolean }) {
  const { data, derived, today } = useBudget();
  if (!data || !derived) return null;
  const { ledger, statuses } = derived;
  const r = eveningReport(ledger, data.txns, data.plans, day);
  const row = ledger.days.find((d) => d.date === day) ?? ledger.todayRow;
  const startOfDay = row.carriedInPaise + row.allocationPaise;
  const total = r.byCategory.reduce((s, c) => s + c.amountPaise, 0);
  const top = r.byCategory.slice(0, SPLIT.length);
  const tomorrow = addDays(today, 1);
  const tomorrowBase = tomorrowAllocation(data.plans, today);
  const dueTomorrow = statuses.filter((s) => s.state !== "paid" && s.dueDate === tomorrow);

  return (
    <>
      <Card className="bg-gradient-to-br from-violet/20 to-ink-850 text-center" data-testid="evening">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-violet">{isToday ? "Today" : "Spent"}</div>
        <div className="num mt-1 text-5xl font-bold">
          <Money paise={r.spentPaise} decimals="never" />
          {ledger.hasBudget && (
            <span className="ml-1 text-base font-semibold text-ink-400">
              of <Money paise={startOfDay} decimals="never" />
            </span>
          )}
        </div>
        {ledger.hasBudget && (
          <div className="mt-3">
            <Pill tone={r.closingPaise >= 0 ? "lime" : "coral"}>
              {r.closingPaise >= 0 ? `${formatINR(r.closingPaise, { decimals: "never" })} rolls into ${isToday ? "tomorrow" : "the next day"}` : `${formatINR(-r.closingPaise, { decimals: "never" })} deficit carried forward`}
            </Pill>
          </div>
        )}
      </Card>

      {r.noSpend ? (
        <Card className="text-center">
          <div className="text-3xl">🧘</div>
          <div className="mt-1 font-semibold">Zero-spend day</div>
          <div className="text-xs text-ink-400">+5 bonus XP</div>
        </Card>
      ) : (
        <Card data-testid="where-it-went">
          <div className="mb-3 text-sm font-semibold">Where it went</div>
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {top.map((c, i) => (
              <div key={c.category} className={SPLIT[i]} style={{ flex: c.amountPaise }} />
            ))}
          </div>
          <div className="mt-3 space-y-1.5">
            {top.map((c, i) => (
              <div key={c.category} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className={cx("h-2 w-2 rounded-full", SPLIT[i])} />
                  {categoryEmoji(c.category)} {c.category}
                  <span className="text-xs text-ink-400">{Math.round((c.amountPaise / Math.max(1, total)) * 100)}%</span>
                </span>
                <Money paise={c.amountPaise} decimals="never" />
              </div>
            ))}
          </div>
          {r.biggest && (
            <p className="mt-3 text-xs text-ink-400">
              Biggest: {r.biggest.merchant} · <Money paise={r.biggest.amountPaise} decimals="never" />
            </p>
          )}
        </Card>
      )}

      {isToday && ledger.hasBudget && (
        <Card className="text-sm" data-testid="tomorrow">
          <div className="flex items-center justify-between">
            <span className="text-ink-400">Tomorrow you can spend</span>
            <Money paise={r.closingPaise + tomorrowBase} decimals="never" className="text-lg font-bold" />
          </div>
          <div className="mt-1 text-xs text-ink-400">
            {r.underBudget ? `🔥 Streak becomes ${r.streakIfHeld} if today stays under.` : "Streak resets tonight. Tomorrow's a fresh start 🌱"}
          </div>
          {dueTomorrow.map((s) => (
            <div key={s.commitment.id} className="mt-1 text-xs text-ink-400">
              Due: {s.commitment.name} <Money paise={s.commitment.amountPaise - s.paidPaise} decimals="never" /> (set aside)
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

function Badges() {
  const { derived } = useBudget();
  if (!derived) return null;
  return (
    <>
      <SectionTitle>Badges</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        {badges(derived.ledger).map((b) => (
          <div key={b.id} className={cx("rounded-2xl border p-3 text-center", b.earned ? "border-lime/30 bg-lime/[0.06]" : "border-white/5 opacity-40")} title={b.hint}>
            <div className={cx("text-2xl", !b.earned && "grayscale")}>{b.emoji}</div>
            <div className="mt-1 text-[11px] font-semibold leading-tight">{b.name}</div>
          </div>
        ))}
      </div>
    </>
  );
}
