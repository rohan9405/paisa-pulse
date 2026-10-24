"use client";

/**
 * Anonymous usage counts, sent to the config backend's /e (backend/src/usage.ts).
 * Only fixed event names and values (lib/usageEvents.ts): no device or user ID,
 * no SMS, amounts, merchants or other text. Each phone says "active today / this
 * week / this month" at most once per period, so people are counted without
 * being identified. Off when the person opts out in Settings, the config's
 * analytics switch is off, or the build has no backend.
 */
import { toISTKey } from "@/lib/dates";
import { getConfig } from "@/lib/remoteConfig";
import { type UsageEvent, FEATURES, SCREENS, isoWeek } from "@/lib/usageEvents";
import { APP_VERSION, CONFIG_URL } from "./remoteConfigLoader";

export const USAGE_URL = CONFIG_URL ? CONFIG_URL.replace(/\/config\.json$/, "/e") : "";
const OPT_OUT = "drip:usage-off";
const SEEN = "drip:usage-seen";

let queue: UsageEvent[] = [];
let visibleSince = 0;

const read = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage off: nothing to remember */
  }
};

/** The person's choice (Settings). On unless they switched it off. */
export const usageAllowed = () => read(OPT_OUT) !== "1";
export function setUsageAllowed(on: boolean) {
  write(OPT_OUT, on ? null : "1");
  if (!on) queue = [];
}
const enabled = () => !!USAGE_URL && typeof window !== "undefined" && usageAllowed() && getConfig().features.analytics;

export function track(ev: UsageEvent) {
  if (enabled()) queue.push(ev);
}

export function flush() {
  if (!queue.length || !enabled()) return;
  const body = JSON.stringify({ events: queue.splice(0, 40) });
  // text/plain: a simple request, no preflight; sendBeacon survives the app going to the background.
  const blob = new Blob([body], { type: "text/plain" });
  if (!navigator.sendBeacon?.(USAGE_URL, blob)) fetch(USAGE_URL, { method: "POST", body, keepalive: true, credentials: "omit", referrerPolicy: "no-referrer" }).catch(() => {});
}

/** Install / active today / this week / this month, each at most once, plus today's feature snapshot. */
export function markActive(features: (typeof FEATURES)[number][]) {
  if (!enabled()) return;
  let seen: Record<string, string> = {};
  try {
    seen = JSON.parse(read(SEEN) ?? "{}");
  } catch {
    /* start over */
  }
  const day = toISTKey();
  const periods = { install: "1", day, week: isoWeek(day), month: day.slice(0, 7) };
  if (!seen.install) track({ e: "install", d: window.PaisaSms ? "android" : "web" });
  if (seen.day !== periods.day) {
    track({ e: "active_day", d: APP_VERSION });
    for (const f of features) track({ e: "feature", d: f });
  }
  if (seen.week !== periods.week) track({ e: "active_week", d: APP_VERSION });
  if (seen.month !== periods.month) track({ e: "active_month", d: APP_VERSION });
  write(SEEN, JSON.stringify(periods));
  flush();
}

export function screen(pathname: string) {
  const name = pathname.split("/").filter(Boolean)[0] ?? "today";
  const map: Record<string, (typeof SCREENS)[number]> = { dashboard: "today", briefing: "today", transactions: "activity", "privacy.html": "privacy" };
  const d = map[name] ?? (SCREENS as readonly string[]).find((s) => s === name) ?? "other";
  track({ e: "screen", d: d as (typeof SCREENS)[number] });
}

/** Sessions (time spent) and the once-a-minute "active now" ping, while the app is on screen. */
export function startSessions(): () => void {
  const onShow = () => {
    visibleSince = Date.now();
    track({ e: "ping" });
    flush();
  };
  const onHide = () => {
    if (visibleSince) track({ e: "session", s: (Date.now() - visibleSince) / 1000 });
    visibleSince = 0;
    flush();
  };
  const onChange = () => (document.hidden ? onHide() : onShow());
  if (!document.hidden) onShow();
  document.addEventListener("visibilitychange", onChange);
  const timer = window.setInterval(() => {
    if (!document.hidden) {
      track({ e: "ping" });
      flush();
    }
  }, 60_000);
  return () => {
    document.removeEventListener("visibilitychange", onChange);
    window.clearInterval(timer);
  };
}
