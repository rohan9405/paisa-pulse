"use client";

import { isIpoMandate } from "@/lib/ipo";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { hasBudget, modeOf, planForDate, poolSummary, setAsideOf } from "@/lib/budget";
import { ACTIVE_CATEGORIES as CATEGORIES, DEFAULT_SET_ASIDE, SET_ASIDE_OPTIONS, TAGS, categoryEmoji, displayCategory, tagEmoji } from "@/lib/categorize";
import { formatDay, toISTKey } from "@/lib/dates";
import { formatINR, paiseToRupeeInput, parseAmountToPaise, rupeesInputToPaise } from "@/lib/money";
import { DEFAULT_PREFS, type CategoryRule, type Prefs, type Profile, type FundHold, type Recurring, type SetAsideMode, type TxnKind } from "@/lib/types";
import { deleteDatabase } from "@/data/db";
import { PROVIDERS } from "@/data/providers/registry";
import { smsBridge, syncSms } from "@/data/providers/sms";
import { supportedBanks } from "@/lib/sms";
import { USAGE_URL, setUsageAllowed, usageAllowed } from "@/data/usage";
import { backupNow, filesBridge, lastBackupAt, saveFile } from "@/data/backup";
import { addPlanVersion, exportAll, importBackup, recategorizeAll, saveRule, seedDemo, setPrefs, txnsToCsv } from "@/data/repo";
import { deviceBridge } from "@/data/device";
import { useBudget } from "@/data/useBudget";
import { CommitmentList, type CommitmentDraft, draftFromCommitment, validateDrafts } from "@/components/CommitmentEditor";
import { AmountInput, Card, Field, Money, PageHeader, Pill, Segmented, Toast, cx } from "@/components/ui";
import { useStore } from "@/data/store";
import { useRemoteConfig } from "@/data/remoteConfigLoader";

type Tab = "budget" | "data" | "app";
const TABS: { value: Tab; label: string }[] = [
  { value: "budget", label: "Tracking & budget" },
  { value: "data", label: "Data" },
  { value: "app", label: "App" },
];

export default function SettingsPage() {
  const config = useRemoteConfig();
  const { data, derived, today, db, mode } = useBudget();
  const { setMode } = useStore();
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  // The tab lives in the URL hash so back/forward and reloads keep it.
  const [tab, setTabState] = useState<Tab>("budget");
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (TABS.some((t) => t.value === h)) setTabState(h as Tab);
  }, []);
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, "", `#${t}`);
  };

  if (!data || !derived || !data.profile) return null;
  const { profile, plans } = data;
  const prefs = { ...DEFAULT_PREFS, ...profile.prefs };
  const pool = derived.pool;
  const userRules = data.rules.filter((r) => !r.builtIn).length;
  const sms = data.connections.find((c) => c.providerId === "sms");

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader screen="settings" title="Settings" subtitle={mode === "demo" ? "Demo mode — changes affect fictional data only" : "Personal mode"} />
      <div className="sticky top-0 z-20 -mx-4 mb-4 bg-ink-950/90 px-4 py-2 backdrop-blur md:static md:mx-0 md:bg-transparent md:px-0">
        <Segmented value={tab} onChange={setTab} options={TABS} className="w-full" />
      </div>

      {tab === "budget" && (
        <Group>
          <Section
            icon="💰"
            title="Budget mode"
            summary={!pool.hasBudget ? "Just tracking" : pool.mode === "actual" ? "Daily budget · Actual" : `Daily budget · Planned · ${formatINR(pool.poolPaise, { decimals: "never" })}/mo`}
            defaultOpen
          >
            <BudgetEditor key={derived.plan?.id ?? "none"} />
          </Section>
          <Section icon="🔁" title="Recurring payments" summary={recurringSummary(data.recurring, data.holds)}>
            <RecurringList />
          </Section>
          <Section icon="📅" title="Tracking start" summary={`Since ${formatDay(profile.trackingStart, { year: true })}`}>
            <TrackingEditor
              key={`${profile.trackingStart}|${profile.openingAdjustmentPaise}`}
              profile={profile}
              onSaved={(n) => setToast(n ? `Saved · ${n} earlier transactions read from SMS` : "Tracking settings saved")}
            />
          </Section>
          <Section icon="🏷️" title="Categorisation rules" summary={userRules ? `${userRules} of yours + global rules` : "Global rules"}>
            <RulesEditor onToast={setToast} />
          </Section>
          <Section icon="🕘" title="Plan history" summary={`${plans.length} version${plans.length === 1 ? "" : "s"}`}>
            <div className="space-y-2 text-sm">
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
                      <span className="num text-ink-300">{!s.hasBudget ? "tracking only" : s.mode === "actual" ? "actual payments" : `${formatINR(s.poolPaise)}/mo pool`}</span>
                    </div>
                  );
                })}
            </div>
          </Section>
        </Group>
      )}

      {tab === "data" && (
        <>
          <Group>
            <BankSms onToast={setToast} />
            {smsBridge() && mode === "personal" && config.features.balances && (
              <Toggle
                icon="🏦"
                title="Read account balances"
                hint={'Shows the "Avl bal" from bank SMS on Today. Off also forgets balances already read.'}
                checked={prefs.balances}
                onChange={async (on) => db && (await setPrefs(db, { balances: on }), on && (await syncSms(db)), setToast(on ? "Balances on" : "Balances off and cleared"))}
              />
            )}
            <Section icon="🔌" title="Other sources" summary={mode === "demo" ? "Demo data" : "Manual entry, CSV import"}>
              <Sources />
            </Section>
          </Group>
          <Group>
            <Section icon="💾" title="Backup & export" summary={backupSummary(mode)} defaultOpen={!!filesBridge() && !filesBridge()!.backupFolder()}>
              <DataPanel part="backup" onToast={setToast} />
            </Section>
            <Section icon="🗑️" title="Delete data" summary={`All ${mode} data on this device`}>
              <DataPanel part="danger" onToast={setToast} />
            </Section>
          </Group>
        </>
      )}

      {tab === "app" && (
        <>
          {typeof window !== "undefined" && window.PaisaWidget && (
            <Group>
              <Section icon="💧" title="Home widget" summary="Today’s drip + month calendar · 4 × 2">
                <div className="space-y-3 text-sm text-ink-300">
                  <p>{derived.ledger.hasBudget ? "Your remaining allowance fills the drop. The calendar shows days under or over budget and this month’s budget spending." : "The widget shows everyday spending and neutral calendar days, without allowance or budget targets."}</p>
                  <p className="text-xs text-ink-400">Updates when drip reads your data. Tap the widget to open drip and sync. With app lock on, figures are hidden.</p>
                  {window.PaisaWidget.canPin() ? (
                    <button className="btn-primary" onClick={() => window.PaisaWidget?.requestPin()}>Add to home screen</button>
                  ) : <p>Long-press your home screen → Widgets → drip.</p>}
                </div>
              </Section>
            </Group>
          )}
          <Group>
            {/* The config can hide this switch, but never while the lock is on, so it can't strand you or weaken a lock you set. */}
            {(config.features.appLock || prefs.appLock) && <AppLock prefs={prefs} onToast={setToast} />}
            <Toggle
              icon="📳"
              title="Haptic feedback"
              hint="Light taps on buttons and confirmations. Follows your phone's vibration settings."
              checked={prefs.haptics}
              onChange={async (on) => db && (await setPrefs(db, { haptics: on }))}
            />
            {USAGE_URL && config.features.analytics && <UsageToggle />}
          </Group>
          <Group>
            <Section icon="🔔" title="Notifications" summary="In-app briefings">
              <p className="text-sm text-ink-300">Morning and night briefs are in the Briefing tab for now. Scheduled notifications are on the roadmap.</p>
            </Section>
            <Section icon="🎭" title="Mode" summary={mode === "demo" ? "Demo (fictional data)" : "Personal"}>
              <div className="space-y-3 text-sm">
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
              </div>
            </Section>
          </Group>
        </>
      )}

      <p className="mt-8 text-center text-xs text-ink-400">
        drip · tracking since {formatDay(profile.trackingStart, { year: true })}
        {sms?.lastSyncAt ? ` · SMS read ${new Date(sms.lastSyncAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })}` : ""} · no ads, no external AI
      </p>
      <p className="mt-2 text-center text-xs text-ink-400">
        v{process.env.NEXT_PUBLIC_APP_VERSION} · Soft Orbit Apps · <a className="underline" href="/privacy.html">Privacy policy</a>
      </p>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function backupSummary(mode: string | null) {
  const files = filesBridge();
  if (!files) return "Export or restore a file";
  if (mode !== "personal") return "Personal mode only";
  if (!files.backupFolder()) return "⚠️ Automatic backup is off";
  const last = lastBackupAt();
  return `Daily to ${files.backupFolder()}${last ? ` · ${new Date(last).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })}` : ""}`;
}

/** A rounded group of rows. */
function Group({ children }: { children: ReactNode }) {
  return <div className="settings-group mb-4 divide-y divide-white/5 overflow-hidden rounded-3xl border border-white/5 bg-ink-900">{children}</div>;
}

/** Collapsible row: the summary shows the current state, so most of the time there's no need to open it. */
function Section({ icon, title, summary, defaultOpen, children }: { icon: string; title: string; summary?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="group" open={defaultOpen}>
      <summary className="flex min-h-[60px] cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-lg">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          {summary && <span className="block truncate text-xs text-ink-400">{summary}</span>}
        </span>
        <span className="text-ink-400 transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="settings-body px-4 pb-4">{children}</div>
    </details>
  );
}

/** Anonymous usage counts (data/usage.ts): a device setting, on unless switched off. */
function UsageToggle() {
  const [on, setOn] = useState(usageAllowed);
  return (
    <Toggle
      icon="📈"
      title="Share anonymous usage stats"
      hint="Counts like app opens, time spent and screens visited, with no ID. Never your SMS, transactions, amounts or merchants."
      checked={on}
      onChange={(v) => (setUsageAllowed(v), setOn(v))}
    />
  );
}

function Toggle({ icon, title, hint, checked, disabled, onChange }: { icon: string; title: string; hint?: ReactNode; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={cx("flex min-h-[60px] items-center gap-3 px-4 py-3", disabled ? "opacity-50" : "cursor-pointer")}>
      <span className="text-lg">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        {hint && <span className="block text-xs text-ink-400">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className="relative h-7 w-12 shrink-0 rounded-full bg-ink-700 transition-colors after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-ink-300 after:transition-transform peer-checked:bg-lime peer-checked:after:translate-x-5 peer-checked:after:bg-ink-950 peer-focus-visible:ring-2 peer-focus-visible:ring-lime/60"
      />
    </label>
  );
}

function AppLock({ prefs, onToast }: { prefs: Prefs; onToast: (s: string) => void }) {
  const { db } = useBudget();
  const device = deviceBridge();
  const [on, setOn] = useState(() => device?.appLockEnabled() ?? false);
  useEffect(() => {
    const done = async () => {
      const enabled = device?.appLockEnabled() ?? false;
      setOn(enabled);
      if (db) await setPrefs(db, { appLock: enabled });
      onToast(enabled ? "App lock on" : "App lock off");
    };
    window.addEventListener("paisa-applock", done);
    return () => window.removeEventListener("paisa-applock", done);
  }, [device, db, onToast]);
  if (!device) return <Toggle icon="🔒" title="Fingerprint lock" hint="Android app only." checked={prefs.appLock} disabled onChange={() => {}} />;
  const canLock = device.canLock();
  return (
    <Toggle
      icon="🔒"
      title="Fingerprint lock"
      hint={canLock ? "Unlock with fingerprint or your phone's PIN when opening drip, and after a minute away." : "Set up a fingerprint or screen lock on your phone first."}
      checked={on}
      disabled={!canLock}
      onChange={(next) => device.setAppLock(next)}
    />
  );
}

/** Bank SMS status: always visible on the Data tab. */
function BankSms({ onToast }: { onToast: (s: string) => void }) {
  const { data, db, mode } = useBudget();
  if (!data) return null;
  const bridge = smsBridge();
  const c = data.connections.find((x) => x.providerId === "sms");
  const status = !bridge ? "Android app only" : mode !== "personal" ? "Personal mode only" : !bridge.hasPermission() ? "SMS access needed" : c?.status === "error" ? "Error" : "On";
  return (
    <div className="flex min-h-[60px] items-start gap-3 px-4 py-3" data-testid="provider-sms">
      <span className="text-lg">✉️</span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">Bank SMS</span>
          <Pill tone={status === "On" ? "lime" : status === "Error" ? "coral" : "default"}>{status}</Pill>
        </div>
        <div className="text-xs text-ink-400">
          {listBanks()} alerts, read on this phone only. OTPs, offers and failed payments are ignored.
          {c?.lastSyncAt && ` Last read ${new Date(c.lastSyncAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}.`}
        </div>
        {c?.lastError && <div className="text-xs text-coral">{c.lastError}</div>}
        {bridge && mode === "personal" && (
          <div className="mt-2 flex gap-2">
            {!bridge.hasPermission() ? (
              <button className="btn-ghost min-h-[36px] text-xs" onClick={() => bridge.requestPermission()}>
                Allow SMS access
              </button>
            ) : (
              db && (
                <button className="btn-ghost min-h-[36px] text-xs" onClick={() => syncSms(db).then((n) => onToast(n ? `${n} new from SMS` : "No new bank SMS"))}>
                  Check now
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Sources() {
  const { data, mode } = useBudget();
  if (!data) return null;
  return (
    <div className="space-y-3">
      {PROVIDERS.filter((p) => p.id !== "sms" && (mode === "demo" ? p.id !== "manual" && p.id !== "csv" : p.id !== "demo")).map((p) => {
        const c = data.connections.find((x) => x.providerId === p.id);
        const status = c?.status ?? (p.available ? "disconnected" : "not_available");
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
            </div>
            <Pill tone={status === "connected" ? "lime" : status === "error" ? "coral" : "default"}>{status === "not_available" ? "coming later" : status}</Pill>
          </div>
        );
      })}
      <p className="text-xs text-ink-400">We never ask for bank passwords, PINs or OTPs.</p>
    </div>
  );
}

function BudgetEditor() {
  const { data, derived, today, db } = useBudget();
  const plan = derived?.plan;
  const [editing, setEditing] = useState(false);
  const [income, setIncome] = useState("");
  const [trackOnly, setTrackOnly] = useState(false);
  const [setAside, setSetAside] = useState<string[]>(DEFAULT_SET_ASIDE);
  const config = useRemoteConfig();
  const enabledModes = config.budget.setAsideModes;
  const [requestedSaMode, setSaMode] = useState<SetAsideMode>("planned");
  const saMode = enabledModes.includes(requestedSaMode) ? requestedSaMode : enabledModes[0];
  const [drafts, setDrafts] = useState<CommitmentDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [from, setFrom] = useState(today);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setIncome(plan?.incomePaise ? paiseToRupeeInput(plan.incomePaise) : "");
    setTrackOnly(!hasBudget(plan));
    setSetAside(setAsideOf(plan));
    setSaMode(modeOf(plan));
    setDrafts((plan?.commitments ?? []).map(draftFromCommitment));
    setFrom(today);
    setErr(null);
    setErrors({});
  }, [editing, plan, today]);

  const preview = useMemo(() => {
    const { commitments } = validateDrafts(drafts);
    return poolSummary({ id: "", effectiveFrom: from, budgetMode: trackOnly ? "tracking" : "set-aside", incomePaise: trackOnly || saMode === "actual" ? null : rupeesInputToPaise(income), commitments, setAside, setAsideMode: saMode, createdAt: 0 });
  }, [drafts, income, trackOnly, from, setAside, saMode]);

  if (!data || !derived) return null;
  const pool = derived.pool;

  const save = async () => {
    if (!db) return;
    const planned = !trackOnly && saMode === "planned";
    const inc = planned ? rupeesInputToPaise(income) : null;
    if (planned && !inc) return setErr("Enter your monthly take-home income, or choose actual set-aside or tracking only.");
    const { commitments, errors } = planned ? validateDrafts(drafts) : { commitments: plan?.commitments ?? [], errors: {} };
    setErrors(errors);
    if (Object.keys(errors).length) return;
    if (!from || from < data.profile!.trackingStart) return setErr(`Effective date must be on or after tracking start (${formatDay(data.profile!.trackingStart, { year: true })}).`);
    await addPlanVersion(db, { effectiveFrom: from, budgetMode: trackOnly ? "tracking" : "set-aside", incomePaise: inc, commitments, setAside, setAsideMode: saMode });
    setEditing(false);
  };

  if (!editing) {
    return (
      <Card className="space-y-2 text-sm" data-testid="budget-summary">
        <div className="flex items-center justify-between">
          <span className="text-ink-400">{!pool.hasBudget ? "Just tracking" : pool.mode === "actual" ? "Daily budget · Actual" : "Daily budget · Planned"}</span>
          <button className="btn-ghost min-h-[36px] text-xs" onClick={() => setEditing(true)} data-testid="edit-budget">
            Change
          </button>
        </div>
        {pool.hasBudget ? (
          <>
            {pool.mode === "planned" && <Line label="Take-home" value={formatINR(pool.incomePaise)} />}
            <p className="text-xs text-ink-400">Set aside first: {[...new Set(pool.setAside.map(displayCategory))].join(", ") || "nothing"}</p>
            {pool.mode === "planned" ? (
              <>
                {pool.setAside.includes("Bills") && <Line label="Bills (planned)" value={`− ${formatINR(pool.billsPaise)}`} />}
                {(pool.setAside.includes("Investments") || pool.setAside.includes("Savings")) && <Line label="Investments (planned)" value={`− ${formatINR(pool.investmentsPaise + pool.savingsPaise)}`} />}
                <Line label="Spending pool" value={formatINR(pool.poolPaise)} strong />
              </>
            ) : (
              <p className="text-xs text-ink-400">No amount inputs. Recorded income funds your allowance; tagged set-aside payments reduce it. The remainder is spread across the days left this month.</p>
            )}
            {pool.shortfallPaise > 0 && <p className="text-coral">Planned payments exceed income by {formatINR(pool.shortfallPaise)}, so the daily allowance is ₹0.</p>}
          </>
        ) : (
          <p className="text-ink-400">No daily budget. Spending is tracked and categorised. Tagging and automatic payee rules work in this mode too.</p>
        )}
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <Segmented
        className="w-full"
        value={trackOnly ? "track" : "budget"}
        onChange={(v) => setTrackOnly(v === "track")}
        options={[
          { value: "budget", label: "Daily budget" },
          { value: "track", label: "Track expenses" },
        ]}
      />
      {trackOnly ? (
        <p className="text-xs text-ink-400">No daily budget, just expense tracking. Bills count as expenses; investments are shown separately in Stats.</p>
      ) : (
        <div className="space-y-3" data-testid="set-aside-mode">
          {enabledModes.length > 1 && <span className="label">How should bills and investments come off?</span>}
          {(
            [
              ["planned", "Planned", "Enter your income and expected bills and investments. If a real payment differs, the difference lands in that day's budget."],
              ["actual", "Actual", "Nothing to enter. Income that arrives funds your allowance; bills and investments come off as they're paid. A salary in the last week of a month counts for the next month."],
            ] as const
          ).filter(([v]) => enabledModes.includes(v)).map(([v, label, help]) => (
            <div key={v} className={cx("rounded-2xl border", enabledModes.length > 1 && saMode === v ? "border-lime/50 bg-lime/[0.05]" : "border-white/10")}>
              {enabledModes.length > 1 ? <button onClick={() => setSaMode(v)} className="w-full p-3 text-left text-sm" aria-pressed={saMode === v}>
                <span className="font-semibold">{label}</span>
                <span className="mt-1 block text-xs text-ink-400">{help}</span>
              </button> : <p className="p-3 text-xs text-ink-400">{help}</p>}
              {v === "planned" && saMode === "planned" && (
                <div className="space-y-4 border-t border-white/5 p-3">
                  <Field label="Monthly take-home income">
                    <AmountInput value={income} onChange={setIncome} aria-label="Monthly income" data-testid="settings-income" />
                  </Field>
                  <div>
                    <span className="label">Planned bills and investments</span>
                    <CommitmentList drafts={drafts} onChange={setDrafts} errors={errors} />
                  </div>
                  <p className="text-sm text-ink-300">
                    Spending pool: <Money paise={preview.poolPaise} className="font-semibold" />
                    /month
                    {preview.shortfallPaise > 0 && <span className="text-coral"> · planned payments exceed income by {formatINR(preview.shortfallPaise)}</span>}
                  </p>
                </div>
              )}
            </div>
          ))}
          <div>
            <span className="label">Set aside these categories</span>
            <div className="flex flex-wrap gap-1.5" data-testid="set-aside-categories">
              {SET_ASIDE_OPTIONS.map((c) => (
                <button key={c} className={cx("chip", setAside.includes(c) && "chip-on")} onClick={() => setSetAside((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]))} aria-pressed={setAside.includes(c)}>
                  {categoryEmoji(c)} {displayCategory(c)}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-400">Payments in these categories don't count against your daily budget. Anything not ticked comes out of it.</p>
          </div>
        </div>
      )}
      <Field label="Effective from" hint="Earlier days keep their old setup. A budget started after tracking begins at ₹0.">
        <input type="date" className="input" value={from} min={data.profile!.trackingStart} onChange={(e) => setFrom(e.target.value)} data-testid="settings-effective" />
      </Field>
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

function recurringSummary(rs: Recurring[], holds: FundHold[]) {
  const active = rs.filter((r) => r.status === "active" && !isIpoMandate(r, holds));
  if (!active.length) return "None yet";
  const factor: Partial<Record<Recurring["frequency"], number>> = { daily: 365 / 12, weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, "half-yearly": 1 / 6, yearly: 1 / 12 };
  const confirmed = active.filter((r) => factor[r.frequency]);
  const unknown = active.filter((r) => r.frequency === "unknown").length;
  return `${active.length} active${confirmed.length ? ` · up to ${formatINR(Math.round(confirmed.reduce((sum, r) => sum + r.amountPaise * factor[r.frequency]!, 0)), { decimals: "never" })}/month` : ""}${unknown ? ` · ${unknown} unconfirmed` : ""}`;
}

function RecurringList() {
  const { data, db } = useBudget();
  if (!data || !db) return null;
  const rs = [...data.recurring].filter((r) => r.source === "mandate").sort((a, b) => (a.status === b.status ? a.dueDay - b.dueDay : a.status === "active" ? -1 : 1));
  return (
    <Card className="space-y-2 text-sm" data-testid="recurring-list">
      {rs.length === 0 ? (
        <p className="text-ink-400">Autopays and e-mandates show up here automatically from your bank SMS (created, changed or cancelled).</p>
      ) : (
        rs.map((r) => (
          <div key={r.id} className={cx("flex items-center justify-between gap-2", r.status === "revoked" && "opacity-50")}>
            <span className="min-w-0">
              <span className="block truncate">
                {tagEmoji(r.tag, r.category)} {r.name}
              </span>
              <span className="text-xs text-ink-400">
                {r.category}
                {r.tag ? ` · ${r.tag}` : ""} · {r.frequency} · day {r.dueDay} · {r.source === "mandate" ? "autopay SMS" : "marked by you"}
                {r.status === "revoked" ? " · cancelled" : ""}
                {r.frequency === "unknown" && " · no reminder until frequency is confirmed"}
                {r.frequency === "once" && " · not a repeating payment"}
                {isIpoMandate(r, data.holds) ? <span className="mt-1 block text-amber">IPO authorization · excluded from recurring totals and reminders. Only confirmed bank events establish blocked, invested or released funds.</span> : <><select className="input mt-2 text-xs" aria-label={`Frequency for ${r.name}`} value={r.frequency} onChange={(e) => db.recurring.update(r.id, { frequency: e.target.value as Recurring["frequency"], userEdited: true, updatedAt: Date.now() })}>
                  {["unknown", "once", "daily", "weekly", "monthly", "quarterly", "half-yearly", "yearly"].map((f) => <option key={f} value={f}>{f === "unknown" ? "Frequency not confirmed" : f}</option>)}
                </select>
                <label className="mt-1 block">Due day <input className="input w-20 text-xs" type="number" min={1} max={31} aria-label={`Due day for ${r.name}`} value={r.dueDay} onChange={(e) => { const day = Number(e.target.value); if (Number.isInteger(day) && day >= 1 && day <= 31) db.recurring.update(r.id, { dueDay: day, userEdited: true, updatedAt: Date.now() }); }} /></label></>}
                <button className="mt-2 block text-xs text-ink-300 underline" onClick={() => db.recurring.update(r.id, { purpose: isIpoMandate(r, data.holds) ? "payment" : "ipo", userEdited: true, updatedAt: Date.now() })}>{isIpoMandate(r, data.holds) ? "Mark as recurring payment" : "Mark as IPO"}</button>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <Money paise={r.amountPaise} decimals="never" className="num" />
              <button className="text-xs text-coral" onClick={() => db.recurring.update(r.id, { status: "revoked", userEdited: true, updatedAt: Date.now() })} aria-label={`Remove ${r.name}`}>
                Remove
              </button>
            </span>
          </div>
        ))
      )}
    </Card>
  );
}

function TrackingEditor({ profile: p, onSaved }: { profile: Profile; onSaved: (smsAdded: number) => void }) {
  const { data, derived, today, db } = useBudget();
  const showOpening = !!derived?.ledger.hasBudget && derived.ledger.mode === "planned";
  const [start, setStart] = useState(p.trackingStart);
  const [opening, setOpening] = useState(paiseToRupeeInput(p.openingAdjustmentPaise));
  const [err, setErr] = useState<string | null>(null);
  if (!db) return null;
  const dirty = start !== p.trackingStart || (showOpening && parseAmountToPaise(opening || "0") !== p.openingAdjustmentPaise);
  const save = async () => {
    const adj = showOpening ? parseAmountToPaise(opening || "0") : p.openingAdjustmentPaise;
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
        <Field label="Tracking start" hint={`Summaries start from this date.${smsBridge() ? " Moving it earlier reads your bank SMS from then." : ""}`}>
          <input type="date" className="input" value={start} max={today} onChange={(e) => setStart(e.target.value)} />
        </Field>
        {showOpening && <Field label="Opening adjustment (₹)" hint="One-time, default 0. Negative = start in deficit.">
          <input className="input num" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value.replace(/[^\d.,\-]/g, ""))} />
        </Field>}
      </div>
      {err && <p className="text-sm text-coral">{err}</p>}
      {dirty && (
        <button className="btn-primary w-full" onClick={save}>
          Save tracking settings
        </button>
      )}
    </Card>
  );
}

/** "HDFC, ICICI and SBI" from the bank senders in use. */
function listBanks() {
  const b = supportedBanks();
  return b.length > 1 ? `${b.slice(0, -1).join(", ")} and ${b[b.length - 1]}` : b[0] ?? "Bank";
}

function RulesEditor({ onToast }: { onToast: (s: string) => void }) {
  const { data, db } = useBudget();
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("Bills");
  const [tag, setTag] = useState("");
  const [showBuiltIn, setShowBuiltIn] = useState(false);
  const [editing, setEditing] = useState<{ id: string; category: string; tag: string } | null>(null);
  if (!data || !db) return null;
  const user = data.rules.filter((r) => !r.builtIn).sort((a, b) => a.pattern.localeCompare(b.pattern));
  const builtIn = data.rules.filter((r) => r.builtIn);
  const sameRule = (a: CategoryRule, b: CategoryRule) => !a.payee && !b.payee && a.pattern.trim().toLowerCase() === b.pattern.trim().toLowerCase() && (a.direction ?? "") === (b.direction ?? "");
  const mine = (g: CategoryRule) => user.find((u) => sameRule(u, g));
  const saveOverride = async (g: CategoryRule) => {
    if (!editing) return;
    const own = mine(g);
    const kind: TxnKind | undefined = editing.category === "Settlement" ? "settlement" : editing.category === "Transfers" ? "transfer" : editing.category === "Income" ? "income" : editing.category === g.category ? g.kind : undefined;
    await saveRule(db, { id: own?.id, pattern: g.pattern, direction: g.direction, category: editing.category, tag: editing.tag || undefined, kind, priority: 10 });
    setEditing(null);
    onToast("Saved as your rule; it stays when global rules change");
  };
  const isPayee = /^[\w.\-]+@[a-z]+$/i.test(pattern.trim());

  const add = async () => {
    const p = pattern.trim().toLowerCase();
    if (!p) return;
    const kind: TxnKind | undefined = category === "Settlement" ? "settlement" : category === "Transfers" ? "transfer" : category === "Income" ? "income" : undefined;
    await saveRule(db, { pattern: p, payee: isPayee ? p : undefined, category, tag: tag || undefined, kind, priority: 10 });
    setPattern("");
    setTag("");
    onToast("Rule added");
  };

  return (
    <Card className="space-y-3">
      <p className="text-xs text-ink-400">
        Enter a UPI ID (ramesh@okaxis) to match that payee exactly, or any text in the merchant name or bank SMS. Your rules beat global rules. Pick “Transfers” for your own accounts.
      </p>
      <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
        <input className="input text-sm" placeholder="ramesh@okaxis or chai point" value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="Rule text or UPI ID" />
        <select className="input text-sm" value={category} onChange={(e) => (setCategory(e.target.value), setTag(""))} aria-label="Rule category">
          {CATEGORIES.filter((c) => c !== "Refunds").map((c) => (
            <option key={c} value={c}>{displayCategory(c)}</option>
          ))}
        </select>
        <select className="input text-sm" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Rule tag" disabled={!TAGS[category]}>
          <option value="">No tag</option>
          {(TAGS[category] ?? []).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <button className="btn-primary" onClick={add}>
          Add
        </button>
      </div>
      {pattern.trim() && <p className="text-xs text-ink-400">{isPayee ? "Matches payments to this UPI ID." : "Matches any transaction containing this text."}</p>}
      {user.length > 0 && (
        <div className="divide-y divide-white/5">
          {user.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 truncate">
                {r.payee ? <span className="num">{r.payee}</span> : <>“{r.pattern}”</>} → <b>{r.category}</b>
                {r.tag ? ` · ${r.tag}` : ""}
              </span>
              <button className="shrink-0 text-xs text-coral" onClick={() => db.rules.delete(r.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost text-xs" onClick={async () => onToast(`Re-categorised ${await recategorizeAll(db)} transaction(s)`)}>
          Re-apply rules to the last 12 months
        </button>
        <button className="btn-ghost text-xs" onClick={() => setShowBuiltIn((s) => !s)}>
          {showBuiltIn ? "Hide" : "Show"} {builtIn.length} global rules
        </button>
      </div>
      {showBuiltIn && (
        <>
          <p className="text-xs text-ink-400">Global rules come from drip and update on their own. Tap one to set your own category; yours wins and is never changed by updates. Remove yours to go back.</p>
          <div className="flex flex-wrap gap-1" data-testid="global-rules">
            {builtIn.map((r) => {
              const own = mine(r);
              return (
                <button
                  key={r.id}
                  onClick={() => setEditing(editing?.id === r.id ? null : { id: r.id, category: own?.category ?? r.category, tag: own?.tag ?? r.tag ?? "" })}
                  className={cx("rounded-lg px-2 py-1 text-left text-[11px]", own ? "border border-lime/40 bg-lime/[0.06] text-ink-200" : "bg-white/[0.04] text-ink-300", editing?.id === r.id && "ring-1 ring-lime/60")}
                >
                  {r.pattern}
                  {r.direction ? ` (money ${r.direction})` : ""} → {own ? <s className="opacity-60">{r.category}</s> : r.category}
                  {!own && r.tag ? ` · ${r.tag}` : ""}
                  {own ? ` → yours: ${own.category}${own.tag ? ` · ${own.tag}` : ""}` : ""}
                </button>
              );
            })}
          </div>
          {editing && (() => {
            const g = builtIn.find((r) => r.id === editing.id);
            if (!g) return null;
            return (
              <div className="grid gap-2 rounded-xl bg-white/[0.04] p-3 sm:grid-cols-[1fr_1fr_auto_auto]" data-testid="global-rule-editor">
                <p className="text-xs text-ink-300 sm:col-span-4">“{g.pattern}” → your category</p>
                <select className="input text-sm" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value, tag: "" })} aria-label="Your category for this rule">
                  {[...new Set([...CATEGORIES.filter((c) => c !== "Refunds"), ...(typeof editing !== "undefined" && editing?.category === "Savings" ? ["Savings"] : [])])].map((c) => (
                    <option key={c} value={c}>{displayCategory(c)}</option>
                  ))}
                </select>
                <select className="input text-sm" value={editing.tag} onChange={(e) => setEditing({ ...editing, tag: e.target.value })} aria-label="Your tag for this rule" disabled={!TAGS[editing.category]}>
                  <option value="">No tag</option>
                  {(TAGS[editing.category] ?? []).map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <button className="btn-primary" onClick={() => saveOverride(g)}>
                  Save as mine
                </button>
                <button className="btn-ghost" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            );
          })()}
        </>
      )}
    </Card>
  );
}

function DataPanel({ part, onToast }: { part: "backup" | "danger"; onToast: (s: string) => void }) {
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
      {part === "backup" && (
        <>
          {filesBridge() ? (
            <AutoBackup onToast={onToast} />
          ) : (
            <div className="rounded-2xl bg-amber/[0.07] p-3 text-amber">
              🔒 Everything lives in this browser's storage (IndexedDB) — your data is never uploaded and there's no AI upload. <b>That also means it's not a backup:</b> clearing site data, private windows or a new
              device will lose it. Export regularly.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-ghost"
              onClick={async () => download(`drip-${mode}-${stamp}.json`, JSON.stringify(await exportAll(db, mode), null, 2), "application/json")}
              data-testid="export-json"
            >
              Export backup (JSON)
            </button>
            <button className="btn-ghost" onClick={() => download(`drip-${mode}-transactions-${stamp}.csv`, txnsToCsv(data.txns), "text/csv")}>
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
        </>
      )}

      {part === "danger" && (
        <div>
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
      )}
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
          <div className="text-xs text-ink-400">
            {last ? `Last backup ${new Date(last).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}` : "No backup yet"}
          </div>
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
            ⚠️ <b>Turn on automatic backup.</b> App updates keep your data, but uninstalling or clearing app data deletes it. Pick a folder once (e.g. a new “drip” folder in Documents, or Google
            Drive) and a copy is saved there every day.
          </div>
          <button className="btn-primary text-sm" onClick={() => files.chooseBackupFolder()}>
            Choose backup folder
          </button>
        </>
      )}
    </div>
  );
}
