/**
 * v3 data migration: Bills and Investments become separate categories with
 * tags. Used by the IndexedDB upgrade and when restoring older backups, so
 * every function here must be safe to run twice.
 */
import { DEFAULT_RULES, categorize } from "@/lib/categorize";
import { getConfig } from "@/lib/remoteConfig";
import type { BudgetPlan, CategoryRule, Commitment, Transaction } from "@/lib/types";

const builtIns: CategoryRule[] = DEFAULT_RULES.map((r, i) => ({ ...r, id: `builtin-${i}` }));
const INVESTMENT_HINT = /\b(sip|mutual|mf|groww|zerodha|kuvera|coin|index fund|nps|ppf|stocks?|indmoney|upstox)\b/i;

function billTag(text: string): string {
  const t = categorize(text, builtIns)?.tag;
  if (t) return t;
  if (/\brent\b/i.test(text)) return "Rent";
  if (/maintenance/i.test(text)) return "Maintenance";
  if (/\b(phone|mobile|internet|fiber|fibre|broadband|wifi|jio|airtel)\b/i.test(text)) return "Phone & internet";
  if (/\bemi\b|loan/i.test(text)) return "EMI";
  if (/insurance|premium|\blic\b/i.test(text)) return "Insurance";
  return "Utility";
}

/** Old category → new category + tag. */
function remap(category: string, text: string, current?: string): { category: string; tag?: string } {
  if (category === "Bills & Utilities") return /upi lite/i.test(text) ? { category: "Other", tag: "UPI Lite" } : { category: "Bills", tag: current ?? billTag(text) };
  if (category === "Rent & Housing") return { category: "Bills", tag: current ?? (/maintenance/i.test(text) ? "Maintenance" : "Rent") };
  if (category === "Savings" && INVESTMENT_HINT.test(text)) return { category: "Investments", tag: current ?? "SIP" };
  return { category, tag: current };
}

export function migrateTxn(t: Transaction): Transaction {
  const text = `${t.merchant} ${t.source.raw ?? ""} ${t.note ?? ""}`;
  let { category, tag } = remap(t.category, text, t.tag);
  if (t.kind === "investment" && category !== "Investments" && category !== "Savings") [category, tag] = ["Investments", tag ?? (INVESTMENT_HINT.test(text) ? "SIP" : undefined)];
  if (category === t.category && tag === t.tag) return t;
  return { ...t, category, tag };
}

export function migrateRule(r: CategoryRule): CategoryRule {
  const { category, tag } = remap(r.category, r.pattern, r.tag);
  // A user rule written as a UPI ID becomes a payee rule.
  const payee = r.payee ?? (/^[\w.\-]+@[a-z]+$/i.test(r.pattern.trim()) ? r.pattern.trim().toLowerCase() : undefined);
  if (category === r.category && tag === r.tag && payee === r.payee) return r;
  return { ...r, category, tag, payee };
}

export function migrateCommitment(c: Commitment): Commitment {
  const text = `${c.name} ${c.matchHint ?? ""}`;
  if (c.kind === "savings" && INVESTMENT_HINT.test(text)) return { ...c, kind: "investment", tag: c.tag ?? "SIP" };
  if (c.kind === "bill" && !c.tag) return { ...c, tag: billTag(text) };
  return c;
}

export function migratePlan(p: BudgetPlan): BudgetPlan {
  const commitments = p.commitments.map(migrateCommitment);
  return commitments.every((c, i) => c === p.commitments[i]) ? p : { ...p, commitments };
}

/** The current built-in rules, with stable ids. */
/** Built-in rules plus the remote config's rules, minus built-ins it switched off. */
export function currentBuiltInRules(): CategoryRule[] {
  const { rules, disabledRules, replaceBuiltInRules } = getConfig();
  const off = new Set(disabledRules);
  const remote: CategoryRule[] = rules.map((r, i) => ({ id: `remote-${i}-${r.contains}`, pattern: r.contains, category: r.category, tag: r.tag, kind: r.kind, direction: r.direction, priority: r.priority, builtIn: true }));
  // The config can own the whole list; the built-ins are then only the offline fallback before the first config.
  const base = replaceBuiltInRules ? [] : builtIns.filter((r) => !off.has(r.pattern.trim().toLowerCase())).map((r) => ({ ...r }));
  return [...base, ...remote];
}
