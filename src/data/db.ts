import Dexie, { type Table } from "dexie";
import type { Account, AppMode, BudgetPlan, CategoryRule, ImportBatch, Profile, ProviderConnection, Recurring, Transaction } from "@/lib/types";
import { currentBuiltInRules, migratePlan, migrateRule, migrateTxn } from "./migrate";

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
  accounts!: Table<Account, string>;
  recurring!: Table<Recurring, string>;

  constructor(name: string) {
    super(name);
    // Schema changes must never lose data across app updates: keep every existing
    // version() call, add the next one with an .upgrade() that migrates rows, and
    // add any new table to exportAll / importBackup (tests/unit/backup.test.ts checks).
    this.version(1).stores({
      profile: "id",
      plans: "id, effectiveFrom",
      txns: "id, date, kind, category, fingerprint, commitmentId, refundOf",
      rules: "id, priority",
      connections: "providerId",
      imports: "id, importedAt",
    });
    // v2 (drip 0.4): account balances from SMS. Adds a table; existing data is untouched.
    this.version(2).stores({ accounts: "id" });
    // v3 (drip 0.5): Bills and Investments split, tags, payees, recurring payments.
    this.version(3)
      .stores({ txns: "id, date, kind, category, fingerprint, commitmentId, refundOf, payee", recurring: "id, payee, status" })
      .upgrade(async (tx) => {
        await tx.table<Transaction, string>("txns").toCollection().modify((t, ref) => {
          ref.value = migrateTxn(t);
        });
        await tx.table<BudgetPlan, string>("plans").toCollection().modify((p, ref) => {
          ref.value = migratePlan(p);
        });
        const rules = tx.table<CategoryRule, string>("rules");
        await rules.filter((r) => !!r.builtIn).delete();
        await rules.toCollection().modify((r, ref) => {
          ref.value = migrateRule(r);
        });
        await rules.bulkPut(currentBuiltInRules());
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
