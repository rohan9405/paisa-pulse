"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { dailyAllocation, poolSummary } from "@/lib/budget";
import { addDays, formatDay, startOfMonth } from "@/lib/dates";
import { formatINR, parseAmountToPaise, rupeesInputToPaise } from "@/lib/money";
import { completeOnboarding } from "@/data/repo";
import type { SetAsideMode } from "@/lib/types";
import { useStore } from "@/data/store";
import { smsBridge } from "@/data/providers/sms";
import { CommitmentList, type CommitmentDraft, validateDrafts } from "@/components/CommitmentEditor";
import { AmountInput, Field, Money, cx } from "@/components/ui";

const STEPS = ["Income", "Bills & savings", "Start"] as const;

export function Onboarding() {
  const { db, today, setMode } = useStore();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [trackOnly, setTrackOnly] = useState(false);
  const [income, setIncome] = useState("");
  const [drafts, setDrafts] = useState<CommitmentDraft[]>([]);
  const [saMode, setSaMode] = useState<SetAsideMode>("planned");
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [start, setStart] = useState(today);
  const [opening, setOpening] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const planned = !trackOnly && saMode === "planned";
  const steps = planned ? STEPS : ["Mode", "Start"];
  const incomePaise = planned ? rupeesInputToPaise(income) : null;
  const preview = useMemo(() => {
    const { commitments } = validateDrafts(drafts);
    const s = poolSummary({ id: "", effectiveFrom: start, incomePaise, commitments, setAsideMode: saMode, createdAt: 0 });
    return { ...s, daily: dailyAllocation(s.allocatablePaise, start) };
  }, [drafts, incomePaise, start, saMode]);

  const next = () => {
    setErr(null);
    if (step === 0 && planned && !incomePaise) return setErr("Enter your monthly take-home pay, or choose actual set-aside or tracking only.");
    if (step === 1) {
      const { errors } = validateDrafts(drafts);
      setDraftErrors(errors);
      if (Object.keys(errors).length) return;
    }
    setStep((s) => s === 0 && !planned ? 2 : s + 1);
  };

  const finish = async () => {
    if (!db) return;
    setErr(null);
    const openingPaise = planned && opening.trim() ? parseAmountToPaise(opening.replace(/^\+/, "")) : 0;
    if (openingPaise === null) return setErr("Opening adjustment isn't a valid amount");
    if (!start || start > today) return setErr("Tracking can start today or earlier");
    const { commitments } = validateDrafts(drafts);
    setSaving(true);
    await completeOnboarding(db, {
      name,
      budgetMode: trackOnly ? "tracking" : "set-aside",
      incomePaise,
      commitments: planned ? commitments : [],
      setAsideMode: saMode,
      trackingStart: start,
      openingAdjustmentPaise: openingPaise,
      alreadyPaidIds: (planned ? drafts : []).filter((d) => d.alreadyPaid).map((d) => d.id),
      paidMonth: today.slice(0, 7),
    });
    router.replace("/");
  };

  return (
    <div className="pt-[max(24px,env(safe-area-inset-top))]">
      <div className="mb-6 flex items-center justify-between">
        <button className="text-sm text-ink-400" onClick={() => (step ? setStep(step === 2 && !planned ? 0 : step - 1) : setMode(null))}>
          ← {step ? "Back" : "Exit"}
        </button>
        <span className="text-xs font-semibold uppercase tracking-widest text-ink-400">
          Step {step === 2 && !planned ? 2 : step + 1} / {steps.length}
        </span>
      </div>
      <div className="mb-6 flex gap-1.5">
        {steps.map((s, i) => (
          <div key={s} className={cx("h-1.5 flex-1 rounded-full", i <= step ? "bg-lime" : "bg-white/10")} />
        ))}
      </div>

      {step === 0 && (
        <section className="space-y-5">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">How would you like to track your money?</h1>
            <p className="mt-2 text-sm text-ink-400">Tagging and automatic categorisation work in every mode. Your data stays on this device.</p>
          </div>
          <Field label="Your name (optional)">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya" maxLength={40} />
          </Field>
          <div className="grid grid-cols-2 gap-2" data-testid="ob-budget-mode">
            {(
              [
                [false, "💧 Daily budget", "Know what you can spend each day."],
                [true, "👀 Just track", "See where money goes, no daily limit."],
              ] as const
            ).map(([track, label, help]) => (
              <button key={label} onClick={() => setTrackOnly(track)} className={cx("rounded-2xl border p-3 text-left text-sm", trackOnly === track ? "border-lime/50 bg-lime/[0.07]" : "border-white/10")} aria-pressed={trackOnly === track} data-testid={track ? "ob-track" : "ob-budget"}>
                <span className="font-semibold">{label}</span>
                <span className="mt-1 block text-xs text-ink-400">{help}</span>
              </button>
            ))}
          </div>
          {!trackOnly && (
            <div className="space-y-3 rounded-3xl border border-white/10 p-3" data-testid="ob-mode">
              <span className="label px-1">How should bills and investments come off?</span>
              {(
                [
                  ["planned", "Plan the amounts", "Enter your income and what you expect to pay. If a bill comes in higher or lower, that day's budget adjusts."],
                  ["actual", "Use actual payments", "Nothing to enter. Income that arrives funds your allowance; bills, investments and savings reduce it as they're paid."],
                ] as const
              ).map(([v, label, help]) => (
                <div key={v} className={cx("rounded-2xl border", saMode === v ? "border-lime/50 bg-lime/[0.07]" : "border-white/10")}>
                  <button onClick={() => setSaMode(v)} className="w-full p-3 text-left text-sm" aria-pressed={saMode === v}>
                    <span className="font-semibold">{label}</span>
                    <span className="mt-1 block text-xs text-ink-400">{help}</span>
                  </button>
                  {v === "planned" && saMode === "planned" && (
                    <div className="px-3 pb-3">
                      <Field label="Monthly take-home income">
                        <AmountInput big value={income} onChange={setIncome} placeholder="75,000" data-testid="ob-income" aria-label="Monthly take-home income" />
                      </Field>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {step === 1 && (
        <section className="space-y-5">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{trackOnly ? "Regular payments" : "Bills and investments come off the top"}</h1>
            <p className="mt-2 text-sm text-ink-400">
              {trackOnly
                ? "Optional: add rent, bills or SIPs to get reminders before they're due."
                : "Bills (rent, electricity, EMIs), investments (SIPs) and savings are set aside before your daily budget. You can change which in Settings."}
            </p>
          </div>
          {!trackOnly && saMode === "planned" && <p className="text-xs text-ink-400">Include payments you've already made this month and tick “Paid this month” so they don't show as upcoming.</p>}
          <CommitmentList drafts={drafts} onChange={setDrafts} errors={draftErrors} showPaid />
          {drafts.length === 0 && <p className="text-sm text-ink-400">{saMode === "actual" || trackOnly ? "Optional. Add them to get reminders, or skip ahead." : "No regular payments? That's fine, skip ahead."}</p>}
        </section>
      )}

      {step === 2 && (
        <section className="space-y-5">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">When do we start counting?</h1>
            <p className="mt-2 text-sm text-ink-400">{trackOnly ? "Transactions from this date appear in your spending summaries." : saMode === "actual" ? "Your allowance is calculated from income and tagged payments recorded from this date. No estimated income is added." : "Your daily allowance starts accruing on this date. Earlier days aren't credited and earlier spending isn't guessed."}</p>
          </div>
          <Field label="Tracking start date" hint={`Starts ${formatDay(start, { weekday: true, year: true })}${smsBridge() ? ". Bank SMS from this date onwards are read in automatically." : ""}`}>
            <input type="date" className="input" value={start} max={today} min={addDays(startOfMonth(today), -62)} onChange={(e) => setStart(e.target.value)} data-testid="ob-start" />
          </Field>
          {planned && (
            <Field label="Opening adjustment (optional)" hint="Default ₹0. Add cash you want to start with, or a negative amount if you've already overspent this month.">
              <input className="input num" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value.replace(/[^\d.,\-+]/g, ""))} placeholder="0" aria-label="Opening adjustment" />
            </Field>
          )}

          {!trackOnly && saMode === "actual" && <p className="text-sm text-ink-400">Nothing to enter. Income, bills, investments and savings come from tagged transactions. Until income is recorded, the allowance is zero. You can correct tags in Activity.</p>}
          {!trackOnly && saMode === "planned" && (
            <div className="card space-y-2 text-sm" data-testid="ob-summary">
              <Row label="Take-home" value={formatINR(preview.incomePaise)} />
              <Row label="Bills" value={`− ${formatINR(preview.billsPaise)}`} />
              <Row label="Investments" value={`− ${formatINR(preview.investmentsPaise)}`} />
              <Row label="Savings" value={`− ${formatINR(preview.savingsPaise)}`} />
              <div className="my-1 border-t border-white/5" />
              <Row label="Monthly spending pool" value={formatINR(preview.poolPaise)} strong />
              <Row label="Daily allowance this month" value={formatINR(preview.daily)} strong lime />
              {preview.shortfallPaise > 0 && (
                <p className="rounded-xl bg-coral/10 p-3 text-coral">
                  Planned payments exceed income by <Money paise={preview.shortfallPaise} />. Your daily allowance will be ₹0 — any spending becomes a deficit. Consider trimming a bill or savings target.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {err && <p className="mt-4 text-sm text-coral" role="alert">{err}</p>}

      <div className="mt-8">
        {step < 2 ? (
          <button className="btn-primary h-14 w-full text-base" onClick={next} data-testid="ob-next">
            Continue
          </button>
        ) : (
          <button className="btn-primary h-14 w-full text-base" onClick={finish} disabled={saving} data-testid="ob-finish">
            {saving ? "Setting up…" : "Let's go 🚀"}
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, strong, lime }: { label: string; value: string; strong?: boolean; lime?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={cx(strong ? "font-semibold" : "text-ink-400")}>{label}</span>
      <span className={cx("num", strong && "font-bold", lime && "text-lime")}>{value}</span>
    </div>
  );
}
