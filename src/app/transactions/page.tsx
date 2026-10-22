"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { CATEGORIES } from "@/lib/categorize";
import { type DateKey, addDays, addMonths, endOfMonth, monthKey, relativeDayLabel, startOfMonth } from "@/lib/dates";
import { matchCommitment, planForDate } from "@/lib/budget";
import { commitmentCandidates, transferPairs } from "@/lib/match";
import { formatINR } from "@/lib/money";
import type { Transaction, TxnKind } from "@/lib/types";
import { updateTxn } from "@/data/repo";
import { useBudget } from "@/data/useBudget";
import { useQuickAdd } from "@/components/AppShell";
import { KIND_LABEL, TxnEditor } from "@/components/TxnEditor";
import { TxnRow } from "@/components/TxnRow";
import { Card, EmptyState, PageHeader, SectionTitle, cx } from "@/components/ui";
import { IconSearch } from "@/components/icons";

type KindFilter = "all" | TxnKind | "review";
type Period = "7d" | "month" | "lastmonth" | "all";

export default function TransactionsPage() {
  return (
    <Suspense>
      <Transactions />
    </Suspense>
  );
}

function Transactions() {
  const params = useSearchParams();
  const { data, derived, today, db } = useBudget();
  const { open } = useQuickAdd();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>(params.get("review") ? "review" : "all");
  const [cat, setCat] = useState("");
  const [period, setPeriod] = useState<Period>(params.get("review") ? "all" : "month");
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const range = useMemo((): [DateKey, DateKey] => {
    if (period === "7d") return [addDays(today, -6), today];
    if (period === "month") return [startOfMonth(today), today];
    if (period === "lastmonth") {
      const lm = addMonths(monthKey(today), -1) + "-01";
      return [lm, endOfMonth(lm)];
    }
    return ["0000-01-01", "9999-12-31"];
  }, [period, today]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.txns
      .filter((t) => t.date >= range[0] && t.date <= range[1])
      .filter((t) => (kind === "all" ? true : kind === "review" ? t.needsReview : t.kind === kind))
      .filter((t) => !cat || t.category === cat)
      .filter((t) => !needle || [t.merchant, t.category, t.note, t.source.raw, (t.amountPaise / 100).toString()].some((s) => s?.toLowerCase().includes(needle)))
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
  }, [data, q, kind, cat, range]);

  const groups = useMemo(() => {
    const m = new Map<DateKey, Transaction[]>();
    for (const t of filtered) m.set(t.date, [...(m.get(t.date) ?? []), t]);
    return [...m.entries()];
  }, [filtered]);

  const suggestions = useMemo(() => {
    if (!data) return { pairs: [], matches: [] };
    const recent = data.txns.filter((t) => t.date >= addDays(today, -62));
    const pairs = transferPairs(recent).filter((p) => !dismissed.has(p.out.id));
    const matches = recent
      // Payments already matched to a planned line automatically need no suggestion.
      .filter((t) => t.kind === "expense" && !dismissed.has(t.id) && !matchCommitment(t, planForDate(data.plans, t.date)))
      .map((t) => ({ t, c: commitmentCandidates(t, data.plans, data.txns)[0] }))
      .filter((x) => x.c && x.c.score >= 60);
    return { pairs, matches };
  }, [data, today, dismissed]);

  if (!data || !derived) return null;
  const commitmentName = (id?: string) => data.plans.flatMap((p) => p.commitments).find((c) => c.id === id)?.name;
  const reviewCount = data.txns.filter((t) => t.needsReview).length;
  const dismiss = (id: string) => setDismissed((s) => new Set(s).add(id));

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Activity"
        subtitle={`${filtered.length} transaction${filtered.length === 1 ? "" : "s"}`}
        right={
          <Link href="/import" className="btn-ghost">
            Import CSV
          </Link>
        }
      />

      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400">
          <IconSearch />
        </span>
        <input className="input pl-10" placeholder="Search merchant, note, amount…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" data-testid="txn-search" />
      </div>

      <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {(["all", "expense", "commitment", "investment", "transfer", "refund", "income", "review"] as KindFilter[]).map((k) => (
          <button key={k} className={cx("chip", kind === k && "chip-on")} onClick={() => setKind(k)}>
            {k === "all" ? "All" : k === "review" ? `⚠️ Review${reviewCount ? ` (${reviewCount})` : ""}` : KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <select className="input text-sm" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
          <option value="7d">Last 7 days</option>
          <option value="month">This month</option>
          <option value="lastmonth">Last month</option>
          <option value="all">All time</option>
        </select>
        <select className="input text-sm" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {(suggestions.pairs.length > 0 || suggestions.matches.length > 0) && kind !== "review" && (
        <>
          <SectionTitle>Smart matches</SectionTitle>
          <div className="space-y-2">
            {suggestions.matches.slice(0, 3).map(({ t, c }) => (
              <Card key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span className="min-w-0">
                  <b>{t.merchant}</b> {formatINR(t.amountPaise)} looks like <b className="text-sky">{c!.commitment.name}</b>
                  <span className="block text-xs text-ink-400">{c!.reason} · matching stops it counting against your daily budget</span>
                </span>
                <span className="flex gap-1.5">
                  <button className="btn-ghost min-h-[36px] text-xs" onClick={() => dismiss(t.id)}>
                    No
                  </button>
                  <button className="btn-primary min-h-[36px] text-xs" onClick={() => db && updateTxn(db, t.id, { kind: "commitment", commitmentId: c!.commitment.id })}>
                    Match
                  </button>
                </span>
              </Card>
            ))}
            {suggestions.pairs.slice(0, 3).map((p) => (
              <Card key={p.out.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span className="min-w-0">
                  {formatINR(p.out.amountPaise)} out ({p.out.merchant}) and in ({p.in.merchant}) — <b>own-account transfer?</b>
                  <span className="block text-xs text-ink-400">Transfers are excluded from spending and income</span>
                </span>
                <span className="flex gap-1.5">
                  <button className="btn-ghost min-h-[36px] text-xs" onClick={() => dismiss(p.out.id)}>
                    No
                  </button>
                  <button
                    className="btn-primary min-h-[36px] text-xs"
                    onClick={async () => {
                      if (!db) return;
                      await updateTxn(db, p.out.id, { kind: "transfer", category: "Transfers" });
                      await updateTxn(db, p.in.id, { kind: "transfer", category: "Transfers" });
                    }}
                  >
                    Yes, transfer
                  </button>
                </span>
              </Card>
            ))}
          </div>
        </>
      )}

      <div className="mt-4">
        {data.txns.length === 0 ? (
          <EmptyState
            emoji="🫙"
            title="No transactions yet"
            body="Add expenses as you go, or import a CSV statement from your bank."
            action={
              <div className="flex gap-2">
                <button className="btn-primary" onClick={() => open()}>
                  Add expense
                </button>
                <Link href="/import" className="btn-ghost">
                  Import CSV
                </Link>
              </div>
            }
          />
        ) : groups.length === 0 ? (
          <EmptyState emoji="🔍" title="Nothing matches" body="Try a different search, filter or period." action={<button className="btn-ghost" onClick={() => (setQ(""), setKind("all"), setCat(""), setPeriod("all"))}>Clear filters</button>} />
        ) : (
          groups.map(([date, ts]) => {
            const spent = ts.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amountPaise, 0);
            return (
              <section key={date} className="mb-3">
                <div className="flex items-baseline justify-between px-2 pb-1 pt-2">
                  <h3 className="text-[13px] font-semibold text-ink-300">{relativeDayLabel(date, today)}</h3>
                  {spent > 0 && <span className="num text-xs text-ink-400">spent {formatINR(spent)}</span>}
                </div>
                <Card className="p-1.5">
                  {ts.map((t) => (
                    <TxnRow key={t.id} t={t} onClick={() => setEditing(t)} commitmentName={commitmentName(t.commitmentId)} />
                  ))}
                </Card>
              </section>
            );
          })
        )}
      </div>
      <TxnEditor txn={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
