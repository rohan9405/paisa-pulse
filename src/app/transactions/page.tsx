"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { HoldList } from "@/components/HoldList";
import { RecipientTagger } from "@/components/RecipientTagger";
import { recipientKey, taggingFlow, recipientNeedsTagging, withinTaggingWindow } from "@/lib/recipients";
import { ACTIVE_CATEGORIES as CATEGORIES, displayCategory } from "@/lib/categorize";
import { type DateKey, addDays, addMonths, endOfMonth, formatMonth, isDateKey, monthKey, relativeDayLabel, startOfMonth } from "@/lib/dates";
import { hasBudget, matchCommitment, modeOf, planForDate } from "@/lib/budget";
import { commitmentCandidates, transferPairs } from "@/lib/match";
import { formatINR } from "@/lib/money";
import type { Transaction, TxnKind } from "@/lib/types";
import { dismissSuggestion, updateTxn } from "@/data/repo";
import { useBudget } from "@/data/useBudget";
import { useRemoteConfig } from "@/data/remoteConfigLoader";
import { useQuickAdd } from "@/components/AppShell";
import { KIND_LABEL, TxnEditor } from "@/components/TxnEditor";
import { TxnRow } from "@/components/TxnRow";
import { Card, EmptyState, PageHeader, SectionTitle, cx } from "@/components/ui";
import { IconSearch } from "@/components/icons";

type KindFilter = "all" | TxnKind | "review";
type Period = "7d" | "month" | "lastmonth" | "selectedmonth" | "all";

export default function TransactionsPage() {
  return (
    <Suspense>
      <TransactionsWithFilters />
    </Suspense>
  );
}

// Reset local controls when a different category/month deep link is opened,
// including client-side navigation while Activity is already mounted.
function TransactionsWithFilters() {
  const params = useSearchParams();
  return <Transactions key={params.toString()} />;
}

function Transactions() {
  const config = useRemoteConfig();
  const params = useSearchParams();
  const { data, derived, today, db } = useBudget();
  const { open } = useQuickAdd();
  const [view, setView] = useState<"transactions" | "recipients">("transactions");
  const [recipientTab, setRecipientTab] = useState<"pending" | "archived">("pending");
  const [recipient, setRecipient] = useState<Transaction[] | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>(params.get("review") ? "review" : "all");
  const linkedMonth = params.get("month") ?? "";
  const selectedMonth = /^\d{4}-\d{2}$/.test(linkedMonth) && isDateKey(`${linkedMonth}-01`) ? linkedMonth : "";
  const linkedCategory = params.get("category") ?? "";
  const [cat, setCat] = useState(CATEGORIES.some(c => c === linkedCategory) ? linkedCategory : "");
  const [period, setPeriod] = useState<Period>(selectedMonth ? "selectedmonth" : params.get("review") ? "all" : "month");
  const [editing, setEditing] = useState<Transaction | null>(null);

  const range = useMemo((): [DateKey, DateKey] => {
    if (period === "selectedmonth" && selectedMonth) return [`${selectedMonth}-01`, endOfMonth(`${selectedMonth}-01`) > today ? today : endOfMonth(`${selectedMonth}-01`)];
    if (period === "7d") return [addDays(today, -6), today];
    if (period === "month") return [startOfMonth(today), today];
    if (period === "lastmonth") {
      const lm = addMonths(monthKey(today), -1) + "-01";
      return [lm, endOfMonth(lm)];
    }
    return ["0000-01-01", "9999-12-31"];
  }, [period, today, selectedMonth]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.txns
      .filter((t) => t.date >= range[0] && t.date <= range[1])
      .filter((t) => (kind === "all" ? true : kind === "review" ? t.needsReview : t.kind === kind))
      .filter((t) => !cat || displayCategory(t.category) === cat)
      .filter((t) => !needle || [t.merchant, t.payee, t.category, t.note, t.source.raw, (t.amountPaise / 100).toString()].some((s) => s?.toLowerCase().includes(needle)))
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
  }, [data, q, kind, cat, range]);

  const groups = useMemo(() => {
    const m = new Map<DateKey, Transaction[]>();
    for (const t of filtered) m.set(t.date, [...(m.get(t.date) ?? []), t]);
    return [...m.entries()];
  }, [filtered]);

  // Group once so every recipient row does not rescan the entire history.
  const allRecipients = useMemo(() => {
    const result = new Map<string, Transaction[]>();
    for (const t of data?.txns ?? []) {
      const key = recipientKey(t);
      if (!key || !["out", "income"].includes(taggingFlow(t))) continue;
      const groupKey = `${key}:${taggingFlow(t)}`;
      const group = result.get(groupKey);
      if (group) group.push(t);
      else result.set(groupKey, [t]);
    }
    return result;
  }, [data?.txns]);

  const recipients = useMemo(() => {
    const result = new Map<string, Transaction[]>();
    for (const t of filtered) {
      const key = recipientKey(t);
      if (!key || !["out", "income"].includes(taggingFlow(t))) continue;
      const groupKey = `${key}:${taggingFlow(t)}`;
      result.set(groupKey, [...(result.get(groupKey) ?? []), t]);
    }
    return [...result.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const recipientQueues = useMemo(() => {
    const pending: typeof recipients = [];
    const archived: typeof recipients = [];
    for (const group of recipients) {
      (recipientNeedsTagging(allRecipients.get(group[0]) ?? group[1], today) ? pending : archived).push(group);
    }
    return { pending, archived };
  }, [recipients, allRecipients, today]);

  const suggestions = useMemo(() => {
    if (!data) return { pairs: [], matches: [] };
    const dismissed = new Set(data.profile?.dismissedSuggestions ?? []);
    const recent = data.txns.filter((t) => t.date >= addDays(today, -62));
    const pairs = transferPairs(recent)
      .map((p) => ({ ...p, key: `transfer:${p.out.id}:${p.in.id}` }))
      .filter((p) => !dismissed.has(p.key));
    // Planned lines only matter in planned set-aside mode. One card per payee and line;
    // a "No" covers that payee's other payments too, so the card doesn't come back next month.
    const seen = new Set<string>();
    const matches = recent
      .filter((t) => {
        const plan = planForDate(data.plans, t.date);
        return t.kind === "expense" && hasBudget(plan) && modeOf(plan) === "planned" && !matchCommitment(t, plan);
      })
      .map((t) => {
        const c = commitmentCandidates(t, data.plans, data.txns)[0];
        return { t, c, key: c ? `match:${recipientKey(t) ?? t.id}:${c.commitment.id}` : "" };
      })
      .filter((x) => x.c && x.c.score >= 60 && !dismissed.has(x.key) && !seen.has(x.key) && seen.add(x.key));
    return { pairs, matches };
  }, [data, today]);

  if (!data || !derived) return null;
  const commitmentName = (id?: string) => data.plans.flatMap((p) => p.commitments).find((c) => c.id === id)?.name;
  const reviewCount = data.txns.filter((t) => t.needsReview).length;
  const dismiss = (key: string) => db && dismissSuggestion(db, key);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        screen="activity"
        title="Activity"
        subtitle={`${filtered.length} transaction${filtered.length === 1 ? "" : "s"}`}
        right={
          config.features.csvImport ? (
            <Link href="/import" className="btn-ghost">
              Import CSV
            </Link>
          ) : undefined
        }
      />

      <div className="mb-3 flex gap-2" aria-label="Activity view">
        <button className={cx("chip", view === "transactions" && "chip-on")} onClick={() => setView("transactions")}>Transactions</button>
        <button className={cx("chip", view === "recipients" && "chip-on")} onClick={() => setView("recipients")}>Recipients</button>
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400">
          <IconSearch />
        </span>
        <input className="input pl-10" placeholder="Search merchant, note, amount…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" data-testid="txn-search" />
      </div>

      <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {(["all", "expense", "commitment", "investment", "transfer", "refund", "settlement", "income", "review"] as KindFilter[]).map((k) => (
          <button key={k} className={cx("chip", kind === k && "chip-on")} onClick={() => setKind(k)}>
            {k === "all" ? "All" : k === "review" ? `⚠️ Review${reviewCount ? ` (${reviewCount})` : ""}` : KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <select className="input text-sm" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
          {selectedMonth && <option value="selectedmonth">{formatMonth(selectedMonth)}</option>}
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
            {suggestions.matches.slice(0, 3).map(({ t, c, key }) => (
              <Card key={key} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span className="min-w-0">
                  <b><span data-preserve-case>{t.merchant}</span></b> {formatINR(t.amountPaise)} looks like <b className="text-sky">{c!.commitment.name}</b>
                  <span className="block text-xs text-ink-400">{c!.reason} · matching stops it counting against your daily budget</span>
                </span>
                <span className="flex gap-1.5">
                  <button className="btn-ghost min-h-[36px] text-xs" onClick={() => dismiss(key)}>
                    No
                  </button>
                  <button className="btn-primary min-h-[36px] text-xs" onClick={() => db && updateTxn(db, t.id, { kind: "commitment", commitmentId: c!.commitment.id })}>
                    Match
                  </button>
                </span>
              </Card>
            ))}
            {suggestions.pairs.slice(0, 3).map((p) => (
              <Card key={p.key} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span className="min-w-0">
                  {formatINR(p.out.amountPaise)} out (<span data-preserve-case>{p.out.merchant}</span>) and in (<span data-preserve-case>{p.in.merchant}</span>) — <b>own-account transfer?</b>
                  <span className="block text-xs text-ink-400">Transfers are excluded from spending and income</span>
                </span>
                <span className="flex gap-1.5">
                  <button className="btn-ghost min-h-[36px] text-xs" onClick={() => dismiss(p.key)}>
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

      {view === "recipients" ? <div className="mt-4 space-y-2">
        <div className="mb-3 flex flex-wrap gap-2" aria-label="Recipient queue">
          <button className={cx("chip", recipientTab === "pending" && "chip-on")} onClick={() => setRecipientTab("pending")} data-testid="recipients-pending">Needs tagging ({recipientQueues.pending.length})</button>
          <button className={cx("chip", recipientTab === "archived" && "chip-on")} onClick={() => setRecipientTab("archived")} data-testid="recipients-archived">Archived ({recipientQueues.archived.length})</button>
        </div>
        <p className="mb-3 text-xs text-ink-400">{recipientTab === "pending" ? "Tag a recipient to move them to Archived. New untagged or inconsistent payments bring them back here." : "Recipients with consistent categories and tags. Open one to edit it again."} Bulk edits cover the last 12 months; older history stays unchanged.</p>
        {recipientQueues[recipientTab].length === 0 && <EmptyState emoji={recipientTab === "pending" ? "✓" : "🔍"} title={recipientTab === "pending" ? "No recipients need tagging" : "No archived recipients"} body="Counts follow your search, category and period filters. Refunds and own transfers are edited individually." />}
        {recipientQueues[recipientTab].map(([key, ts]) => {
          const t = ts[0];
          const all = allRecipients.get(key) ?? ts;
          const recent = all.filter((other) => withinTaggingWindow(other, today));
          const labels = new Set((recent.length ? recent : all).map((other) => `${other.category}${other.tag ? ` · ${other.tag}` : ""}`));
          return <button key={key} className="card flex w-full items-center justify-between gap-3 p-4 text-left" onClick={() => setRecipient(all)} data-testid="recipient-row">
            <span className="min-w-0"><span className="block truncate font-semibold"><span data-preserve-case>{t.merchant}</span></span>{t.payee && <span className="block truncate text-xs text-ink-400">{t.payee}</span>}<span className="block text-xs text-ink-300">{ts.length} transaction{ts.length === 1 ? "" : "s"} · {labels.size === 1 ? [...labels][0] : "Mixed categories / tags"}</span></span>
            <span className="shrink-0 text-sm text-lime">{recipientTab === "pending" ? "Tag all →" : "Edit tags →"}</span>
          </button>;
        })}
      </div> : <div className="mt-4">
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
      </div>}
      {recipient && <RecipientTagger txns={recipient} onClose={() => setRecipient(null)} />}
      {view === "transactions" && <HoldList holds={data.holds} history />}
      <TxnEditor txn={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
