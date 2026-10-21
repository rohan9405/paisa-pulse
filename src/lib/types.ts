import type { DateKey, MonthKey } from "./dates";
import type { Paise } from "./money";

export type AppMode = "demo" | "personal";

export type CommitmentKind = "bill" | "savings";

/** A fixed monthly reservation taken out of income before discretionary spending. */
export interface Commitment {
  id: string;
  name: string;
  kind: CommitmentKind;
  amountPaise: Paise;
  /** Day of month the payment is due (1-31; clamped to month length). */
  dueDay: number;
  /** Optional merchant/description substring used to suggest matches. */
  matchHint?: string;
}

/**
 * A budget plan is effective from a date until the next plan's effectiveFrom.
 * Changing the budget creates a new plan rather than rewriting history.
 */
export interface BudgetPlan {
  id: string;
  effectiveFrom: DateKey;
  /** Monthly take-home income. 0 / null means "no budget, just track". */
  incomePaise: Paise | null;
  commitments: Commitment[];
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
}

/**
 * - expense: discretionary spending, deducted from the daily budget
 * - commitment: payment of a fixed bill / savings target, matched to a reservation
 * - investment: money moved into investments outside a savings reservation (not an expense)
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
}

export interface CategoryRule {
  id: string;
  /** Case-insensitive substring matched against merchant / narration. */
  pattern: string;
  category: string;
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
