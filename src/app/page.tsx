"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { outgoingsInRange } from "@/lib/budget";
import { addDays, diffDays, formatDay, istHour, startOfMonth, startOfWeek } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { VIBE_COPY, level, recoveryPlan, vibe } from "@/lib/insights";
import { monthPace, usualDailySpend, weeklyInsight } from "@/lib/overview";
import { type Account, DEFAULT_PREFS, type Transaction } from "@/lib/types";
import { useBudget } from "@/data/useBudget";
import { useQuickAdd } from "@/components/AppShell";
import { InsightCard, PaceCard, SyncPill } from "@/components/Overview";
import { TxnEditor } from "@/components/TxnEditor";
import { TxnRow } from "@/components/TxnRow";
import { Card, EmptyState, Money, ProgressBar, SectionTitle, cx } from "@/components/ui";

const LATEST = 4;

export default function TodayPage() {
  const { data, derived, today } = useBudget();
  const { open } = useQuickAdd();
  const [editing, setEditing] = useState<Transaction | null>(null);

  // Newest first: today's and recent transactions, whatever their source.
  const latest = useMemo(
    () =>
      [...(data?.txns ?? [])]
        .filter((t) => t.date <= today)
        .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1))
        .slice(0, LATEST),
    [data, today],
  );
  if (!data || !derived) return null;
  const { ledger, pool, statuses } = derived;
  const row = ledger.todayRow;
  const hour = istHour();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = data.profile?.name?.replace(/\s*\(demo\)$/, "");
  const sms = data.connections.find((c) => c.providerId === "sms");
  const newFromSms = data.txns.filter((t) => t.source.providerId === "sms" && Date.now() - t.source.importedAt < 24 * 3600_000).length;
  const reviewCount = data.txns.filter((t) => t.needsReview).length;
  const dueSoon = statuses.filter((s) => s.state !== "paid" && diffDays(today, s.dueDate) <= 7);
  const commitmentName = (id?: string) => derived.plan?.commitments.find((c) => c.id === id)?.name;
  const rec = ledger.hasBudget ? recoveryPlan(ledger, today) : null;
  const pace = monthPace(ledger, today);
  const insight = ledger.started ? weeklyInsight(data.txns, data.plans, today) : null;
  const showBalances = (data.profile?.prefs?.balances ?? DEFAULT_PREFS.balances) && data.accounts.length > 0;
  const lv = level(ledger);
  // Tracking mode compares with the same stretch of last month.
  const lastMonthStart = startOfMonth(addDays(startOfMonth(today), -1));
  const lastMonthByNow = ledger.hasBudget ? undefined : outgoingsInRange(data.txns, data.plans, lastMonthStart, addDays(lastMonthStart, pace.dayOfMonth - 1)).discretionaryPaise;

  return (
    <div className="md:grid md:grid-cols-[1.1fr_1fr] md:gap-6">
      <div>
        <div className="mb-4 mt-3 flex items-center justify-between gap-2 md:mt-0">
          <p className="truncate text-sm text-ink-400">
            {greeting}
            {name ? `, ${name}` : ""} · {formatDay(today, { weekday: true })}
          </p>
          <SyncPill connection={sms} />
        </div>

        {!ledger.started ? (
          <EmptyState emoji="⏳" title={`Tracking starts ${formatDay(data.profile!.trackingStart, { weekday: true })}`} body="Your daily allowance starts accruing on that date." />
        ) : ledger.hasBudget ? (
          <HeroBudget available={ledger.availablePaise} base={row.allocationPaise} carried={row.carriedInPaise} spent={row.spentPaise} line={VIBE_COPY[vibe(ledger)].line} />
        ) : (
          <HeroTracking spent={row.spentPaise} usual={usualDailySpend(ledger, today)} week={outgoingsInRange(data.txns, data.plans, startOfWeek(today), today).discretionaryPaise} />
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
            <b className="text-coral">
              Deficit <Money paise={rec.deficitPaise} />.
            </b>{" "}
            {rec.daysLeft > 0 ? (
              <>
                Spend about <Money paise={rec.perDayCutPaise} /> less than your base for the next {rec.daysLeft} days to clear it this month.
              </>
            ) : (
              "It carries into next month's allowance."
            )}
          </Card>
        )}

        {ledger.started && (
          <div className="mt-3">
            <PaceCard pace={pace} hasBudget={ledger.hasBudget} lastMonthByNowPaise={lastMonthByNow} />
          </div>
        )}
        {insight && (
          <div className="mt-3">
            <InsightCard insight={insight} />
          </div>
        )}
      </div>

      <div>
        <SectionTitle
          action={
            reviewCount > 0 ? (
              <Link href="/transactions?review=1" className="text-xs font-semibold text-amber">
                Review {reviewCount} →
              </Link>
            ) : (
              <Link href="/transactions" className="text-xs font-semibold text-lime">
                All →
              </Link>
            )
          }
        >
          {newFromSms > 0 ? `${newFromSms} new from SMS` : "Latest"}
        </SectionTitle>
        {latest.length === 0 ? (
          <EmptyState emoji="📭" title="Nothing yet" body="Bank SMS show up here as they arrive." />
        ) : (
          <Card className="p-2" data-testid="today-list">
            {latest.map((t) => (
              <TxnRow key={t.id} t={t} onClick={() => setEditing(t)} commitmentName={commitmentName(t.commitmentId)} />
            ))}
          </Card>
        )}

        {(dueSoon.length > 0 || showBalances) && (
          <>
            <SectionTitle>{dueSoon.length > 0 ? "Coming up" : "Balances"}</SectionTitle>
            <Card className="divide-y divide-white/5 py-1" data-testid="coming-up">
              {dueSoon.map((s) => (
                <div key={s.commitment.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate">
                    {s.commitment.kind === "savings" ? "🏦" : "🧾"} {s.commitment.name}
                    <span className={cx("ml-2 text-xs", s.state === "overdue" ? "text-coral" : "text-ink-400")}>{s.state === "overdue" ? "overdue" : s.dueDate === today ? "today" : formatDay(s.dueDate, { weekday: true })}</span>
                  </span>
                  <Money paise={s.commitment.amountPaise - s.paidPaise} className="num text-ink-300" />
                </div>
              ))}
              {showBalances && <BalanceRows accounts={data.accounts} />}
            </Card>
          </>
        )}

        <div className="mt-4 flex items-center justify-between gap-3 px-1 text-sm text-ink-400">
          <span data-testid="streak-row">
            {ledger.hasBudget && ledger.started ? (
              <>
                {ledger.streak > 0 ? (
                  <>
                    🔥 <span data-testid="streak">{ledger.streak}</span>-day streak ·{" "}
                  </>
                ) : null}
                Lvl {lv.level} · {lv.xp} XP
              </>
            ) : (
              "Tracking only"
            )}
          </span>
          <button className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-ink-300 hover:text-white" onClick={() => open()} data-testid="today-add">
            + Cash spend
          </button>
        </div>
      </div>

      <TxnEditor txn={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function HeroBudget({ available, base, carried, spent, line }: { available: number; base: number; carried: number; spent: number; line: string }) {
  const over = available < 0;
  const startOfDay = Math.max(1, base + carried);
  return (
    <div className={cx("relative overflow-hidden rounded-[32px] border p-6 text-center", over ? "border-coral/30 bg-gradient-to-br from-coral/15 to-ink-850" : "border-lime/20 bg-gradient-to-br from-lime/[0.12] via-ink-850 to-ink-850")}>
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-300">{over ? "Over today's budget by" : "Left to spend today"}</div>
      <div className={cx("num mt-1 whitespace-nowrap font-bold leading-none", heroSize(available), over ? "text-coral" : "text-lime")} data-testid="available" aria-label={formatINR(available)}>
        {formatINR(Math.abs(available), { decimals: "never" })}
        {Math.abs(available) % 100 !== 0 && <span className="text-[0.45em] opacity-70">.{String(Math.abs(available) % 100).padStart(2, "0")}</span>}
      </div>
      <p className="num mt-3 text-xs text-ink-400" data-testid="today-breakdown">
        <Money paise={base} decimals="never" /> base · <Money paise={carried} decimals="never" sign /> carried · <span data-testid="spent-today"><Money paise={spent} decimals="never" /></span> spent
      </p>
      <div className="mx-auto mt-3 max-w-xs">
        <ProgressBar value={Math.min(1, spent / startOfDay)} tone={over ? "coral" : spent / startOfDay > 0.75 ? "amber" : "lime"} />
      </div>
      <p className="mt-3 text-sm text-ink-300">{line}</p>
    </div>
  );
}

function heroSize(p: number) {
  const len = formatINR(Math.abs(p), { decimals: "never" }).length;
  return len <= 6 ? "text-[52px] sm:text-6xl" : len <= 8 ? "text-[42px] sm:text-6xl" : "text-[32px] sm:text-5xl";
}

function HeroTracking({ spent, usual, week }: { spent: number; usual: number; week: number }) {
  return (
    <div className="rounded-[32px] border border-white/10 bg-gradient-to-br from-violet/15 to-ink-850 p-6 text-center">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-300">Spent today</div>
      <div className="num mt-1 text-5xl font-bold" data-testid="spent-today">
        <Money paise={spent} decimals="never" />
      </div>
      <p className="mt-3 text-xs text-ink-400">
        {usual > 0 ? (
          <>
            Your usual: <Money paise={usual} decimals="never" /> a day ·{" "}
          </>
        ) : null}
        This week: <Money paise={week} decimals="never" />
      </p>
      <p className="mt-3 text-xs text-ink-400">
        Tracking only.{" "}
        <Link href="/settings" className="text-lime">
          Set a budget
        </Link>{" "}
        to get a daily allowance.
      </p>
    </div>
  );
}

function BalanceRows({ accounts }: { accounts: Account[] }) {
  const sorted = [...accounts].sort((a, b) => (a.kind === b.kind ? b.asOf - a.asOf : a.kind === "account" ? -1 : 1));
  const asOf = (ms: number) => new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
  return (
    <>
      {sorted.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm" data-testid="balance">
          <span className="min-w-0 truncate">
            {a.kind === "card" ? "💳" : "🏦"} {a.bank} ••{a.last4}
            <span className="ml-2 text-xs text-ink-400">
              {a.kind === "card" ? "limit" : "balance"} · {asOf(a.asOf)}
            </span>
          </span>
          <Money paise={a.balancePaise} decimals="never" className="num font-semibold" />
        </div>
      ))}
    </>
  );
}
