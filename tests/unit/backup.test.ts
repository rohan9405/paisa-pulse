import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { FinanceDB } from "@/data/db";
import { ensureConnections, ensureRules, exportAll, importBackup, seedDemo } from "@/data/repo";

const fresh = () => new FinanceDB(`backup-${Math.random()}`);

describe("backup", () => {
  it("covers every table, so nothing (tags, rules, SMS position…) is lost in a restore", async () => {
    const db = fresh();
    await db.open();
    const backup = await exportAll(db, "personal");
    const tables = db.tables.map((t) => t.name);
    // profile is a single row, exported as `profile`.
    for (const t of tables) expect(Object.keys(backup), `table "${t}" is missing from exportAll`).toContain(t);
  });

  it("round-trips all data, including rules and SMS sync state", async () => {
    const src = fresh();
    await seedDemo(src, "2026-10-21");
    await src.rules.add({ id: "mine", pattern: "ramesh@okaxis", category: "Rent & Housing", priority: 10 });
    await src.connections.put({ providerId: "sms", status: "connected", cursor: "1792605085000", syncedFrom: "2026-10-01" });
    const backup = JSON.parse(JSON.stringify(await exportAll(src, "personal")));

    const dst = fresh();
    await ensureRules(dst);
    await ensureConnections(dst, "personal");
    await importBackup(dst, backup);

    expect(await dst.txns.count()).toBe(await src.txns.count());
    expect(await dst.plans.toArray()).toEqual(await src.plans.toArray());
    expect(await dst.profile.get("me")).toEqual(await src.profile.get("me"));
    expect(await dst.rules.get("mine")).toMatchObject({ pattern: "ramesh@okaxis" });
    expect(await dst.connections.get("sms")).toMatchObject({ cursor: "1792605085000", syncedFrom: "2026-10-01" });
  });

  it("still restores backups made before connections were included", async () => {
    const src = fresh();
    await seedDemo(src, "2026-10-21");
    const { connections: _omit, ...old } = JSON.parse(JSON.stringify(await exportAll(src, "personal")));
    const dst = fresh();
    await importBackup(dst, old);
    expect(await dst.txns.count()).toBe(await src.txns.count());
  });

  it("data written by one app session is there when the next one opens the same database", async () => {
    const name = `reopen-${Math.random()}`;
    const first = new FinanceDB(name);
    await seedDemo(first, "2026-10-21");
    const count = await first.txns.count();
    first.close();
    const second = new FinanceDB(name);
    expect(await second.txns.count()).toBe(count);
  });
});
