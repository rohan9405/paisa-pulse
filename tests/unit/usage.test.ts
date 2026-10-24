import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MAX_SESSION_SECONDS, isoWeek, validEvents } from "@/lib/usageEvents";
import { type UsageDb, count, istHour, prune, receive, report } from "../../backend/src/usage";

/** Just enough of Cloudflare D1 over node:sqlite to run the real SQL. */
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("backend/usage.sql", "utf8"));
  const stmt = (sql: string, args: unknown[] = []) => ({
    sql,
    args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => db.prepare(sql).run(...(args as never[])),
  });
  return { prepare: (sql: string) => stmt(sql), batch: async (list: { run: () => Promise<unknown> }[]) => { for (const s of list) await s.run(); return []; }, raw: db } as unknown as UsageDb & { raw: DatabaseSync };
}

describe("usage events", () => {
  it("keeps only known names and values: no free text, IDs or numbers outside range", () => {
    const events = validEvents({ events: [
      { e: "install", d: "android" }, { e: "install", d: "iphone" },
      { e: "active_day", d: "0.8.7" }, { e: "active_day", d: "my phone" },
      { e: "screen", d: "stats" }, { e: "screen", d: "/transactions?q=rent" },
      { e: "feature", d: "sms:on" }, { e: "feature", d: "salary:50000" },
      { e: "session", s: 99999 }, { e: "session", s: -1 }, { e: "ping", id: "abc" },
      { e: "merchant", d: "Swiggy" }, "x", null,
    ] });
    expect(events).toEqual([{ e: "install", d: "android" }, { e: "active_day", d: "0.8.7" }, { e: "screen", d: "stats" }, { e: "feature", d: "sms:on" }, { e: "session", s: MAX_SESSION_SECONDS }, { e: "ping" }]);
    expect(validEvents({ events: Array(100).fill({ e: "ping" }) })).toHaveLength(40);
    expect(validEvents("nonsense")).toEqual([]);
  });

  it("uses ISO weeks and IST hours", () => {
    expect(isoWeek("2026-10-24")).toBe("2026-W43");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(istHour(Date.UTC(2026, 9, 24, 20, 0))).toBe("2026-10-25T01");
  });
});

describe("usage counters (backend)", () => {
  const NOW = Date.UTC(2026, 9, 24, 6, 0); // 11:30 IST, Saturday

  it("stores hourly counts only and reports users, sessions, live and traffic", async () => {
    const db = d1();
    await count(db, [{ e: "install", d: "android" }, { e: "active_day", d: "0.8.7" }, { e: "active_week", d: "0.8.7" }, { e: "active_month", d: "0.8.7" }, { e: "session", s: 120 }, { e: "ping" }], NOW);
    await count(db, [{ e: "active_day", d: "0.8.7" }, { e: "session", s: 60 }, { e: "ping" }, { e: "config" }], NOW + 30_000);
    const cols = db.raw.prepare("PRAGMA table_info(usage)").all().map((c: unknown) => (c as { name: string }).name);
    expect(cols).toEqual(["hour", "event", "dim", "n", "total"]); // nothing per person or per request

    const r = await report(db, 7, NOW + 60_000);
    const get = (event: string) => r.rows.filter((x: { event: string }) => x.event === event).reduce((a: number, x: { n: number }) => a + x.n, 0);
    expect(get("active_day")).toBe(2);
    expect(get("session")).toBe(2);
    expect(r.rows.find((x: { event: string }) => x.event === "session")?.total).toBe(180);
    expect(r.weekUsers).toBe(1);
    expect(r.monthUsers).toBe(1);
    expect(r.allTime).toEqual({ install: 1, config: 1 });
    expect(r.live.reduce((a: number, m: { n: number }) => a + m.n, 0)).toBe(2);

    await prune(db, NOW + 3 * 86_400_000);
    expect((await report(db, 7, NOW + 3 * 86_400_000)).live).toEqual([]);
  });

  it("accepts only POST, ignores everything when switched off, and caps the body", async () => {
    const db = d1();
    const post = (body: string) => new Request("https://x/e", { method: "POST", body });
    expect((await receive(post(JSON.stringify({ events: [{ e: "ping" }] })), db, false)).status).toBe(204);
    expect((await report(db, 1, Date.now())).live).toEqual([]);
    expect((await receive(post("x".repeat(9000)), db, true)).status).toBe(413);
    expect((await receive(new Request("https://x/e"), db, true)).status).toBe(405);
    expect((await receive(post(JSON.stringify({ events: [{ e: "screen", d: "today" }] })), db, true)).status).toBe(204);
    expect((await report(db, 1, Date.now())).rows).toEqual([expect.objectContaining({ event: "screen", dim: "today", n: 1 })]);
  });
});
