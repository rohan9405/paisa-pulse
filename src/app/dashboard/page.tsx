"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { categoryBreakdown, commitmentCategory, commitmentStatuses, manualPaidKey, outgoingsInRange, planForDate, spendVsBudgetSeries } from "@/lib/budget";
import { categoryEmoji, tagEmoji } from "@/lib/categorize";
import { type DateKey, addDays, addMonths, endOfMonth, formatDay, formatMonth, monthKey, startOfWeek } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { markCommitmentPaid } from "@/data/repo";
import { useBudget } from "@/data/useBudget";
import { Card, EmptyState, InfoTip, Money, PageHeader, Pill, SectionTitle, Segmented, cx } from "@/components/ui";

type Period = "week" | "month";

const AXIS = { stroke: "#3a3a48", tick: { fill: "#8b8b9e", fontSize: 11 }, tickLine: false, axisLine: false } as const;

export default function DashboardPage() {
  const { data, derived, today, db } = useBudget();
  const [period, setPeriod] = useState<Period>("month");
  const [offset, setOffset] = useState(0);

  const [from, to] = useMemo((): [DateKey, DateKey] => {
    if (period === "week") {
      const s = addDays(startOfWeek(today), offset * 7);
      return [s, addDays(s, 6)];
    }
    const m = addMonths(monthKey(today), offset) + "-01";
    return [m, endOfMonth(m)];
  }, [period, offset, today]);
  const toClamped = to > today ? today : to;

  const view = useMemo(() => {
    if (!data || !derived) return null;
    const out = outgoingsInRange(data.txns, from, toClamped);
    const cats = categoryBreakdown(data.txns, data.plans, from, toClamped);
    const series = spendVsBudgetSeries(derived.ledger, from, toClamped).map((d) => ({
      label: formatDay(d.date),
      Spent: d.cumSpentPaise / 100,
      Budget: d.cumBudgetPaise / 100,
      daySpent: d.spentPaise / 100,
      dayBudget: d.budgetPaise / 100,
    }));
    const periodHasBudget = derived.ledger.hasBudget && derived.ledger.days.filter((d) => d.date >= from && d.date <= toClamped).every((d) => d.hasBudget);
    const budgetTotal = series.at(-1)?.Budget ?? 0;
    const budgetSpent = Math.round((series.at(-1)?.Spent ?? 0) * 100);
    const catTotal = cats.reduce((s, c) => s + c.amountPaise, 0);
    return { out, cats, series, periodHasBudget, budgetTotal, budgetSpent, catTotal };
  }, [data, derived, from, toClamped]);

  if (!data || !derived || !view) return null;
  const { out, cats, series, budgetTotal, budgetSpent, catTotal } = view;
  const hasBudget = view.periodHasBudget;
  const catMax = Math.max(1, ...cats.map((c) => c.amountPaise));
  const future = from > today;
  const mk = monthKey(today);
  const statuses = commitmentStatuses(planForDate(data.plans, today), data.profile!, data.txns, mk, today);

  return (
    <div>
      <PageHeader title="Stats" subtitle="Where your money is going" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented value={period} onChange={(p) => (setPeriod(p), setOffset(0))} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
        <div className="ml-auto flex items-center gap-1">
          <button className="btn-ghost h-10 min-h-0 w-10 px-0" onClick={() => setOffset((o) => o - 1)} aria-label="Previous period">
            ‹
          </button>
          <span className="min-w-[130px] text-center text-sm font-semibold" data-testid="period-label">
            {period === "month" ? formatMonth(monthKey(from)) : `${formatDay(from)} – ${formatDay(to)}`}
          </span>
          <button className="btn-ghost h-10 min-h-0 w-10 px-0" onClick={() => setOffset((o) => o + 1)} disabled={offset >= 0} aria-label="Next period">
            ›
          </button>
        </div>
      </div>

      {future ? (
        <EmptyState emoji="🔮" title="That's in the future" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <div className="-mt-1 mb-1 flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-widest text-ink-400">Total outgoings</div>
              <InfoTip label="About total outgoings">
                <b className="text-white">Everyday:</b> food, shopping, travel and everything else.
                <br />
                <b className="text-white">Bills:</b> rent, utilities, EMIs.
                <br />
                <b className="text-white">Investments and savings</b> are money you keep, not expenses.
                <br />
                Transfers between your own accounts aren't counted.
              </InfoTip>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="num text-4xl font-bold" data-testid="total-outgoings">
                  <Money paise={out.totalPaise} />
                </div>
              </div>
              {hasBudget && budgetTotal > 0 && (
                <div className="sm:text-right">
                  <div className="text-xs text-ink-400">Budget spent vs allowance</div>
                  <div className="num text-lg font-semibold">
                    <span className={budgetSpent > budgetTotal * 100 ? "text-coral" : "text-lime"}>{formatINR(budgetSpent, { decimals: "never" })}</span>
                    <span className="text-ink-400"> / {formatINR(Math.round(budgetTotal * 100), { decimals: "never" })}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Split label="Everyday" paise={out.everydayPaise} dot="bg-lime" testId="out-discretionary" />
              <Split label="Bills" paise={out.billsPaise} dot="bg-sky" testId="out-bills" />
              <Split label="Investments" paise={out.investmentsPaise} dot="bg-violet" testId="out-investments" />
              <Split label="Savings" paise={out.savingsPaise} dot="bg-amber" />
            </div>
            <p className="mt-3 text-xs text-ink-400">
              Excluded: <Money paise={out.transfersExcludedPaise} /> own-account transfers. Money in: <Money paise={out.incomePaise} />.
            </p>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold">{hasBudget ? "Spend vs budget (cumulative)" : "Cumulative everyday spending"}</h2>
              <InfoTip label="About spend vs budget">{hasBudget ? "Below the dashed line = on track." : "Set an income in Settings to compare against a budget."}</InfoTip>
            </div>
            {series.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-400">No tracked days in this period.</p>
            ) : (
              <div className="h-56" data-testid="chart-spend-vs-budget">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid stroke="#ffffff10" vertical={false} />
                    <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis {...AXIS} tickFormatter={(v) => formatINR(v * 100, { compact: true })} width={52} />
                    <Tooltip content={<ChartTip />} cursor={{ stroke: "#ffffff30" }} />
                    <Legend wrapperStyle={{ fontSize: 12, color: "#b4b4c4" }} iconType="plainline" />
                    {hasBudget && <Line type="monotone" dataKey="Budget" stroke="#8b8b9e" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />}
                    <Line type="monotone" dataKey="Spent" stroke="#c6ff3d" strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "#13131a", strokeWidth: 2 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold">Daily spending</h2>
              <InfoTip label="About daily spending">Each bar shows recorded spending; budget periods include payments that count against the budget.</InfoTip>
            </div>
            {series.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-400">No tracked days in this period.</p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series} margin={{ top: 6, right: 8, left: -8, bottom: 0 }} barCategoryGap={2}>
                    <CartesianGrid stroke="#ffffff10" vertical={false} />
                    <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis {...AXIS} tickFormatter={(v) => formatINR(v * 100, { compact: true })} width={52} />
                    <Tooltip content={<DayTip hasBudget={hasBudget} />} cursor={{ fill: "#ffffff08" }} />
                    <Bar dataKey="daySpent" name="Spent" fill="#c6ff3d" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold">Expenses by category</h2>
              <InfoTip label="About expenses by category">Investments and savings aren't expenses, so they're not here.</InfoTip>
            </div>
            {cats.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-400">No expenses in this period.</p>
            ) : (
              <div className="space-y-3" data-testid="category-breakdown">
                {cats.map((c) => (
                  <div key={c.category} title={`${c.category}: ${formatINR(c.amountPaise)} across ${c.count} transactions`}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span>
                        {categoryEmoji(c.category)} {c.category}
                        <span className="ml-1.5 text-xs text-ink-400">×{c.count}</span>
                      </span>
                      <span className="num">
                        {formatINR(c.amountPaise)}
                        <span className="ml-2 inline-block w-9 text-right text-xs text-ink-400">{Math.round((c.amountPaise / Math.max(1, catTotal)) * 100)}%</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.05]">
                      <div className="h-full rounded-full bg-lime" style={{ width: `${(c.amountPaise / catMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold">Planned payments · {formatMonth(mk)}</h2>
              <InfoTip label="About planned payments">Bills, investments and savings you planned for. Tap ✓ to mark one paid without a matching transaction.</InfoTip>
            </div>
            {statuses.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-400">No planned payments. Add them in Settings → Budget.</p>
            ) : (
              <div className="space-y-1" data-testid="upcoming-bills">
                {statuses.map((s) => {
                  const key = manualPaidKey(s.commitment.id, mk);
                  const tone = s.state === "paid" ? "lime" : s.state === "overdue" ? "coral" : s.state === "partial" ? "amber" : "default";
                  const label = { paid: "paid", partial: "part paid", overdue: "overdue", due_today: "due today", upcoming: `due ${formatDay(s.dueDate)}` }[s.state];
                  return (
                    <div key={s.commitment.id} className="flex items-center justify-between gap-2 rounded-xl px-1 py-2 text-sm">
                      <span className={cx("min-w-0 truncate", s.state === "paid" && "text-ink-400 line-through")}>
                        {tagEmoji(s.commitment.tag, commitmentCategory(s.commitment))} {s.commitment.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Pill tone={tone}>{label}</Pill>
                        <Money paise={s.commitment.amountPaise} className="w-20 text-right" />
                        {s.matchedTxnIds.length === 0 && (
                          <button
                            className={cx("grid h-8 w-8 place-items-center rounded-lg border", s.manuallyPaid ? "border-lime bg-lime text-ink-950" : "border-white/15 text-transparent hover:text-ink-400")}
                            onClick={() => db && markCommitmentPaid(db, key, !s.manuallyPaid)}
                            aria-label={s.manuallyPaid ? `Mark ${s.commitment.name} unpaid` : `Mark ${s.commitment.name} paid`}
                          >
                            ✓
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function Split({ label, paise, dot, testId }: { label: string; paise: number; dot: string; testId?: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] p-3">
      <div className="flex items-center gap-2 text-xs text-ink-400">
        <span className={cx("h-2 w-2 rounded-full", dot)} />
        {label}
      </div>
      <div className="num mt-1 text-lg font-semibold" data-testid={testId}>
        <Money paise={paise} />
      </div>
    </div>
  );
}

type TipProps = { active?: boolean; payload?: { name: string; value: number; payload: Record<string, number | string> }[]; label?: string };

function ChartTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-ink-800 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-semibold">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex justify-between gap-4 text-ink-300">
          <span>{p.name} so far</span>
          <span className="num text-white">{formatINR(Math.round(p.value * 100))}</span>
        </div>
      ))}
    </div>
  );
}

function DayTip({ active, payload, label, hasBudget }: TipProps & { hasBudget: boolean }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-xl border border-white/10 bg-ink-800 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-semibold">{label}</div>
      <div className="flex justify-between gap-4 text-ink-300">
        <span>Spent</span>
        <span className="num text-white">{formatINR(Math.round(Number(d.daySpent) * 100))}</span>
      </div>
      {hasBudget && (
        <div className="flex justify-between gap-4 text-ink-300">
          <span>Base allowance</span>
          <span className="num text-white">{formatINR(Math.round(Number(d.dayBudget) * 100))}</span>
        </div>
      )}
    </div>
  );
}
