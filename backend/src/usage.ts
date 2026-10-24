/**
 * Anonymous usage counts. Apps POST fixed events (src/lib/usageEvents.ts) to
 * /e; we add them to hourly counters and keep nothing else: no request log, IP,
 * device or user ID. "Active now" comes from per-minute ping counters, pruned
 * after two days. Counters older than 400 days are deleted.
 */
import { type UsageEvent, validEvents } from "../../src/lib/usageEvents";

const IST_MS = 5.5 * 3600_000;
const KEEP_DAYS = 400;
const MAX_BODY = 8_000;

/** IST hour key, "2026-10-24T14". */
export const istHour = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 13);

type Counted = UsageEvent | { e: "config" };

/** The part of Cloudflare D1 used here (tests run the same SQL on node:sqlite). */
interface Stmt {
  bind(...values: unknown[]): Stmt;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface UsageDb {
  prepare(sql: string): Stmt;
  batch(statements: Stmt[]): Promise<unknown>;
}

export async function count(db: UsageDb, events: Counted[], now = Date.now()): Promise<void> {
  if (!events.length) return;
  const hour = istHour(now);
  const add = db.prepare("INSERT INTO usage (hour, event, dim, n, total) VALUES (?1, ?2, ?3, 1, ?4) ON CONFLICT (hour, event, dim) DO UPDATE SET n = n + 1, total = total + excluded.total");
  const ping = db.prepare("INSERT INTO live (minute, n) VALUES (?1, 1) ON CONFLICT (minute) DO UPDATE SET n = n + 1");
  const minute = Math.floor(now / 60_000);
  await db.batch(events.map((ev) => (ev.e === "ping" ? ping.bind(minute) : add.bind(hour, ev.e, "d" in ev ? ev.d : "", "s" in ev ? ev.s : 0))));
}

/** POST /e from the app. Always 204: nothing to tell the caller, nothing kept but counts. */
export async function receive(req: Request, db: UsageDb | undefined, enabled: boolean): Promise<Response> {
  const headers = { "access-control-allow-origin": "*", "cache-control": "no-store" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers });
  if (!db || !enabled) return new Response(null, { status: 204, headers });
  const text = await req.text();
  if (text.length > MAX_BODY) return new Response(null, { status: 413, headers });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400, headers });
  }
  await count(db, validEvents(body));
  return new Response(null, { status: 204, headers });
}

interface Row { day: string; event: string; dim: string; n: number; total: number }

/** Admin dashboard data for the last `days` days (1 = by hour). */
export async function report(db: UsageDb, days: number, now = Date.now()) {
  const from = istHour(now - days * 86_400_000);
  const bucket = days <= 1 ? "hour" : "substr(hour, 1, 10)";
  const rows = (await db.prepare(`SELECT ${bucket} AS day, event, dim, SUM(n) AS n, SUM(total) AS total FROM usage WHERE hour >= ?1 GROUP BY day, event, dim ORDER BY day`).bind(from).all<Row>()).results;
  const minute = Math.floor(now / 60_000);
  const live = (await db.prepare("SELECT minute, n FROM live WHERE minute > ?1 ORDER BY minute").bind(minute - 60).all<{ minute: number; n: number }>()).results;
  // Periods the dashboard reports "users this week / month" for.
  const istNow = new Date(now + IST_MS);
  const dow = (istNow.getUTCDay() + 6) % 7;
  const weekStart = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - dow)).toISOString().slice(0, 10);
  const monthStart = istNow.toISOString().slice(0, 7) + "-01";
  const period = async (event: string, start: string) => (await db.prepare("SELECT SUM(n) AS n FROM usage WHERE event = ?1 AND hour >= ?2").bind(event, start).first<{ n: number | null }>())?.n ?? 0;
  const totals = (await db.prepare("SELECT event, SUM(n) AS n FROM usage WHERE event IN ('install', 'config') GROUP BY event").all<{ event: string; n: number }>()).results;
  return {
    days,
    rows,
    live,
    now: minute,
    weekUsers: await period("active_week", weekStart),
    monthUsers: await period("active_month", monthStart),
    allTime: Object.fromEntries(totals.map((t: { event: string; n: number }) => [t.event, t.n])),
  };
}

export async function prune(db: UsageDb, now = Date.now()) {
  await db.batch([
    db.prepare("DELETE FROM live WHERE minute < ?1").bind(Math.floor(now / 60_000) - 2 * 1440),
    db.prepare("DELETE FROM usage WHERE hour < ?1").bind(istHour(now - KEEP_DAYS * 86_400_000)),
  ]);
}

/** GitHub release downloads per version (public API, cached for an hour). */
export async function downloads(repo: string): Promise<{ tag: string; count: number; at: string }[]> {
  const url = `https://api.github.com/repos/${repo}/releases?per_page=100`;
  const cache = (caches as unknown as { default: Cache }).default;
  let res = await cache.match(url);
  if (!res) {
    const fresh = await fetch(url, { headers: { "user-agent": "drip-config", accept: "application/vnd.github+json" } });
    if (!fresh.ok) return [];
    res = new Response(await fresh.text(), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
    await cache.put(url, res.clone());
  }
  const list = (await res.json()) as { tag_name: string; published_at: string; assets: { download_count: number }[] }[];
  return list.map((r) => ({ tag: r.tag_name, at: r.published_at, count: r.assets.reduce((s, a) => s + a.download_count, 0) }));
}
