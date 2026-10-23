"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { haptic } from "@/data/device";
import { useRemoteConfig } from "@/data/remoteConfigLoader";
import type { ScreenId } from "@/lib/remoteConfig";
import { formatINR, type FormatOptions } from "@/lib/money";

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

export function Money({ paise, className, ...opts }: { paise: number; className?: string } & FormatOptions) {
  return <span className={cx("num", className)}>{formatINR(paise, opts)}</span>;
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("card", className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-400">{children}</h2>
      {action}
    </div>
  );
}

/** `screen` lets the remote config replace the title / subtitle without an app release. */
export function PageHeader({ title, subtitle, right, screen }: { title: string; subtitle?: ReactNode; right?: ReactNode; screen?: ScreenId }) {
  const text = useRemoteConfig().screens[screen ?? ("" as ScreenId)];
  title = text?.title ?? title;
  subtitle = text?.subtitle ?? subtitle;
  return (
    <header className="mb-4 flex items-end justify-between gap-3 pt-2">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-400">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function EmptyState({ emoji, title, body, action }: { emoji: string; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-white/10 px-6 py-10 text-center">
      <div className="mb-3 text-4xl">{emoji}</div>
      <p className="font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-xs text-sm text-ink-400">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Bottom sheet on phones, centred dialog on desktop. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-labelledby={id}>
      <button aria-label="Close" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} tabIndex={-1} />
      <div
        ref={ref}
        className="animate-slideup relative flex max-h-[92dvh] w-full flex-col rounded-t-[28px] border border-white/10 bg-ink-900 md:max-w-lg md:rounded-[28px]"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 id={id} className="text-lg font-bold">
            {title}
          </h2>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-white/5 text-ink-300 hover:bg-white/10" aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-white/5 px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={cx("inline-flex rounded-2xl bg-white/[0.05] p-1", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("min-h-[36px] flex-1 rounded-xl px-3 text-[13px] font-semibold transition", value === o.value ? "bg-lime text-ink-950" : "text-ink-300 hover:text-white")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: ReactNode; error?: string | null }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-coral">{error}</span> : hint ? <span className="mt-1 block text-xs text-ink-400">{hint}</span> : null}
    </label>
  );
}

/** Rupee amount input; value is the raw string the user typed. */
export function AmountInput({ value, onChange, placeholder = "0", autoFocus, big, ...rest }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; big?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <div className="relative">
      <span className={cx("pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400", big ? "text-2xl" : "text-[15px]")}>₹</span>
      <input
        {...rest}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        className={cx("input num pl-8", big && "min-h-[64px] text-3xl font-bold")}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
      />
    </div>
  );
}

export function Pill({ children, tone = "default", className }: { children: ReactNode; tone?: "default" | "lime" | "coral" | "amber" | "violet" | "sky"; className?: string }) {
  const tones = {
    default: "bg-white/[0.06] text-ink-300",
    lime: "bg-lime/15 text-lime",
    coral: "bg-coral/15 text-coral",
    amber: "bg-amber/15 text-amber",
    violet: "bg-violet/15 text-violet",
    sky: "bg-sky/15 text-sky",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", tones[tone], className)}>{children}</span>;
}

export function ProgressBar({ value, tone = "lime" }: { value: number; tone?: "lime" | "coral" | "amber" | "violet" }) {
  const colors = { lime: "bg-lime", coral: "bg-coral", amber: "bg-amber", violet: "bg-violet" };
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div className={cx("h-full rounded-full transition-all", colors[tone])} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Toast({ message, onDone, action }: { message: string | null; onDone: () => void; action?: { label: string; onClick: () => void } }) {
  useEffect(() => {
    if (!message) return;
    haptic("success");
    const t = window.setTimeout(onDone, 4000);
    return () => window.clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div className="animate-pop fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-sm items-center justify-between gap-3 rounded-2xl border border-white/10 bg-ink-800 px-4 py-3 text-sm shadow-2xl md:bottom-8" role="status">
      <span>{message}</span>
      {action && (
        <button className="font-semibold text-lime" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/** A small ⓘ that shows a short explanation on tap (or hover on desktop). */
export function InfoTip({ children, label = "About this" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        className={cx("grid h-7 w-7 place-items-center rounded-full text-ink-400 transition hover:bg-white/[0.06] hover:text-white", open && "bg-white/[0.06] text-white")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      </button>
      {open && (
        <span id={id} role="tooltip" className="animate-pop absolute right-0 top-full z-30 mt-1 w-64 rounded-2xl border border-white/10 bg-ink-800 p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ink-300 shadow-2xl">
          {children}
        </span>
      )}
    </span>
  );
}
