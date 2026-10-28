import Dexie, { type Table } from "dexie";
import type { Account, AppMode, BudgetPlan, CategoryRule, ImportBatch, Profile, ProviderConnection, Recurring, Transaction, FundHold } from "@/lib/types";
import { demoAccounts, assignDemoAccount } from "./providers/demoAccounts";
import { accountKey, recoverAccountMetadata } from "@/features/accounts/metadata";
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
  holds!: Table<FundHold, string>;

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
    // v4: IPO holds are separate from settled transactions and recurring bills.
    this.version(4).stores({ holds: "id, reference, status" }).upgrade(async (tx) => {
      // Old parsers guessed monthly when frequency was missing. Without source
      // evidence we cannot safely retain that guessed schedule.
      await tx.table<Recurring, string>("recurring").toCollection().modify((r) => {
        if (r.source === "mandate" && !r.startDate && !r.userEdited) r.frequency = "unknown";
      });
    });
    // v5: preserve amounts, categories, edits, sync position and all existing rows.
    this.version(5).stores({txns:"id, date, kind, category, fingerprint, commitmentId, refundOf, payee, accountId"}).upgrade(async tx=>{
      const table=tx.table<Account,string>('accounts');const old=await table.toArray();
      const ids=new Map(old.map(a=>[a.id,accountKey(a)]));
      const accounts:Account[]=old.map(a=>({...a,id:accountKey(a),ownerConfirmed:a.ownerConfirmed??false,balanceKnown:a.balanceKnown??true,balanceSource:a.balanceSource??'sms' as const}));
      if(this.name==='paisa-pulse-demo')for(const a of demoAccounts())if(!accounts.some(k=>k.id===a.id))accounts.push(a);
      const merged=new Map<string,Account>();for(const a of accounts){const prior=merged.get(a.id);if(!prior||a.asOf>prior.asOf)merged.set(a.id,a);}
      await table.clear();if(merged.size)await table.bulkPut([...merged.values()]);
      let demoIndex=0;
      await tx.table<Transaction,string>('txns').toCollection().modify(t=>{
        if(this.name==='paisa-pulse-demo'&&t.source.providerId==='demo'&&!t.accountMappingEdited)Object.assign(t,assignDemoAccount(t,demoIndex++));
        if(t.accountId&&ids.has(t.accountId))t.accountId=ids.get(t.accountId);
        Object.assign(t,recoverAccountMetadata(t,[...merged.values()]));
        if(t.accountId&&!merged.has(t.accountId)){
          const [bank,kind,last4]=t.accountId.split('-');
          if(bank&&last4&&(kind==='account'||kind==='card'))merged.set(t.accountId,{id:t.accountId,bank,kind,last4,balancePaise:0,asOf:0,balanceKnown:false,ownerConfirmed:false});
        }
      });
      if(merged.size)await table.bulkPut([...merged.values()]);
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
  if (mode === "personal" && typeof window !== "undefined") window.PaisaWidget?.clear();
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
