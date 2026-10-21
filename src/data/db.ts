import Dexie, { type Table } from "dexie";
import type { AppMode, BudgetPlan, CategoryRule, ImportBatch, Profile, ProviderConnection, Transaction } from "@/lib/types";

/**
 * Demo and personal data live in two completely separate IndexedDB databases,
 * so switching modes can never mix fictional and real transactions.
 */
export class FinanceDB extends Dexie {
  profile!: Table<Profile, string>;
  plans!: Table<BudgetPlan, string>;
  txns!: Table<Transaction, string>;
  rules!: Table<CategoryRule, string>;
  connections!: Table<ProviderConnection, string>;
  imports!: Table<ImportBatch, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      profile: "id",
      plans: "id, effectiveFrom",
      txns: "id, date, kind, category, fingerprint, commitmentId, refundOf",
      rules: "id, priority",
      connections: "providerId",
      imports: "id, importedAt",
    });
  }
}

export const DB_NAMES: Record<AppMode, string> = {
  demo: "paisa-pulse-demo",
  personal: "paisa-pulse-personal",
};

const cache = new Map<AppMode, FinanceDB>();
export function getDB(mode: AppMode): FinanceDB {
  let db = cache.get(mode);
  if (!db) {
    db = new FinanceDB(DB_NAMES[mode]);
    cache.set(mode, db);
  }
  return db;
}

export async function deleteDatabase(mode: AppMode) {
  const db = cache.get(mode);
  if (db) {
    db.close();
    cache.delete(mode);
  }
  await Dexie.delete(DB_NAMES[mode]);
}

export function uid(prefix = ""): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + rand;
}
