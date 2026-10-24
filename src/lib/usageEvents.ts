/**
 * Anonymous usage events, shared by the app (data/usage.ts) and the backend
 * (/e). Only these names and values exist: no IDs, no free text, no SMS,
 * amounts or merchants. The backend stores hourly counts, never the requests.
 */

export const SCREENS = ["today", "activity", "stats", "settings", "import", "onboarding", "welcome", "privacy", "other"] as const;
export const FEATURES = ["mode:tracking", "mode:actual", "mode:planned", "sms:on", "sms:off", "lock:on", "widget:on", "demo"] as const;
export const PLATFORMS = ["android", "web"] as const;

export type UsageEvent =
  /** First open after installing. */
  | { e: "install"; d: (typeof PLATFORMS)[number] }
  /** At most once per day / ISO week / month per phone, with the app version: unique users without IDs. */
  | { e: "active_day" | "active_week" | "active_month"; d: string }
  /** Once a day with active_day: which features this phone uses. */
  | { e: "feature"; d: (typeof FEATURES)[number] }
  /** A visit to the app, with its length in seconds. */
  | { e: "session"; s: number }
  | { e: "screen"; d: (typeof SCREENS)[number] }
  /** Once a minute while the app is on screen: "active now". */
  | { e: "ping" };

export const MAX_EVENTS = 40;
export const MAX_SESSION_SECONDS = 4 * 3600;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

const has = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/** Untrusted JSON → the valid events in it (anything else is dropped). */
export function validEvents(input: unknown): UsageEvent[] {
  const list = typeof input === "object" && input !== null && Array.isArray((input as { events?: unknown }).events) ? (input as { events: unknown[] }).events : [];
  const out: UsageEvent[] = [];
  for (const x of list.slice(0, MAX_EVENTS)) {
    if (typeof x !== "object" || x === null) continue;
    const { e, d, s } = x as Record<string, unknown>;
    if (e === "install" && has(PLATFORMS, d)) out.push({ e, d });
    else if ((e === "active_day" || e === "active_week" || e === "active_month") && typeof d === "string" && VERSION.test(d)) out.push({ e, d });
    else if (e === "feature" && has(FEATURES, d)) out.push({ e, d });
    else if (e === "session" && typeof s === "number" && Number.isFinite(s) && s >= 1) out.push({ e, s: Math.min(Math.round(s), MAX_SESSION_SECONDS) });
    else if (e === "screen" && has(SCREENS, d)) out.push({ e, d });
    else if (e === "ping") out.push({ e });
  }
  return out;
}

/** "2026-W43" (ISO week) for an IST date key. */
export function isoWeek(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}
