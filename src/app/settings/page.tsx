"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { planForDate, poolSummary } from "@/lib/budget";
import { CATEGORIES } from "@/lib/categorize";
import { formatDay, toISTKey } from "@/lib/dates";
import { formatINR, paiseToRupeeInput, parseAmountToPaise, rupeesInputToPaise } from "@/lib/money";
import type { Profile, TxnKind } from "@/lib/types";
import { deleteDatabase } from "@/data/db";
import { PROVIDERS } from "@/data/providers/registry";
import { smsBridge, syncSms } from "@/data/providers/sms";
import { backupNow, filesBridge, lastBackupAt, saveFile } from "@/data/backup";
import { addPlanVersion, exportAll, importBackup, recategorizeAll, saveRule, seedDemo, txnsToCsv } from "@/data/repo";
import { useBudget } from "@/data/useBudget";
import { CommitmentList, type CommitmentDraft, draftFromCommitment, validateDrafts } from "@/components/CommitmentEditor";
import { AmountInput, Card, Field, Money, PageHeader, Pill, SectionTitle, Toast, cx } from "@/components/ui";
import { useStore } from "@/data/store";

export default function SettingsPage() {
  const { data, derived, today, db, mode } = useBudget();
  const { setMode } = useStore();
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);

  if (!data || !derived || !data.profile) return null;
  const { profile, plans } = data;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" subtitle={mode === "demo" ? "Demo mode — changes affect fictional data only" : "Personal mode"} />

      <BudgetEditor key={derived.plan?.id ?? "none"} />

      <SectionTitle>Tracking</SectionTitle>
      <TrackingEditor key={`${profile.trackingStart}|${profile.openingAdjustmentPaise}`} profile={profile} onSaved={(n) => setToast(n ? `Saved · ${n} earlier transactions read from SMS` : "Tracking settings saved")} />

      <SectionTitle>Plan history</SectionTitle>
      <Card className="space-y-2 text-sm">
        {[...plans]
          .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
          .map((p) => {
            const s = poolSummary(p);
            const active = planForDate(plans, today)?.id === p.id;
            return (
              <div key={p.id} className="flex items-center justify-between">
                <span>
                  From {formatDay(p.effectiveFrom, { year: true })} {active && <Pill tone="lime">current</Pill>} {p.effectiveFrom > today && <Pill tone="sky">scheduled</Pill>}
                </span>
                <span className="num text-ink-300">{s.hasBudget ? `${formatINR(s.poolPaise)}/mo pool` : "tracking only"}</span>
              </div>
            );
          })}
      </Card>

      <SectionTitle>Categorisation rules</SectionTitle>
      <RulesEditor onToast={setToast} />

      <SectionTitle>Data sources</SectionTitle>
      <Card className="space-y-3">
        {PROVIDERS.filter((p) => (mode === "demo" ? p.id !== "manual" && p.id !== "csv" : p.id !== "demo")).map((p) => {
          const c = data.connections.find((x) => x.providerId === p.id);
          const bridge = p.id === "sms" ? smsBridge() : null;
          const status = p.id === "sms" && !bridge ? "android_only" : (c?.status ?? (p.available ? "disconnected" : "not_available"));
          return (
            <div key={p.id} className="flex items-start justify-between gap-3 text-sm" data-testid={`provider-${p.id}`}>
              <div className="min-w-0">
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-ink-400">{p.description}</div>
                {c?.lastSyncAt && (
                  <div className="mt-0.5 text-xs text-ink-400">
                    Last activity {new Date(c.lastSyncAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}
                    {c.lastCount !== undefined && ` · ${c.lastCount} txns`}
                  </div>
                )}
                {c?.lastError && <div className="text-xs text-coral">Error: {c.lastError}</div>}
                {bridge && !bridge.hasPermission() && (
                  <button className="btn-ghost mt-1 text-xs" onClick={() => bridge.requestPermission()}>
                    Allow SMS access
                  </button>
                )}
                {bridge && bridge.hasPermission() && db && (
                  <button className="btn-ghost mt-1 text-xs" onClick={() => syncSms(db).then((n) => setToast(n ? `${n} new from SMS` : "No new bank SMS"))}>
                    Check now
                  </button>
                )}
              </div>
              <Pill tone={status === "connected" ? "lime" : status === "error" ? "coral" : "default"}>
                {status === "not_available" ? "coming later" : status === "android_only" ? "Android app only" : status}
              </Pill>
            </div>
          );
        })}
        <p className="text-xs text-ink-400">We never ask for bank passwords, PINs or OTPs. Bank SMS are read and parsed on this phone only; OTPs, offers and failed transactions are ignored.</p>
      </Card>

      <SectionTitle>Notifications</SectionTitle>
      <Card className="text-sm text-ink-300">
        🔔 Morning briefing and evening report are in-app only for now. Scheduled push notifications aren't implemented yet.
      </Card>

      <SectionTitle>Your data</SectionTitle>
      <DataPanel onToast={setToast} />

      <SectionTitle>Mode</SectionTitle>
      <Card className="space-y-3 text-sm">
        <p className="text-ink-300">Demo and personal data are stored in separate databases and never mix.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => setMode(mode === "demo" ? "personal" : "demo").then(() => router.replace("/"))}>
            Switch to {mode === "demo" ? "personal" : "demo"} mode
          </button>
          {mode === "demo" && db && (
            <button className="btn-ghost" onClick={async () => (await seedDemo(db, today), setToast("Demo data regenerated"))}>
              Reset demo data
            </button>
          )}
        </div>
      </Card>

      <p className="mt-8 text-center text-xs text-ink-400">Paisa Pulse · tracking since {formatDay(profile.trackingStart, { year: true })} · no analytics, no external AI</p>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function BudgetEditor() {
  const { data, derived, today, db } = useBudget();
  const plan = derived?.plan;
  const [editing, setEditing] = useState(false);
  const [income, setIncome] = useState("");
  const [trackOnly, setTrackOnly] = useState(false);
  const [drafts, setDrafts] = useState<CommitmentDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [from, setFrom] = useState(today);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setIncome(plan?.incomePaise ? paiseToRupeeInput(plan.incomePaise) : "");
    setTrackOnly(!plan?.incomePaise);
    setDrafts((plan?.commitments ?? []).map(draftFromCommitment));
    setFrom(today);
    setErr(null);
    setErrors({});
  }, [editing, plan, today]);

  const preview = useMemo(() => {
    const { commitments } = validateDrafts(drafts);
    return poolSummary({ id: "", effectiveFrom: from, incomePaise: trackOnly ? null : rupeesInputToPaise(income), commitments, createdAt: 0 });
  }, [drafts, income, trackOnly, from]);

  if (!data || !derived) return null;
  const pool = derived.pool;

  const save = async () => {
    if (!db) return;
    const inc = trackOnly ? null : rupeesInputToPaise(income);
    if (!trackOnly && !inc) return setErr("Enter your monthly take-home income, or choose tracking only.");
    const { commitments, errors } = validateDrafts(drafts);
    setErrors(errors);
    if (Object.keys(errors).length) return;
    if (!from || from < data.profile!.trackingStart) return setErr(`Effective date must be on or after tracking start (${formatDay(data.profile!.trackingStart, { year: true })}).`);
    await addPlanVersion(db, { effectiveFrom: from, incomePaise: inc, commitments });
    setEditing(false);
  };

  if (!editing) {
    return (
      <Card className="space-y-2 text-sm" data-testid="budget-summary">
        <div className="flex items-center justify-between">
          <span className="font-semibold">Monthly budget</span>
          <button className="btn-ghost min-h-[36px] text-xs" onClick={() => setEditing(true)} data-testid="edit-budget">
            Change budget
          </button>
        </div>
        {pool.hasBudget ? (
          <>
            <Line label="Take-home" value={formatINR(pool.incomePaise)} />
            <Line label="Fixed bills" value={`− ${formatINR(pool.billsPaise)}`} />
            <Line label="Savings & SIPs" value={`− ${formatINR(pool.savingsPaise)}`} />
            <Line label="Spending pool" value={formatINR(pool.poolPaise)} strong />
            {pool.shortfallPaise > 0 && <p className="text-coral">Commitments exceed income by {formatINR(pool.shortfallPaise)} — daily allowance is ₹0.</p>}
          </>
        ) : (
          <p className="text-ink-400">Tracking only — no budget. Add your income to get a daily allowance.</p>
        )}
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <div className="font-semibold">Change budget</div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-lime" checked={trackOnly} onChange={(e) => setTrackOnly(e.target.checked)} />
        Tracking only (no daily budget)
      </label>
      {!trackOnly && (
        <Field label="Monthly take-home income">
          <AmountInput value={income} onChange={setIncome} aria-label="Monthly income" data-testid="settings-income" />
        </Field>
      )}
      <div>
        <span className="label">Bills & savings</span>
        <CommitmentList drafts={drafts} onChange={setDrafts} errors={errors} />
      </div>
      <Field label="Effective from" hint="Earlier days keep the old budget. Changing a past date recalculates from then.">
        <input type="date" className="input" value={from} min={data.profile!.trackingStart} onChange={(e) => setFrom(e.target.value)} data-testid="settings-effective" />
      </Field>
      {!trackOnly && (
        <p className="text-sm text-ink-300">
          New pool: <Money paise={preview.poolPaise} className="font-semibold" />/month
          {preview.shortfallPaise > 0 && <span className="text-coral"> · exceeds income by {formatINR(preview.shortfallPaise)}</span>}
        </p>
      )}
      {err && <p className="text-sm text-coral">{err}</p>}
      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button className="btn-primary flex-1" onClick={save} data-testid="save-budget">
          Save from {formatDay(from)}
        </button>
      </div>
    </Card>
  );
}

function TrackingEditor({ profile: p, onSaved }: { profile: Profile; onSaved: (smsAdded: number) => void }) {
  const { data, today, db } = useBudget();
  const [start, setStart] = useState(p.trackingStart);
  const [opening, setOpening] = useState(paiseToRupeeInput(p.openingAdjustmentPaise));
  const [err, setErr] = useState<string | null>(null);
  if (!db) return null;
  const dirty = start !== p.trackingStart || parseAmountToPaise(opening || "0") !== p.openingAdjustmentPaise;
  const save = async () => {
    const adj = parseAmountToPaise(opening || "0");
    if (adj === null) return setErr("Opening adjustment isn't a valid amount");
    if (!start || start > today) return setErr("Start date must be today or earlier");
    await db.profile.update("me", { trackingStart: start, openingAdjustmentPaise: adj });
    // Keep the earliest plan in force from the start date.
    const earliest = [...(data?.plans ?? [])].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];
    if (earliest && earliest.effectiveFrom > start) await db.plans.update(earliest.id, { effectiveFrom: start });
    setErr(null);
    // An earlier start backfills bank SMS from the new date.
    onSaved(smsBridge() ? await syncSms(db).catch(() => 0) : 0);
  };
  return (
    <Card className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tracking start" hint={smsBridge() ? "Allowance accrues from this date. Moving it earlier reads your bank SMS from then." : "Allowance accrues from this date."}>
          <input type="date" className="input" value={start} max={today} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Opening adjustment (₹)" hint="One-time, default 0. Negative = start in deficit.">
          <input className="input num" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value.replace(/[^\d.,\-]/g, ""))} />
        </Field>
      </div>
      {err && <p className="text-sm text-coral">{err}</p>}
      {dirty && (
        <button className="btn-primary w-full" onClick={save}>
          Save — recalculates balance history
        </button>
      )}
    </Card>
  );
}

function RulesEditor({ onToast }: { onToast: (s: string) => void }) {
  const { data, db } = useBudget();
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("Food & Dining");
  const [kind, setKind] = useState<"" | TxnKind>("");
  const [showBuiltIn, setShowBuiltIn] = useState(false);
  if (!data || !db) return null;
  const user = data.rules.filter((r) => !r.builtIn).sort((a, b) => a.pattern.localeCompare(b.pattern));
  const builtIn = data.rules.filter((r) => r.builtIn);

  const add = async () => {
    if (!pattern.trim()) return;
    await saveRule(db, { pattern: pattern.trim().toLowerCase(), category: kind === "transfer" ? "Transfers" : kind === "investment" ? "Investments" : category, kind: kind || undefined, priority: 10 });
    setPattern("");
    onToast("Rule added");
  };

  return (
    <Card className="space-y-3">
      <p className="text-xs text-ink-400">If a merchant or narration contains the text, it gets that category. Your rules beat built-ins. Use “Own transfer” for your other accounts (e.g. “sbi xx1234”).</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <input className="input text-sm" placeholder="Contains… e.g. chai point" value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="Rule text" />
        <select className="input text-sm" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Rule category" disabled={kind === "transfer" || kind === "investment"}>
          {CATEGORIES.filter((c) => !["Income", "Refunds", "Transfers"].includes(c)).map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select className="input text-sm" value={kind} onChange={(e) => setKind(e.target.value as TxnKind | "")} aria-label="Rule type">
          <option value="">Expense</option>
          <option value="transfer">Own transfer</option>
          <option value="investment">Investment</option>
        </select>
        <button className="btn-primary" onClick={add}>
          Add
        </button>
      </div>
      {user.length > 0 && (
        <div className="divide-y divide-white/5">
          {user.map((r) => (
            <div key={r.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                “{r.pattern}” → <b>{r.category}</b> {r.kind && <Pill>{r.kind}</Pill>}
              </span>
              <button className="text-xs text-coral" onClick={() => db.rules.delete(r.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost text-xs" onClick={async () => onToast(`Re-categorised ${await recategorizeAll(db)} expense(s)`)}>
          Re-apply rules to existing expenses
        </button>
        <button className="btn-ghost text-xs" onClick={() => setShowBuiltIn((s) => !s)}>
          {showBuiltIn ? "Hide" : "Show"} {builtIn.length} built-in rules
        </button>
      </div>
      {showBuiltIn && (
        <div className="flex flex-wrap gap-1">
          {builtIn.map((r) => (
            <span key={r.id} className="rounded-lg bg-white/[0.04] px-2 py-1 text-[11px] text-ink-300">
              {r.pattern} → {r.category}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

function DataPanel({ onToast }: { onToast: (s: string) => void }) {
  const { data, db, mode } = useBudget();
  const { setMode } = useStore();
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [asking, setAsking] = useState(false);
  const [restoreErr, setRestoreErr] = useState<string | null>(null);
  if (!data || !db || !mode) return null;

  const download = saveFile;
  const stamp = toISTKey();

  return (
    <Card className="space-y-4 text-sm">
      {filesBridge() ? (
        <AutoBackup onToast={onToast} />
      ) : (
        <div className="rounded-2xl bg-amber/[0.07] p-3 text-amber">
          🔒 Everything lives in this browser's storage (IndexedDB) — no server, no analytics, no AI upload. <b>That also means it's not a backup:</b> clearing site data, private windows or a new device will lose it. Export regularly.
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={async () => download(`paisa-pulse-${mode}-${stamp}.json`, JSON.stringify(await exportAll(db, mode), null, 2), "application/json")} data-testid="export-json">
          Export backup (JSON)
        </button>
        <button className="btn-ghost" onClick={() => download(`paisa-pulse-${mode}-transactions-${stamp}.csv`, txnsToCsv(data.txns), "text/csv")}>
          Export transactions (CSV)
        </button>
        <label className="btn-ghost cursor-pointer">
          Restore backup…
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setRestoreErr(null);
              try {
                const json = JSON.parse(await f.text());
                if (!window.confirm(`Replace all ${mode} data with the backup from ${json.exportedAt ?? "this file"}?`)) return;
                await importBackup(db, json);
                onToast("Backup restored");
              } catch (err) {
                setRestoreErr(err instanceof Error ? err.message : "Couldn't restore that file");
              }
            }}
          />
        </label>
      </div>
      {restoreErr && <p className="text-coral">{restoreErr}</p>}

      <div className="border-t border-white/5 pt-4">
        {!asking ? (
          <button className="btn-danger" onClick={() => setAsking(true)} data-testid="delete-start">
            Delete all {mode} data…
          </button>
        ) : (
          <div className="space-y-2">
            <p>
              This permanently deletes {data.txns.length} transactions, your budget and rules from this browser. Type <b className="text-coral">DELETE</b> to confirm.
            </p>
            <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" data-testid="delete-confirm-input" />
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => (setAsking(false), setConfirm(""))}>
                Cancel
              </button>
              <button
                className={cx("btn-danger flex-1", confirm === "DELETE" && "bg-coral text-ink-950")}
                disabled={confirm !== "DELETE"}
                data-testid="delete-confirm"
                onClick={async () => {
                  await deleteDatabase(mode);
                  await setMode(null);
                  router.replace("/");
                }}
              >
                Delete forever
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={strong ? "font-semibold" : "text-ink-400"}>{label}</span>
      <span className={cx("num", strong && "font-bold")}>{value}</span>
    </div>
  );
}

function AutoBackup({ onToast }: { onToast: (s: string) => void }) {
  const { db, mode } = useBudget();
  const files = filesBridge();
  const [folder, setFolder] = useState(() => files?.backupFolder() ?? "");
  const [last, setLast] = useState(lastBackupAt);
  useEffect(() => {
    const onFolder = async () => {
      setFolder(files?.backupFolder() ?? "");
      if (db && mode && (await backupNow(db, mode))) setLast(lastBackupAt());
    };
    const saved = () => onToast("Saved");
    const failed = () => onToast("Couldn't save the file");
    window.addEventListener("paisa-backup-folder", onFolder);
    window.addEventListener("paisa-file-saved", saved);
    window.addEventListener("paisa-file-save-failed", failed);
    return () => {
      window.removeEventListener("paisa-backup-folder", onFolder);
      window.removeEventListener("paisa-file-saved", saved);
      window.removeEventListener("paisa-file-save-failed", failed);
    };
  }, [files, db, mode, onToast]);
  if (!files || !db || !mode) return null;

  return (
    <div className={cx("space-y-2 rounded-2xl p-3", folder ? "bg-lime/[0.06]" : "bg-amber/[0.07] text-amber")} data-testid="auto-backup">
      {folder ? (
        <>
          <div>
            ✅ <b>Automatic backup is on.</b> A copy is saved to <b>{folder}</b> every day (last 14 days kept), outside the app, so it survives updates, uninstalling or clearing app data.
          </div>
          <div className="text-xs text-ink-400">{last ? `Last backup ${new Date(last).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}` : "No backup yet"}</div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost text-xs" onClick={async () => onToast((await backupNow(db, mode)) ? (setLast(lastBackupAt()), "Backed up") : "Backup failed: choose the folder again")}>
              Back up now
            </button>
            <button className="btn-ghost text-xs" onClick={() => files.chooseBackupFolder()}>
              Change folder
            </button>
          </div>
        </>
      ) : (
        <>
          <div>
            ⚠️ <b>Turn on automatic backup.</b> App updates keep your data, but uninstalling or clearing app data deletes it. Pick a folder once (e.g. a new “Paisa Pulse” folder in Documents, or Google Drive) and a copy is saved there every day.
          </div>
          <button className="btn-primary text-sm" onClick={() => files.chooseBackupFolder()}>
            Choose backup folder
          </button>
        </>
      )}
    </div>
  );
}
