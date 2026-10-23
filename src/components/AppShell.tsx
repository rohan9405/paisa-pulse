"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ComponentType, createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { useAppData, useStore } from "@/data/store";
import { useSmsSync } from "@/data/useSmsSync";
import { useAutoBackup } from "@/data/useAutoBackup";
import { useHomeWidget } from "@/data/useHomeWidget";
import { haptic, setHapticsEnabled } from "@/data/device";
import { DEFAULT_PREFS } from "@/lib/types";
import type { TabId } from "@/lib/remoteConfig";
import { loadCachedConfig, refreshConfig, useRemoteConfig } from "@/data/remoteConfigLoader";
import { ensureRules } from "@/data/repo";
import { QuickAddSheet } from "./QuickAdd";
import { Onboarding } from "./Onboarding";
import { Welcome } from "./Welcome";
import { IconBriefing, IconChart, IconList, IconPlus, IconSettings, IconToday, IconUpload } from "./icons";
import { cx } from "./ui";

const QuickAddCtx = createContext<{ open: (preset?: { date?: string }) => void }>({ open: () => {} });
export const useQuickAdd = () => useContext(QuickAddCtx);

/** Where each tab goes; order, labels and visibility come from the remote config. */
const TAB_ROUTES: Record<TabId, { href: string; icon: ComponentType }> = {
  today: { href: "/", icon: IconToday },
  briefing: { href: "/briefing", icon: IconBriefing },
  activity: { href: "/transactions", icon: IconList },
  stats: { href: "/dashboard", icon: IconChart },
};
const NAV_EXTRA_ALL = [
  { href: "/import", label: "Import CSV", icon: IconUpload },
  { href: "/settings", label: "Settings", icon: IconSettings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (path === "/widget-sync" || path === "/widget-sync/") return <>{children}</>;
  return <InteractiveShell>{children}</InteractiveShell>;
}

function InteractiveShell({ children }: { children: ReactNode }) {
  const { ready, mode, setMode, db, today } = useStore();
  const data = useAppData();
  useSmsSync(mode === "personal" && data?.profile ? db : null);
  useAutoBackup(data?.profile ? db : null, mode);
  useHomeWidget(data, mode, today);
  const config = useRemoteConfig();
  const NAV = config.tabs.filter((t) => t.visible).map((t) => ({ ...TAB_ROUTES[t.id], label: t.label }));
  const NAV_EXTRA = NAV_EXTRA_ALL.filter((n) => n.href !== "/import" || config.features.csvImport);
  const half = Math.ceil(NAV.length / 2);
  // Remote config: cached copy first, then the latest from the server; on change, rules are refreshed and SMS re-read.
  useEffect(() => {
    loadCachedConfig();
    refreshConfig();
    window.addEventListener("paisa-resume", refreshConfig);
    return () => window.removeEventListener("paisa-resume", refreshConfig);
  }, []);
  useEffect(() => {
    if (!db) return;
    const onConfig = () => ensureRules(db).then(() => window.dispatchEvent(new Event("paisa-resume")));
    window.addEventListener("drip-config", onConfig);
    return () => window.removeEventListener("drip-config", onConfig);
  }, [db]);
  const hapticsPref = (data?.profile?.prefs?.haptics ?? DEFAULT_PREFS.haptics) && config.features.haptics;
  useEffect(() => setHapticsEnabled(hapticsPref), [hapticsPref]);
  // One light tap for every button, link, tab and toggle, instead of wiring each one.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.("button, a, summary, label, [role=tab], input[type=checkbox]")) haptic("tap");
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  const pathname = usePathname();
  const router = useRouter();
  const [qa, setQa] = useState<{ open: boolean; date?: string }>({ open: false });
  const open = useCallback((preset?: { date?: string }) => setQa({ open: true, date: preset?.date }), []);

  const needsOnboarding = mode === "personal" && data !== undefined && !data.profile;
  const onOnboarding = pathname === "/onboarding";
  // /onboarding is only meaningful before setup; afterwards it goes home.
  useEffect(() => {
    if (onOnboarding && data?.profile) router.replace("/");
  }, [onOnboarding, data, router]);

  if (!ready) return <Splash />;
  if (!mode) return <Welcome />;
  // Onboarding renders in place (no redirect), so there's no navigation race that could remount it mid-typing.
  if (needsOnboarding)
    return (
      <div className="mx-auto min-h-dvh max-w-xl px-4 pb-10">
        <Onboarding />
      </div>
    );
  if (data === undefined) return <Splash />;

  return (
    <QuickAddCtx.Provider value={{ open }}>
      <div className="md:flex">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-white/5 px-4 py-6 md:flex">
          <Brand />
          <button className="btn-primary mt-6 w-full" onClick={() => open()}>
            <IconPlus /> Add expense
          </button>
          <nav className="mt-6 space-y-1">
            {[...NAV, ...NAV_EXTRA].map((n) => (
              <NavLink key={n.href} {...n} active={isActive(pathname, n.href)} />
            ))}
          </nav>
          <div className="mt-auto">
            <ModeBadge mode={mode} onSwitch={() => setMode(null)} />
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {mode === "demo" && (
            <div className="sticky top-0 z-30 flex items-center justify-between gap-2 bg-violet px-4 py-1.5 text-[12px] font-semibold text-ink-950" data-testid="demo-banner">
              <span>DEMO MODE · fictional transactions, not real bank data</span>
              <button className="underline underline-offset-2" onClick={() => setMode(null)}>
                Switch
              </button>
            </div>
          )}
          {/* Mobile top bar */}
          <div className="flex items-center justify-between px-4 pt-[max(12px,env(safe-area-inset-top))] md:hidden">
            <Brand small />
            <div className="flex gap-1">
              {NAV_EXTRA.map((n) => (
                <Link key={n.href} href={n.href} aria-label={n.label} className={cx("grid h-10 w-10 place-items-center rounded-full", isActive(pathname, n.href) ? "bg-lime/15 text-lime" : "text-ink-300 hover:bg-white/5")}>
                  <n.icon />
                </Link>
              ))}
            </div>
          </div>
          <main className="mx-auto w-full max-w-5xl px-4 pb-32 md:px-8 md:pb-12 md:pt-6">{children}</main>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/5 bg-ink-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden" aria-label="Primary">
        <div className="mx-auto grid max-w-md grid-cols-5 items-center px-2 py-1.5">
          {NAV.slice(0, half).map((n) => (
            <TabLink key={n.href} {...n} active={isActive(pathname, n.href)} />
          ))}
          <div className="flex justify-center">
            <button onClick={() => open()} aria-label="Add expense" className="-mt-6 grid h-14 w-14 place-items-center rounded-2xl bg-lime text-ink-950 shadow-[0_8px_30px_rgba(198,255,61,0.35)] active:scale-95">
              <IconPlus />
            </button>
          </div>
          {NAV.slice(half).map((n) => (
            <TabLink key={n.href} {...n} active={isActive(pathname, n.href)} />
          ))}
        </div>
      </nav>

      <QuickAddSheet open={qa.open} presetDate={qa.date} onClose={() => setQa({ open: false })} />
    </QuickAddCtx.Provider>
  );
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: ComponentType; active: boolean }) {
  return (
    <Link href={href} className={cx("flex min-h-[44px] items-center gap-3 rounded-2xl px-3 text-sm font-semibold transition", active ? "bg-white/[0.07] text-lime" : "text-ink-300 hover:bg-white/[0.04] hover:text-white")}>
      <Icon />
      {label}
    </Link>
  );
}

function TabLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: ComponentType; active: boolean }) {
  return (
    <Link href={href} className={cx("flex min-h-[52px] flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold", active ? "text-lime" : "text-ink-400")}>
      <Icon />
      {label}
    </Link>
  );
}

function Brand({ small }: { small?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className={cx("grid place-items-center rounded-xl bg-lime text-ink-950", small ? "h-8 w-8" : "h-9 w-9")}>
        <svg width="18" height="18" viewBox="0 0 64 64" fill="currentColor">
          <path d="M32 4C32 4 12 26 12 42a20 20 0 0 0 40 0C52 26 32 4 32 4Z" />
        </svg>
      </span>
      <span className={cx("font-bold tracking-tight", small ? "text-base" : "text-lg")}>drip</span>
    </Link>
  );
}

function ModeBadge({ mode, onSwitch }: { mode: string; onSwitch: () => void }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] p-3 text-xs text-ink-400">
      <div className="mb-1 font-semibold text-white">{mode === "demo" ? "🎭 Demo mode" : "🔒 Personal mode"}</div>
      {mode === "demo" ? "Fictional data. Nothing here is real." : "Data stays in this browser only."}
      <button onClick={onSwitch} className="mt-2 block font-semibold text-lime">
        Switch mode →
      </button>
    </div>
  );
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-lime/20 border-t-lime" aria-label="Loading" />
    </div>
  );
}
