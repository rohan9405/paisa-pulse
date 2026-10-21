/**
 * Pluggable transaction-provider interface.
 *
 * Every transaction records which provider created it (Transaction.source),
 * and every provider exposes connection status, last sync and last error.
 * Today we ship: demo (fictional data), manual entry and CSV import.
 * A production integration (e.g. via an RBI-licensed Account Aggregator) would
 * implement `sync` server-side — see docs/DATA_INTEGRATION.md. We deliberately
 * do not invent any provider API here.
 */
import type { ConnectionStatus, Transaction } from "@/lib/types";

export type ProviderKind = "demo" | "manual" | "file" | "sms" | "aggregator";

export interface ProviderDescriptor {
  id: string;
  name: string;
  kind: ProviderKind;
  description: string;
  /** Whether this provider can pull data on its own (vs. user-driven entry). */
  automatic: boolean;
  /** Static availability; live status lives in the `connections` table. */
  available: boolean;
}

/** Normalised transaction a provider hands to the app before categorisation. */
export type ProviderTransaction = Omit<Transaction, "id" | "createdAt" | "updatedAt">;

export interface SyncResult {
  added: ProviderTransaction[];
  /** Provider-side identifiers we've already seen are skipped via fingerprint. */
  cursor?: string;
}

export interface TransactionProvider extends ProviderDescriptor {
  /** Pull new transactions. Throws on failure; caller records lastError. */
  sync?(opts: { since?: string; cursor?: string }): Promise<SyncResult>;
}

export interface ProviderStatusView extends ProviderDescriptor {
  status: ConnectionStatus;
  lastSyncAt?: number;
  lastError?: string;
  lastCount?: number;
}
