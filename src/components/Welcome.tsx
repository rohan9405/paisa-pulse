"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/data/store";

export function Welcome() {
  const { setMode } = useStore();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const go = async (m: "demo" | "personal") => {
    setBusy(m);
    await setMode(m);
    router.replace("/");
  };

  return (
    <div className="relative mx-auto flex min-h-dvh max-w-md flex-col justify-between px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(40px,env(safe-area-inset-top))]">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-lime/20 blur-[90px]" />
      <div className="relative">
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-ink-300">
          <span className="h-1.5 w-1.5 rounded-full bg-lime" /> 100% on-device · no sign-up
        </div>
        <h1 className="text-[44px] font-bold leading-[1.02] tracking-tight">
          How much can I <span className="text-lime">spend today?</span>
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-300">
          A daily budget that refills every midnight (IST). Underspend and it rolls over. Overspend and tomorrow knows. Bills, savings and SIPs are set aside first.
        </p>
        <ul className="mt-6 space-y-2 text-sm text-ink-300">
          <li>☀️ Morning briefing + 🌙 evening report</li>
          <li>📥 Import any bank CSV, with duplicate checks</li>
          <li>🔒 Nothing leaves this browser. No analytics.</li>
        </ul>
      </div>
      <div className="relative mt-10 space-y-3">
        <button className="btn-primary h-14 w-full text-base" onClick={() => go("personal")} disabled={!!busy} data-testid="start-personal">
          {busy === "personal" ? "Setting up…" : "Set up my budget"}
        </button>
        <button className="btn-ghost h-14 w-full text-base" onClick={() => go("demo")} disabled={!!busy} data-testid="start-demo">
          {busy === "demo" ? "Loading demo…" : "Explore the demo 🎭"}
        </button>
        <p className="text-center text-xs text-ink-400">Demo uses fictional transactions and is stored separately from your personal data.</p>
      </div>
    </div>
  );
}
