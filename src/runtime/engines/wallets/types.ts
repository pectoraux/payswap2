/**
 * Wallets Runtime Engine — Types. (M-RT-23, Wallet Capability Migration.)
 *
 * Wallets are the first STATEFUL AGGREGATE migrated to the runtime (payments
 * and refunds are append-only transaction streams). Wallets maintain DERIVED
 * BALANCES over time — the projection computes `availableBalance`,
 * `reservedBalance`, and `totalBalance` from the event stream.
 *
 * Events (6):
 *   - wallet.created   — initial wallet creation (balance = 0)
 *   - wallet.credited  — funds added to the wallet
 *   - wallet.debited   — funds removed from the wallet
 *   - wallet.reserved  — funds locked for pending settlement
 *   - wallet.released  — reserved funds released back to available
 *   - wallet.closed    — wallet permanently closed
 *
 * The projection maintains:
 *   available = sum(credits) - sum(debits) - sum(reserved) + sum(released)
 *   reserved  = sum(reserved) - sum(released) - sum(debits from reserved)
 *   total     = available + reserved
 *
 * No mutable balance records — balances are projections derived from events.
 */

import type { Environment } from '../../types';

// ─── View (what pages receive — never Prisma types) ─────────────────────────

/**
 * The canonical WalletView. Frozen contract — pages consume this exact type.
 *
 * Balances are DERIVED from events — they are not stored. The projection
 * computes them on every apply().
 */
export interface WalletView {
  id: string;
  /** Account that owns this wallet. */
  accountId: string;
  /** Human-readable name (e.g., "GHS Wallet"). */
  name: string;
  /** Currency code (ISO 4217). */
  currency: string;
  /** Available balance (spendable now). */
  availableBalance: number;
  /** Reserved balance (locked for pending settlements). */
  reservedBalance: number;
  /** Total balance (available + reserved). */
  totalBalance: number;
  /** Whether this is the account's default wallet. */
  isDefault: boolean;
  /** Whether the wallet is closed (no further transactions). */
  isClosed: boolean;
  /** ISO date — when the wallet was created. */
  createdAt: Date;
  /** ISO date — when the wallet was last updated (last event timestamp). */
  lastUpdated: Date;
}

// ─── Event payloads (the only thing that flows through the EventStore) ──────

/** Payload for `wallet.created`. */
export interface WalletCreatedPayload {
  walletId: string;
  accountId: string;
  name: string;
  currency: string;
  isDefault: boolean;
  environment: string;
  createdAt: number; // epoch ms
}

/** Payload for `wallet.credited`. */
export interface WalletCreditedPayload {
  walletId: string;
  amount: number;
  currency: string;
  counterparty: string | null;
  reference: string | null;
  txHash: string | null;
  reason: string;
  creditedAt: number;
}

/** Payload for `wallet.debited`. */
export interface WalletDebitedPayload {
  walletId: string;
  amount: number;
  currency: string;
  counterparty: string | null;
  reference: string | null;
  txHash: string | null;
  reason: string;
  debitedAt: number;
}

/** Payload for `wallet.reserved` (funds locked for pending settlement). */
export interface WalletReservedPayload {
  walletId: string;
  amount: number;
  currency: string;
  reason: string;
  operationId: string;
  reservedAt: number;
}

/** Payload for `wallet.released` (reserved funds released back to available). */
export interface WalletReleasedPayload {
  walletId: string;
  amount: number;
  currency: string;
  reason: string;
  operationId: string;
  releasedAt: number;
}

/** Payload for `wallet.closed`. */
export interface WalletClosedPayload {
  walletId: string;
  reason: string;
  closedAt: number;
}

/** Union of all wallet event payloads. */
export type WalletEventPayload =
  | WalletCreatedPayload
  | WalletCreditedPayload
  | WalletDebitedPayload
  | WalletReservedPayload
  | WalletReleasedPayload
  | WalletClosedPayload;

// ─── Stream naming (single source of truth) ────────────────────────────────

/** Build the stream ID for a wallet in an environment. */
export function walletStreamId(env: Environment, walletId: string): string {
  return `${env}:wallet:${walletId}`;
}

/** The set of event type prefixes this projection handles. */
export const WALLET_EVENT_PREFIXES = ['wallet.'] as const;

/** The set of event types this projection handles (exhaustive). */
export const WALLET_EVENT_TYPES = [
  'wallet.created',
  'wallet.credited',
  'wallet.debited',
  'wallet.reserved',
  'wallet.released',
  'wallet.closed',
] as const;

// ─── Query options (the façade contract) ───────────────────────────────────

export interface WalletListOptions {
  take?: number;
  skip?: number;
  accountId?: string;
  currency?: string;
}

/** The Prisma Wallet row shape (for backfill). */
export interface PrismaWalletRow {
  id: string;
  accountId: string;
  name: string;
  currency: string;
  balance: number;
  pendingBalance: number;
  lockedBalance: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}
