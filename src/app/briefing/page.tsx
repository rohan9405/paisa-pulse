"use client";

import { useMemo, useState } from "react";
import { formatDay, istHour, relativeDayLabel } from "@/lib/dates";
import { categoryEmoji } from "@/lib/categorize";
import { eveningReport, morningBriefing } from "@/lib/insights";
import { useBudget } from "@/data/useBudget";
import { Card, EmptyState, Money, PageHeader, Pill, ProgressBar, SectionTitle, Segmented, cx } from "@/components/ui";

type Tab = "morning" | "evening" | "history";

export default function BriefingPage() {
  const { data, derived, today } = useBudget();
  const [tab, setTab] = useState<Tab>(() => (istHour() >= 17 ? "evening" : "morning"));
  const [reportDay, setReportDay] = useState<string | null>(null);

  const history = useMemo(() => (derived ? [...derived.ledger.days].reverse() : []), [derived]);
  if (!data || !derived) return null;
  const { ledger, statuses } = derived;
  const day = reportDay ?? today;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Briefing" subtitle="Your daily money check-ins" />
      <Segmented
        className="mb-4 w-full"
        value={tab}
        onChange={(t) => (setTab(t), setReportDay(null))}
        options={[
          { value: "morning", label: "☀️ Morning" },
          { value: "evening", label: "🌙 Evening" },
          { value: "history", label: "📅 History" },
        ]}
      />
      <p className="mb-4 rounded-2xl bg-white/[0.03] px-4 py-3 text-xs text-ink-400">
        🔔 Scheduled push notifications aren't implemented yet — open this tab in the morning and evening. (They'd need a service worker + push permission; see the README.)
      </p>

      {!ledger.started ? (
        <EmptyState emoji="⏳" title="Tracking hasn't started yet" body={`Your first briefing arrives on ${formatDay(data.profile!.trackingStart, { weekday: true })}.`} />
      ) : tab === "morning" ? (
        <Morning b={morningBriefing(ledger, statuses, data.txns, today)} hasBudget={ledger.hasBudget} />
      ) : tab === "evening" ? (
        <Evening r={eveningReport(ledger, data.txns, data.plans, day)} hasBudget={ledger.hasBudget} isToday={day === today} onBack={reportDay ? () => setReportDay(null) : undefined} />
      ) : (
        <History rows={history} today={today} hasBudget={ledger.hasBudget} onOpen={(d) => (setReportDay(d), setTab("evening"))} />
      )}
    </div>
  );
}

function Morning({ b, hasBudget }: { b: ReturnType<typeof morningBriefing>; hasBudget: boolean }) {
  const pace = b.monthPace.allocatedPaise > 0 ? b.monthPace.spentPaise / b.monthPace.allocatedPaise : 0;
  return (
    <div className="space-y-3" data-testid="morning">
      <Card className="bg-gradient-to-br from-amber/15 to-ink-850">
        <div className="text-xs font-semibold uppercase tracking-widest text-amber">GM ☀️ {formatDay(b.date, { weekday: true })}</div>
        {hasBudget ? (
          <>
            <div className="mt-2 text-sm text-ink-300">You can spend today</div>
            <div className={cx("num text-4xl font-bold", b.availablePaise < 0 ? "text-coral" : "text-white")}>
              <Money paise={b.availablePaise} />
            </div>
            <div className="mt-2 text-sm text-ink-400">
              <Money paise={b.allocationPaise} /> base {b.carriedPaise >= 0 ? "+" : "−"} <Money paise={Math.abs(b.carriedPaise)} /> {b.carriedPaise >= 0 ? "carried over" : "deficit"}
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-ink-300">Tracking mode — here's how yesterday went.</p>
        )}
      </Card>

      {b.yesterday && (
        <Card>
          <div className="text-sm text-ink-400">Yesterday</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-lg font-semibold">
              Spent <Money paise={b.yesterday.spentPaise} />
            </span>
            {hasBudget && <Pill tone={b.yesterday.underBudget ? "lime" : "coral"}>{b.yesterday.underBudget ? "under budget ✓" : "over budget"}</Pill>}
          </div>
          {hasBudget && (
            <div className="mt-1 text-xs text-ink-400">
              vs <Money paise={b.yesterday.allocationPaise} /> base allowance
            </div>
          )}
        </Card>
      )}

      {hasBudget && (
        <Card>
          <div className="flex justify-between text-sm">
            <span className="text-ink-400">Month so far (day {b.monthPace.dayOfMonth}/{b.monthPace.daysInMonth})</span>
            <span className="num">
              <Money paise={b.monthPace.spentPaise} /> / <Money paise={b.monthPace.allocatedPaise} />
            </span>
          </div>
          <div className="mt-2">
            <ProgressBar value={pace} tone={pace > 1 ? "coral" : pace > 0.9 ? "amber" : "lime"} />
          </div>
          <div className="mt-1 text-xs text-ink-400">Spent vs allowance accrued through yesterday</div>
        </Card>
      )}

      {b.recovery && (
        <Card className="border-coral/30 bg-coral/[0.07] text-sm">
          🎯 Recovery: spend ~<Money paise={b.recovery.perDayCutPaise} /> under your base for {b.recovery.daysLeft} days to clear a <Money paise={b.recovery.deficitPaise} /> deficit.
        </Card>
      )}

      {(b.billsSoon.length > 0 || b.overdue.length > 0) && (
        <Card className="space-y-2">
          <div className="text-sm font-semibold">Bills & savings this week</div>
          {[...b.overdue, ...b.billsSoon].map((s) => (
            <div key={s.commitment.id} className="flex justify-between text-sm">
              <span>
                {s.commitment.name} <span className="text-xs text-ink-400">· {s.state === "overdue" ? "overdue" : formatDay(s.dueDate, { weekday: true })}</span>
              </span>
              <Money paise={s.commitment.amountPaise - s.paidPaise} className={s.state === "overdue" ? "text-coral" : ""} />
            </div>
          ))}
          <p className="text-[11px] text-ink-400">Already reserved from income — not from today's budget.</p>
        </Card>
      )}

      {b.reviewCount > 0 && <Card className="bg-amber/[0.07] text-sm">⚠️ {b.reviewCount} transaction(s) waiting for review in Activity.</Card>}
      {hasBudget && b.streak > 0 && <Card className="text-sm">🔥 {b.streak}-day streak. Stay under today's budget to make it {b.streak + 1}.</Card>}
    </div>
  );
}

function Evening({ r, hasBudget, isToday, onBack }: { r: ReturnType<typeof eveningReport>; hasBudget: boolean; isToday: boolean; onBack?: () => void }) {
  const max = Math.max(1, ...r.byCategory.map((c) => c.amountPaise));
  return (
    <div className="space-y-3" data-testid="evening">
      {onBack && (
        <button className="text-sm text-lime" onClick={onBack}>
          ← Back to today
        </button>
      )}
      <Card className="bg-gradient-to-br from-violet/20 to-ink-850">
        <div className="text-xs font-semibold uppercase tracking-widest text-violet">{isToday ? "Tonight's report 🌙" : `Report · ${formatDay(r.date, { weekday: true })}`}</div>
        <div className="mt-2 text-sm text-ink-300">{isToday ? "Spent today" : "Spent"}</div>
        <div className="num text-4xl font-bold">
          <Money paise={r.spentPaise} />
        </div>
        {hasBudget && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Pill tone={r.underBudget ? "lime" : "coral"}>{r.underBudget ? "Under budget" : "Over budget"}</Pill>
            <span className="text-ink-400">
              base <Money paise={r.allocationPaise} />
            </span>
          </div>
        )}
      </Card>

      {hasBudget && (
        <Card>
          <div className="text-sm text-ink-400">{isToday ? "Carrying into tomorrow" : "Closing balance"}</div>
          <div className={cx("num text-2xl font-bold", r.closingPaise < 0 ? "text-coral" : "text-lime")}>
            <Money paise={r.closingPaise} sign />
          </div>
          <div className="mt-1 text-xs text-ink-400">{r.closingPaise >= 0 ? "Unspent money rolls over." : "Deficit — future allowances will cover it."}</div>
        </Card>
      )}

      {r.noSpend ? (
        <Card className="text-center">
          <div className="text-3xl">🧘</div>
          <div className="mt-1 font-semibold">Zero-spend day!</div>
          <div className="text-xs text-ink-400">+5 bonus XP</div>
        </Card>
      ) : (
        <Card>
          <div className="mb-3 text-sm font-semibold">Where it went</div>
          <div className="space-y-2.5">
            {r.byCategory.map((c) => (
              <div key={c.category}>
                <div className="flex justify-between text-sm">
                  <span>
                    {categoryEmoji(c.category)} {c.category} <span className="text-xs text-ink-400">×{c.count}</span>
                  </span>
                  <Money paise={c.amountPaise} />
                </div>
                <div className="mt-1">
                  <ProgressBar value={c.amountPaise / max} tone="violet" />
                </div>
              </div>
            ))}
          </div>
          {r.biggest && (
            <p className="mt-3 text-xs text-ink-400">
              Biggest: {r.biggest.merchant} · <Money paise={r.biggest.amountPaise} />
            </p>
          )}
        </Card>
      )}
      {hasBudget && isToday && <Card className="text-sm">{r.underBudget ? `🔥 Streak becomes ${r.streakIfHeld} if you stay here.` : "Streak resets tonight. Tomorrow's a fresh start 🌱"}</Card>}
    </div>
  );
}

function History({ rows, today, hasBudget, onOpen }: { rows: { date: string; allocationPaise: number; spentPaise: number; closingPaise: number; underBudget: boolean }[]; today: string; hasBudget: boolean; onOpen: (d: string) => void }) {
  if (!rows.length) return <EmptyState emoji="📅" title="No history yet" />;
  return (
    <Card className="p-2" data-testid="history">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-2 pb-2 text-[11px] uppercase tracking-wider text-ink-400">
        <span>Day</span>
        <span className="text-right">Spent{hasBudget && " / base"}</span>
        {hasBudget ? <span className="w-24 text-right">Balance</span> : <span />}
      </div>
      {rows.map((r) => (
        <button key={r.date} onClick={() => onOpen(r.date)} className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-x-4 rounded-xl px-2 py-2.5 text-left text-sm hover:bg-white/[0.03]">
          <span className="flex items-center gap-2">
            {hasBudget && <span className={cx("h-2 w-2 rounded-full", r.spentPaise === 0 ? "bg-sky" : r.underBudget ? "bg-lime" : "bg-coral")} />}
            {relativeDayLabel(r.date, today)}
          </span>
          <span className="num text-right">
            <Money paise={r.spentPaise} />
            {hasBudget && (
              <span className="text-ink-400">
                {" "}
                / <Money paise={r.allocationPaise} />
              </span>
            )}
          </span>
          {hasBudget ? <Money paise={r.closingPaise} className={cx("w-24 text-right", r.closingPaise < 0 ? "text-coral" : "text-ink-300")} /> : <span />}
        </button>
      ))}
      <p className="px-2 pt-2 text-[11px] text-ink-400">
        Tracking began {formatDay(rows[rows.length - 1].date, { year: true })}. Earlier days aren't credited.
      </p>
    </Card>
  );
}
