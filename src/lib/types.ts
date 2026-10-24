import type { DateKey, MonthKey } from "./dates";
import type { Paise } from "./money";

export type AppMode = "demo" | "personal";

/** Which set-aside category a planned payment belongs to: Bills, Investments or Savings. */
export type CommitmentKind = "bill" | "investment" | "savings";

/** A planned monthly payment (rent, electricity, SIP…) set aside before the daily budget. */
export interface Commitment {
  id: string;
  name: string;
  kind: CommitmentKind;
  /** Optional tag, e.g. Rent, Utility, SIP. Used to match payments to this plan line. */
  tag?: string;
  amountPaise: Paise;
  /** Day of month the payment is due (1-31; clamped to month length). */
  dueDay: number;
  /** Optional merchant/description substring, or a UPI ID, used to match payments. */
  matchHint?: string;
}

/**
 * - planned: you enter expected amounts; when a payment differs, the difference
 *   lands in that day's budget (over at once, under at month end).
 * - actual: no amounts are entered; recorded income funds the pool, tagged
 *   set-aside payments reduce it and the remaining days are recalculated.
 */
export type SetAsideMode = "planned" | "actual";

/**
 * A budget plan is effective from a date until the next plan's effectiveFrom.
 * Changing the budget creates a new plan rather than rewriting history.
 */
export interface BudgetPlan {
  id: string;
  effectiveFrom: DateKey;
  /** Explicit choice; older plans infer tracking from missing income. */
  budgetMode?: "tracking" | "set-aside";
  /** Planned monthly take-home income. Actual mode uses income transactions. */
  incomePaise: Paise | null;
  commitments: Commitment[];
  /** Categories taken off income before the daily budget. Missing = DEFAULT_SET_ASIDE. */
  setAside?: string[];
  /** Missing = "planned". */
  setAsideMode?: SetAsideMode;
  createdAt: number;
}

export interface Profile {
  id: "me";
  name?: string;
  trackingStart: DateKey;
  /** Explicit one-time adjustment added on the tracking start date (default 0). */
  openingAdjustmentPaise: Paise;
  onboardedAt: number;
  /**
   * Commitments the user marked as already paid for a month without a matching
   * transaction (e.g. rent paid before tracking began). Key: `${commitmentId}@${MonthKey}`.
   */
  manuallyPaid: string[];
  /** Suggestions you answered "No" to (smart matches, transfer pairs); never shown again. */
  dismissedSuggestions?: string[];
  /** App preferences; missing keys use the defaults in DEFAULT_PREFS. */
  prefs?: Partial<Prefs>;
}

export interface Prefs {
  /** Read "Avl bal" / "Avl limit" from bank SMS and show balances. */
  balances: boolean;
  /** Ask for fingerprint / screen lock when opening the Android app. */
  appLock: boolean;
  /** Light haptic taps on buttons and confirmations. */
  haptics: boolean;
}

export const DEFAULT_PREFS: Prefs = { balances: true, appLock: false, haptics: true };

/** Latest known balance of a bank account or available limit of a card, from SMS. */
export interface Account {
  /** `${bank}-${last digits}` */
  id: string;
  bank: string;
  last4: string;
  kind: "account" | "card";
  balancePaise: Paise;
  /** When the SMS carrying this balance arrived (epoch ms). */
  asOf: number;
}

/**
 * - expense: discretionary spending, deducted from the daily budget
 * - commitment: a payment linked to a planned line (rent, SIP…) in the budget
 * - investment: money moved into investments (not an expense)
 * - transfer: between the user's own accounts — excluded from everything
 * - refund: money back for an earlier expense
 * - income: salary, interest, other inflows
 */
export type TxnKind = "expense" | "commitment" | "investment" | "transfer" | "refund" | "income";

export type PaymentMethod = "upi" | "card" | "cash" | "netbanking" | "wallet" | "other";

export interface Provenance {
  /** Which provider created the row: demo, manual, csv, or a future aggregator id. */
  providerId: string;
  importBatchId?: string;
  /** Provider's own identifier / bank reference, when available. */
  externalRef?: string;
  /** Original source text (e.g. raw CSV narration) for auditing. */
  raw?: string;
  importedAt: number;
}

export interface Transaction {
  id: string;
  date: DateKey;
  /** Always positive. Direction comes from `kind`. */
  amountPaise: Paise;
  kind: TxnKind;
  merchant: string;
  category: string;
  /** Finer label within the category, e.g. Rent, Utility, SIP, Dividend income. */
  tag?: string;
  /** Who was paid / who paid: a lowercased UPI ID when the bank SMS or statement shows one. */
  payee?: string;
  /** Marked by you as a regular payment (adds it to Recurring). */
  recurring?: boolean;
  method: PaymentMethod;
  note?: string;
  /** For kind=commitment: the reserved commitment it pays. */
  commitmentId?: string;
  /** For kind=refund: the expense it reverses. */
  refundOf?: string;
  /** Flagged for the user to review (e.g. refund with no matching expense). */
  needsReview?: boolean;
  reviewReason?: string;
  /** Dedup fingerprint (see csv.ts). */
  fingerprint?: string;
  source: Provenance;
  createdAt: number;
  updatedAt: number;
  /** Explicit user edits are never overwritten by automatic processing. */
  userEdited?: boolean;
  holdId?: string;
}

export interface CategoryRule {
  id: string;
  /** Case-insensitive substring matched against merchant / narration. Ignored when `payee` is set. */
  pattern: string;
  /** Exact merchant fallback for remembered recipient choices. */
  merchant?: string;
  direction?: "in" | "out";
  /** Exact payee (UPI ID) this rule applies to. Payee rules beat text rules. */
  payee?: string;
  category: string;
  /** Optional tag set together with the category, e.g. Bills · Rent. */
  tag?: string;
  /** Optionally also set the kind (e.g. "transfer" for own-account moves). */
  kind?: TxnKind;
  /** Higher priority wins. User rules default above built-ins. */
  priority: number;
  builtIn?: boolean;
}

export type ConnectionStatus = "connected" | "disconnected" | "syncing" | "error" | "not_available";

export interface ProviderConnection {
  providerId: string;
  status: ConnectionStatus;
  lastSyncAt?: number;
  lastError?: string;
  /** Count of transactions added in the last sync/import. */
  lastCount?: number;
  /** Provider-specific resume point (SMS: received time of the last message read). */
  cursor?: string;
  /** SMS: earliest tracking start already scanned; moving the start before it triggers a backfill. */
  syncedFrom?: string;
  /** SMS: parser version that last read the inbox; an older one triggers a one-time re-read. */
  parserVersion?: number;
  /** SMS: remote config version the inbox was last read with; a new one re-reads once. */
  configVersion?: number;
  /** Completed opt-in per-rule history jobs, keyed by rule identity. */
  ruleHistory?: Record<string, string>;
  /** Explicit device setting requests a balance-only inbox rescan. */
  balancesRescan?: boolean;
  /** SMS: fingerprints of imported transactions you deleted, so a re-read never brings them back. */
  dismissed?: string[];
}

/** A regular payment: from an autopay/mandate SMS, or a transaction you marked as recurring. */
export interface Recurring {
  id: string;
  name: string;
  payee?: string;
  /** Usual (or maximum mandate) amount. */
  amountPaise: Paise;
  frequency: "daily" | "weekly" | "monthly" | "quarterly" | "half-yearly" | "yearly" | "once" | "unknown";
  /** Day of month it's due (monthly/quarterly/yearly). */
  dueDay: number;
  /** For yearly/quarterly: a month it's due (1-12). */
  dueMonth?: number;
  startDate?: DateKey;
  userEdited?: boolean;
  /** Do not merge two distinct mandates to one payee. */
  bank?: string;
  category: string;
  tag?: string;
  source: "mandate" | "manual";
  /** Bank mandate reference (UMRN) when the SMS has one. */
  mandateRef?: string;
  status: "active" | "revoked";
  createdAt: number;
  updatedAt: number;
}

export interface ImportBatch {
  id: string;
  providerId: string;
  fileName?: string;
  importedAt: number;
  rowCount: number;
  importedCount: number;
  skippedDuplicates: number;
  invalidCount: number;
}

export type { DateKey, MonthKey, Paise };

export interface HoldEvent {
  id: string;
  type: "blocked" | "debited" | "released" | "cancelled";
  amountPaise: Paise;
  at: number;
  raw: string;
}

export interface FundHold {
  id: string;
  name: string;
  bank: string;
  account?: string;
  reference?: string;
  events: HoldEvent[];
  blockedPaise: Paise;
  debitedPaise: Paise;
  releasedPaise: Paise;
  remainingPaise: Paise;
  status: "blocked" | "partial" | "settled" | "released" | "needs_review";
  needsReview: boolean;
  createdAt: number;
  updatedAt: number;
}
