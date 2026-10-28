"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { netInHandInRange, categoryBreakdown, commitmentCategory, commitmentStatuses, hasBudget as planHasBudget, modeOf, manualPaidKey, planForDate, spendVsBudgetSeries } from "@/lib/budget";
import { DEFAULT_PREFS } from "@/lib/types";
import { statsSpending } from "@/lib/statsSpending";
import { tagEmoji } from "@/lib/categorize";
import { type DateKey, addDays, addMonths, endOfMonth, formatDay, formatMonth, monthKey, startOfWeek } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { markCommitmentPaid } from "@/data/repo";
import { useBudget } from "@/data/useBudget";
import { useChartHaptics } from "@/components/hooks/useChartHaptics";
import { MerchantAnalytics } from "@/components/MerchantAnalytics";
import { SpendHeatmap } from "@/components/SpendHeatmap";
import { Card, EmptyState, InfoTip, Money, PageHeader, Pill, SectionTitle, Segmented, cx } from "@/components/ui";

type Period = "week" | "month";

const AXIS = { stroke: "#3a3a48", tick: { fill: "#8b8b9e", fontSize: 11 }, tickLine: false, axisLine: false } as const;

export default function DashboardPage() {
  const { data, derived, today, db } = useBudget();
  const [period, setPeriod] = useState<Period>("month");
  const [offset, setOffset] = useState(0);
  const includeInvestments = data?.profile?.prefs?.includeInvestments ?? DEFAULT_PREFS.includeInvestments ?? true;
  const cumulativeHaptics = useChartHaptics();
  const dailyHaptics = useChartHaptics();

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
    const position = netInHandInRange(data.txns, from, toClamped);
    const cats = categoryBreakdown(data.txns, data.plans, from, toClamped);
    const {spendingAverage,series:actualSeries}=statsSpending(data.txns,data.profile!.trackingStart,from,toClamped,includeInvestments);
    const budgetDays=new Map(spendVsBudgetSeries(derived.ledger,from,toClamped).map(d=>[d.date,d]));
    const series=actualSeries.map(d=>({...d,Budget:(budgetDays.get(d.date)?.cumBudgetPaise??0)/100,dayBudget:(budgetDays.get(d.date)?.budgetPaise??0)/100}));
    const periodHasBudget = derived.ledger.hasBudget && derived.ledger.days.filter((d) => d.date >= from && d.date <= toClamped).every((d) => d.hasBudget);
    return { spendingAverage, position, cats, series, periodHasBudget };
  }, [data, derived, from, toClamped, includeInvestments]);

  if (!data || !derived || !view) return null;
  const { spendingAverage, position, cats, series } = view;
  const hasBudget = view.periodHasBudget && !includeInvestments;
  const future = from > today;
  const mk = monthKey(today);
  const todayPlan = planForDate(data.plans, today);
  // Planned lines only exist in planned set-aside mode; other modes keep old lines unused.
  const showPlanned = planHasBudget(todayPlan) && modeOf(todayPlan) === "planned";
  const statuses = showPlanned ? commitmentStatuses(todayPlan, data.profile!, data.txns, mk, today) : [];

  return (
    <div>
      <PageHeader screen="stats" title="Stats" subtitle="Where your money is going" />
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
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Card className="lg:col-span-2">
            <div className="mb-2 flex items-center justify-between gap-2"><h2 className="text-xs font-semibold uppercase tracking-widest text-ink-400">Net In-Hand</h2><InfoTip label="About Net In-Hand">Income minus expenses and investments. Income includes all income buckets; refunds and settlements reduce their linked payment and are never counted as income. Legacy savings are included under investments.</InfoTip></div>
            <div className="num text-4xl font-bold" data-testid="net-in-hand"><Money paise={position.netPaise} /></div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Split label="Income" paise={position.incomePaise} dot="bg-sky" testId="out-income" />
              <Split label="Expenses" paise={position.expensesPaise} dot="bg-lime" testId="out-expenses" />
              <Split label="Investments" paise={position.investmentsPaise} dot="bg-violet" testId="out-investments" />
            </div>
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1"><h2 className="font-semibold">Cumulative spends</h2><InfoTip label="About cumulative spends">{includeInvestments ? "Expenses plus investments. " : "Expenses only. "}Dotted grey: last month using the same selection.{hasBudget ? " Dashed grey: budget allowance." : ""}</InfoTip></div>
            </div>
            {series.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-400">No tracked days in this period.</p>
            ) : (
              <div className="h-56" data-testid="chart-spend-vs-budget">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart {...cumulativeHaptics} data={series} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid stroke="#ffffff10" vertical={false} />
                    <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis {...AXIS} tickFormatter={(v) => formatINR(v * 100, { compact: true })} width={52} />
                    <Tooltip content={<ChartTip />} cursor={{ stroke: "#ffffff30" }} />
                    <Legend wrapperStyle={{ fontSize: 12, color: "#b4b4c4" }} iconType="plainline" />
                    {hasBudget && <Line type="monotone" dataKey="Budget" stroke="#8b8b9e" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />}
                    {period === "month" && <Line type="monotone" dataKey="Last month" stroke="#8b8b9e" strokeWidth={2} strokeDasharray="2 4" dot={false} connectNulls={false} isAnimationActive={false} />}
                    <Line type="monotone" dataKey="Spent" stroke="#c6ff3d" strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "#13131a", strokeWidth: 2 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1"><h2 className="font-semibold">Daily spending</h2><InfoTip label="About daily chart">Expenses per day in green; include investments to add the purple segment. The dotted average uses the same selection across tracked calendar days, including zero days.</InfoTip></div>
            </div>
            {series.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-400">No tracked days in this period.</p>
            ) : (
              <div className="h-56" data-testid="chart-daily">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart {...dailyHaptics} data={series} margin={{ top: 6, right: 8, left: -8, bottom: 0 }} barCategoryGap={2}>
                    <CartesianGrid stroke="#ffffff10" vertical={false} />
                    <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis {...AXIS} tickFormatter={(v) => formatINR(v * 100, { compact: true })} width={52} />
                    <Tooltip content={<DayTip hasBudget={hasBudget} includeInvestments={includeInvestments} />} cursor={{ fill: "#ffffff08" }} />
                    <ReferenceLine y={spendingAverage} stroke="#b4b4c4" strokeDasharray="2 4" ifOverflow="extendDomain" />
                    <Bar dataKey="dayExpenses" name="Expenses" stackId="spending" fill="#c6ff3d" radius={includeInvestments ? [0, 0, 0, 0] : [4, 4, 0, 0]} isAnimationActive={false} />
                    {includeInvestments && <Bar dataKey="dayInvestments" name="Investments" stackId="spending" fill="#a78bfa" radius={[4, 4, 0, 0]} isAnimationActive={false} />}
                    <Legend wrapperStyle={{fontSize:12}} iconType="circle" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="mt-2 text-[10px] text-ink-400" data-testid="daily-month-average">··· Month’s daily avg · {formatINR(Math.round(spendingAverage * 100))}</p>
          </Card>

          {showPlanned && <Card>
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
          </Card>}

          <MerchantAnalytics txns={data.txns} from={from} to={toClamped} trackingStart={data.profile!.trackingStart} categories={cats} />

          <SpendHeatmap includeInvestments={includeInvestments} txns={data.txns} trackingStart={data.profile!.trackingStart} today={today} endMonth={monthKey(toClamped)} />

        </div>
      )}
    </div>
  );
}

function Split({ label, paise, dot, testId }: { label: string; paise: number; dot: string; testId?: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-white/[0.03] p-2.5 sm:p-3">
      <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-ink-400 sm:text-xs">
        <span className={cx("h-2 w-2 rounded-full", dot)} />
        <span className="truncate" title={label}>{label}</span>
      </div>
      <div className="num mt-1 truncate text-base font-semibold sm:text-lg" title={formatINR(paise)} data-testid={testId}>
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

function DayTip({ active, payload, label, hasBudget, includeInvestments }: TipProps & { hasBudget: boolean; includeInvestments: boolean }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-xl border border-white/10 bg-ink-800 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-semibold">{label}</div>
      <div className="flex justify-between gap-4 text-ink-300">
        <span>Spent</span>
        <span className="num text-white">{formatINR(Math.round(Number(d.daySpent) * 100))}</span>
      </div>
      {includeInvestments && <>
        <div className="flex justify-between gap-4 text-ink-300"><span>Expenses</span><span className="num text-white">{formatINR(Math.round(Number(d.dayExpenses)*100))}</span></div>
        <div className="flex justify-between gap-4 text-ink-300"><span>Investments</span><span className="num text-white">{formatINR(Math.round(Number(d.dayInvestments)*100))}</span></div>
      </>}
      {hasBudget && (
        <div className="flex justify-between gap-4 text-ink-300">
          <span>Base allowance</span>
          <span className="num text-white">{formatINR(Math.round(Number(d.dayBudget) * 100))}</span>
        </div>
      )}
    </div>
  );
}
