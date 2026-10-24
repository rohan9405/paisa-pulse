"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { type DateKey, toISTKey } from "@/lib/dates";
import type { Account, AppMode, BudgetPlan, CategoryRule, ImportBatch, Profile, ProviderConnection, Recurring, Transaction, FundHold } from "@/lib/types";
import { type FinanceDB, getDB } from "./db";
import { ensureRules, seedDemo } from "./repo";

const MODE_KEY = "paisa-pulse:mode";

function readMode(): AppMode | null {
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    return v === "demo" || v === "personal" ? v : null;
  } catch {
    return null;
  }
}

function writeMode(m: AppMode | null) {
  try {
    if (m) window.localStorage.setItem(MODE_KEY, m);
    else window.localStorage.removeItem(MODE_KEY);
  } catch {
    /* storage blocked: mode lasts for this tab only */
  }
}

interface ModeCtx {
  ready: boolean;
  mode: AppMode | null;
  db: FinanceDB | null;
  setMode: (m: AppMode | null) => Promise<void>;
  today: DateKey;
}

const Ctx = createContext<ModeCtx | null>(null);

export function useToday(): DateKey {
  const [today, setToday] = useState<DateKey>(() => toISTKey());
  useEffect(() => {
    const id = window.setInterval(() => setToday(toISTKey()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return today;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [mode, setModeState] = useState<AppMode | null>(null);
  const today = useToday();

  const prepare = useCallback(
    async (m: AppMode) => {
      const db = getDB(m);
      await db.open();
      if (m === "demo" && (await db.profile.count()) === 0) await seedDemo(db, toISTKey());
      await ensureRules(db);
    },
    [],
  );

  useEffect(() => {
    // Ask the browser/WebView not to evict our IndexedDB under storage pressure.
    navigator.storage?.persist?.().catch(() => {});
    const m = readMode();
    (async () => {
      if (m) {
        try {
          await prepare(m);
        } catch (e) {
          console.error(e);
        }
      }
      setModeState(m);
      setReady(true);
    })();
  }, [prepare]);

  const setMode = useCallback(
    async (m: AppMode | null) => {
      if (m) await prepare(m);
      writeMode(m);
      setModeState(m);
    },
    [prepare],
  );

  const value = useMemo<ModeCtx>(() => ({ ready, mode, db: mode ? getDB(mode) : null, setMode, today }), [ready, mode, setMode, today]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): ModeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStore outside StoreProvider");
  return c;
}

export interface AppData {
  profile: Profile | null;
  plans: BudgetPlan[];
  txns: Transaction[];
  rules: CategoryRule[];
  connections: ProviderConnection[];
  imports: ImportBatch[];
  accounts: Account[];
  recurring: Recurring[];
  holds: FundHold[];
}

/** Live snapshot of the active mode's database. `undefined` while loading. */
export function useAppData(): AppData | undefined {
  const { db, mode } = useStore();
  return useLiveQuery(
    async () => {
      if (!db) return undefined;
      const [profile, plans, txns, rules, connections, imports, accounts, recurring, holds] = await Promise.all([
        db.profile.get("me"),
        db.plans.toArray(),
        db.txns.toArray(),
        db.rules.toArray(),
        db.connections.toArray(),
        db.imports.orderBy("importedAt").reverse().toArray(),
        db.accounts.toArray(),
        db.recurring.toArray(),
        db.holds.toArray(),
      ]);
      return { profile: profile ?? null, plans, txns, rules, connections, imports, accounts, recurring, holds };
    },
    [db, mode],
  );
}
