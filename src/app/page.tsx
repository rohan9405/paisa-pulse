"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { outgoingsInRange } from "@/lib/budget";
import { diffDays, formatDay, istHour, startOfMonth, startOfWeek } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { VIBE_COPY, badges, level, recoveryPlan, vibe } from "@/lib/insights";
import type { Transaction } from "@/lib/types";
import { useBudget } from "@/data/useBudget";
import { useQuickAdd } from "@/components/AppShell";
import { TxnEditor } from "@/components/TxnEditor";
import { TxnRow } from "@/components/TxnRow";
import { Card, EmptyState, Money, Pill, ProgressBar, SectionTitle, cx } from "@/components/ui";

export default function TodayPage() {
  const { data, derived, today } = useBudget();
  const { open } = useQuickAdd();
  const [editing, setEditing] = useState<Transaction | null>(null);

  const todays = useMemo(() => (data?.txns ?? []).filter((t) => t.date === today).sort((a, b) => b.createdAt - a.createdAt), [data, today]);
  if (!data || !derived) return null;
  const { ledger, pool, statuses } = derived;
  const v = vibe(ledger);
  const copy = VIBE_COPY[v];
  const row = ledger.todayRow;
  const startOfDay = row.carriedInPaise + row.allocationPaise;
  const ratio = startOfDay > 0 ? Math.max(0, ledger.availablePaise) / startOfDay : 0;
  const rec = recoveryPlan(ledger, today);
  const lv = level(ledger);
  const hour = istHour();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = data.profile?.name?.replace(/\s*\(demo\)$/, "");
  const reviewCount = data.txns.filter((t) => t.needsReview).length;
  const dueSoon = statuses.filter((s) => s.state !== "paid" && diffDays(today, s.dueDate) <= 7);
  const commitmentName = (id?: string) => derived.plan?.commitments.find((c) => c.id === id)?.name;

  return (
    <div className="md:grid md:grid-cols-[1.1fr_1fr] md:gap-6">
      <div>
        <div className="mb-4 mt-3 md:mt-0">
          <p className="text-sm text-ink-400">
            {greeting}
            {name ? `, ${name}` : ""} · {formatDay(today, { weekday: true })}
          </p>
        </div>

        {!ledger.started ? (
          <EmptyState emoji="⏳" title={`Tracking starts ${formatDay(data.profile!.trackingStart, { weekday: true })}`} body="Your daily allowance starts accruing on that date." />
        ) : ledger.hasBudget ? (
          <HeroBudget available={ledger.availablePaise} ratio={ratio} vibe={copy} over={v === "over"} />
        ) : (
          <HeroTracking spentToday={row.spentPaise} week={outgoingsInRange(data.txns, data.plans, startOfWeek(today), today).discretionaryPaise} month={outgoingsInRange(data.txns, data.plans, startOfMonth(today), today).discretionaryPaise} />
        )}

        {ledger.started && ledger.hasBudget && (
          <div className="mt-3 grid grid-cols-3 gap-2" data-testid="today-breakdown">
            <Stat label="Today's base" paise={row.allocationPaise} />
            <Stat label="Carried in" paise={row.carriedInPaise} tone={row.carriedInPaise < 0 ? "coral" : "default"} signed />
            <Stat label="Spent today" paise={row.spentPaise} tone={row.spentPaise > startOfDay ? "coral" : "default"} testId="spent-today" />
          </div>
        )}

        {pool.shortfallPaise > 0 && (
          <Card className="mt-3 border-coral/30 bg-coral/[0.07] text-sm">
            <b className="text-coral">Bills & savings exceed income</b> by <Money paise={pool.shortfallPaise} />. Daily allowance is ₹0 until you{" "}
            <Link href="/settings" className="underline">
              adjust your budget
            </Link>
            .
          </Card>
        )}
        {rec && (
          <Card className="mt-3 border-coral/30 bg-coral/[0.07] text-sm">
            <b className="text-coral">Deficit {formatPaise(rec.deficitPaise)}.</b>{" "}
            {rec.daysLeft > 0 ? (
              <>
                Spend about <Money paise={rec.perDayCutPaise} /> less than your base for the next {rec.daysLeft} days to clear it this month.
              </>
            ) : (
              "It carries into next month's allowance."
            )}
          </Card>
        )}

        <button className="btn-primary mt-4 h-14 w-full text-base md:hidden" onClick={() => open()} data-testid="today-add">
          + Add expense
        </button>

        {ledger.hasBudget && ledger.started && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Card className="flex items-center gap-3 py-3">
              <span className="text-3xl">🔥</span>
              <div>
                <div className="num text-xl font-bold" data-testid="streak">{ledger.streak}</div>
                <div className="text-xs text-ink-400">day streak</div>
              </div>
            </Card>
            <Card className="py-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-bold">Lvl {lv.level}</span>
                <span className="num text-xs text-ink-400">{lv.xp} XP</span>
              </div>
              <div className="mt-2">
                <ProgressBar value={lv.progress} tone="violet" />
              </div>
              <div className="mt-1 text-[11px] text-ink-400">+10 XP per under-budget day</div>
            </Card>
          </div>
        )}
      </div>

      <div>
        {(reviewCount > 0 || dueSoon.length > 0) && <SectionTitle>Heads up</SectionTitle>}
        {reviewCount > 0 && (
          <Link href="/transactions?review=1" className="card mb-2 flex items-center justify-between bg-amber/[0.07] text-sm">
            <span>
              ⚠️&nbsp; <b>{reviewCount}</b> transaction{reviewCount > 1 ? "s need" : " needs"} review
            </span>
            <span className="text-amber">Review →</span>
          </Link>
        )}
        {dueSoon.length > 0 && (
          <Card className="space-y-2">
            {dueSoon.map((s) => (
              <div key={s.commitment.id} className="flex items-center justify-between text-sm">
                <span>
                  {s.commitment.kind === "savings" ? "🏦" : "🧾"} {s.commitment.name}
                  <span className="ml-2 text-xs text-ink-400">{s.state === "overdue" ? "overdue" : s.dueDate === today ? "due today" : `due ${formatDay(s.dueDate)}`}</span>
                </span>
                <span className="flex items-center gap-2">
                  {s.state === "overdue" && <Pill tone="coral">late</Pill>}
                  <Money paise={s.commitment.amountPaise - s.paidPaise} className="text-ink-300" />
                </span>
              </div>
            ))}
            <p className="text-[11px] text-ink-400">Already reserved — paying these won't reduce today's budget.</p>
          </Card>
        )}

        <SectionTitle action={<Link href="/transactions" className="text-xs font-semibold text-lime">All →</Link>}>Today</SectionTitle>
        {todays.length === 0 ? (
          <EmptyState emoji="🧘" title="Nothing spent yet today" body="Zero-spend days earn bonus XP." action={<button className="btn-ghost" onClick={() => open()}>Log an expense</button>} />
        ) : (
          <Card className="p-2" data-testid="today-list">
            {todays.map((t) => (
              <TxnRow key={t.id} t={t} onClick={() => setEditing(t)} commitmentName={commitmentName(t.commitmentId)} />
            ))}
          </Card>
        )}

        {ledger.hasBudget && ledger.started && (
          <>
            <SectionTitle>Badges</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              {badges(ledger).map((b) => (
                <div key={b.id} className={cx("rounded-2xl border p-3 text-center", b.earned ? "border-lime/30 bg-lime/[0.06]" : "border-white/5 opacity-40")} title={b.hint}>
                  <div className={cx("text-2xl", !b.earned && "grayscale")}>{b.emoji}</div>
                  <div className="mt-1 text-[11px] font-semibold leading-tight">{b.name}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <TxnEditor txn={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function formatPaise(p: number) {
  return <Money paise={p} />;
}

function HeroBudget({ available, ratio, vibe, over }: { available: number; ratio: number; vibe: { label: string; emoji: string; line: string }; over: boolean }) {
  const R = 88;
  const C = 2 * Math.PI * R;
  return (
    <div className={cx("relative overflow-hidden rounded-[32px] border p-6", over ? "border-coral/30 bg-gradient-to-br from-coral/15 to-ink-850" : "border-lime/20 bg-gradient-to-br from-lime/[0.12] via-ink-850 to-ink-850")}>
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 200 200" className="h-24 w-24 shrink-0 -rotate-90 sm:h-36 sm:w-36" aria-hidden>
          <circle cx="100" cy="100" r={R} stroke="rgba(255,255,255,0.07)" strokeWidth="16" fill="none" />
          <circle cx="100" cy="100" r={R} stroke={over ? "#ff6b6b" : "#c6ff3d"} strokeWidth="16" fill="none" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, ratio))} className="transition-all duration-700" />
        </svg>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-300">{over ? "Deficit" : "Left to spend today"}</div>
          <div className={cx("num mt-1 whitespace-nowrap font-bold leading-none", heroSize(available), over ? "text-coral" : "text-lime")} data-testid="available" aria-label={formatINR(available)}>
            {formatINR(available, { decimals: "never" })}
            {Math.abs(available) % 100 !== 0 && <span className="text-[0.45em] opacity-70">.{String(Math.abs(available) % 100).padStart(2, "0")}</span>}
          </div>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-1 text-xs font-semibold">
            {vibe.emoji} {vibe.label}
          </div>
        </div>
      </div>
      <p className="mt-4 text-sm text-ink-300">{vibe.line}</p>
    </div>
  );
}

function heroSize(p: number) {
  const len = formatINR(p, { decimals: "never" }).length;
  return len <= 6 ? "text-[44px] sm:text-5xl" : len <= 8 ? "text-[34px] sm:text-5xl" : "text-[26px] sm:text-4xl";
}

function HeroTracking({ spentToday, week, month }: { spentToday: number; week: number; month: number }) {
  return (
    <div className="rounded-[32px] border border-white/10 bg-gradient-to-br from-violet/15 to-ink-850 p-6">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-300">Spent today</div>
      <div className="num mt-1 text-5xl font-bold" data-testid="spent-today">
        <Money paise={spentToday} />
      </div>
      <div className="mt-4 flex gap-6 text-sm">
        <div>
          <div className="text-ink-400">This week</div>
          <Money paise={week} className="font-semibold" />
        </div>
        <div>
          <div className="text-ink-400">This month</div>
          <Money paise={month} className="font-semibold" />
        </div>
      </div>
      <p className="mt-4 text-xs text-ink-400">
        Tracking only — no budget set. <Link href="/settings" className="text-lime">Add income in Settings</Link> to get a daily allowance.
      </p>
    </div>
  );
}

function Stat({ label, paise, tone = "default", signed, testId }: { label: string; paise: number; tone?: "default" | "coral"; signed?: boolean; testId?: string }) {
  return (
    <div className="rounded-2xl bg-ink-850 p-3">
      <div className="text-[11px] text-ink-400">{label}</div>
      <div className={cx("num mt-0.5 truncate text-[15px] font-semibold", tone === "coral" && "text-coral")} data-testid={testId}>
        <Money paise={paise} sign={signed} decimals="never" />
      </div>
    </div>
  );
}
