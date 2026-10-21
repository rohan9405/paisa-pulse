"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { dailyAllocation, poolSummary } from "@/lib/budget";
import { addDays, formatDay, startOfMonth } from "@/lib/dates";
import { formatINR, parseAmountToPaise, rupeesInputToPaise } from "@/lib/money";
import { completeOnboarding } from "@/data/repo";
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
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [start, setStart] = useState(today);
  const [opening, setOpening] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const incomePaise = trackOnly ? null : rupeesInputToPaise(income);
  const preview = useMemo(() => {
    const { commitments } = validateDrafts(drafts);
    const s = poolSummary({ id: "", effectiveFrom: start, incomePaise, commitments, createdAt: 0 });
    return { ...s, daily: dailyAllocation(s.allocatablePaise, start) };
  }, [drafts, incomePaise, start]);

  const next = () => {
    setErr(null);
    if (step === 0 && !trackOnly && !incomePaise) return setErr("Enter your monthly take-home pay, or choose “Just track spending”.");
    if (step === 1) {
      const { errors } = validateDrafts(drafts);
      setDraftErrors(errors);
      if (Object.keys(errors).length) return;
    }
    setStep((s) => s + 1);
  };

  const finish = async () => {
    if (!db) return;
    setErr(null);
    const openingPaise = opening.trim() ? parseAmountToPaise(opening.replace(/^\+/, "")) : 0;
    if (openingPaise === null) return setErr("Opening adjustment isn't a valid amount");
    if (!start || start > today) return setErr("Tracking can start today or earlier");
    const { commitments } = validateDrafts(drafts);
    setSaving(true);
    await completeOnboarding(db, {
      name,
      incomePaise,
      commitments,
      trackingStart: start,
      openingAdjustmentPaise: openingPaise,
      alreadyPaidIds: drafts.filter((d) => d.alreadyPaid).map((d) => d.id),
      paidMonth: today.slice(0, 7),
    });
    router.replace("/");
  };

  return (
    <div className="pt-[max(24px,env(safe-area-inset-top))]">
      <div className="mb-6 flex items-center justify-between">
        <button className="text-sm text-ink-400" onClick={() => (step ? setStep(step - 1) : setMode(null))}>
          ← {step ? "Back" : "Exit"}
        </button>
        <span className="text-xs font-semibold uppercase tracking-widest text-ink-400">
          Step {step + 1} / {STEPS.length}
        </span>
      </div>
      <div className="mb-6 flex gap-1.5">
        {STEPS.map((s, i) => (
          <div key={s} className={cx("h-1.5 flex-1 rounded-full", i <= step ? "bg-lime" : "bg-white/10")} />
        ))}
      </div>

      {step === 0 && (
        <section className="space-y-5">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">What lands in your account each month?</h1>
            <p className="mt-2 text-sm text-ink-400">Take-home pay after tax and deductions. Stored only in this browser.</p>
          </div>
          <Field label="Your name (optional)">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya" maxLength={40} />
          </Field>
          {!trackOnly && (
            <Field label="Monthly take-home income">
              <AmountInput big value={income} onChange={setIncome} placeholder="75,000" data-testid="ob-income" aria-label="Monthly take-home income" />
            </Field>
          )}
          <label className="flex items-start gap-3 rounded-2xl bg-white/[0.04] p-4 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-lime" checked={trackOnly} onChange={(e) => setTrackOnly(e.target.checked)} />
            <span>
              <span className="font-semibold">Just track spending</span>
              <span className="block text-ink-400">Skip the budget. You'll see where money goes, without a daily limit. You can add a budget later.</span>
            </span>
          </label>
        </section>
      )}

      {step === 1 && (
        <section className="space-y-5">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Bills & savings, set aside first</h1>
            <p className="mt-2 text-sm text-ink-400">
              Fixed bills and savings/SIP targets come off the top. Include ones you've <b>already paid this month</b> — tick them so they don't show as upcoming.
            </p>
          </div>
          <CommitmentList drafts={drafts} onChange={setDrafts} errors={draftErrors} showPaid />
          {drafts.length === 0 && <p className="text-sm text-ink-400">No fixed commitments? That's fine — skip ahead.</p>}
        </section>
      )}

      {step === 2 && (
        <section className="space-y-5">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">When do we start counting?</h1>
            <p className="mt-2 text-sm text-ink-400">Your daily allowance starts accruing on this date. Earlier days aren't credited and earlier spending isn't guessed.</p>
          </div>
          <Field label="Tracking start date" hint={`Starts ${formatDay(start, { weekday: true, year: true })}${smsBridge() ? ". Bank SMS from this date onwards are read in automatically." : ""}`}>
            <input type="date" className="input" value={start} max={today} min={addDays(startOfMonth(today), -62)} onChange={(e) => setStart(e.target.value)} data-testid="ob-start" />
          </Field>
          {!trackOnly && (
            <Field label="Opening adjustment (optional)" hint="Default ₹0. Add cash you want to start with, or a negative amount if you've already overspent this month.">
              <input className="input num" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value.replace(/[^\d.,\-+]/g, ""))} placeholder="0" aria-label="Opening adjustment" />
            </Field>
          )}

          {!trackOnly && (
            <div className="card space-y-2 text-sm" data-testid="ob-summary">
              <Row label="Take-home" value={formatINR(preview.incomePaise)} />
              <Row label="Fixed bills" value={`− ${formatINR(preview.billsPaise)}`} />
              <Row label="Savings & SIPs" value={`− ${formatINR(preview.savingsPaise)}`} />
              <div className="my-1 border-t border-white/5" />
              <Row label="Monthly spending pool" value={formatINR(preview.poolPaise)} strong />
              <Row label="Daily allowance this month" value={formatINR(preview.daily)} strong lime />
              {preview.shortfallPaise > 0 && (
                <p className="rounded-xl bg-coral/10 p-3 text-coral">
                  Commitments exceed income by <Money paise={preview.shortfallPaise} />. Your daily allowance will be ₹0 — any spending becomes a deficit. Consider trimming a bill or savings target.
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
