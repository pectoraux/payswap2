/**
 * Treasury Runtime Engine — Types. (M-RT-24, Treasury Kernel.)
 *
 * The Treasury is the financial source of truth. It owns 5 account types:
 *
 *   1. Reserve Accounts   — fiat/stablecoin reserves backing TwinTokens
 *   2. Treasury Accounts  — operational treasury positions
 *   3. LP Positions       — liquidity provider stakes + returns
 *   4. FX Inventory       — foreign exchange positions per currency pair
 *   5. Settlement Accounts — pending settlement positions
 *
 * Everything else (wallets, payments, payouts, invoices) references treasury
 * rather than owning balances independently.
 *
 * All balances are DERIVED from events — no mutable balance records.
 *
 * Events (8):
 *   - treasury.account.created     — account created (balance = 0)
 *   - treasury.account.credited    — funds added
 *   - treasury.account.debited     — funds removed
 *   - treasury.position.opened     — LP/FX position opened
 *   - treasury.position.closed     — LP/FX position closed
 *   - treasury.transfer.requested  — transfer between accounts
 *   - treasury.transfer.executed   — transfer completed
 *   - treasury.reconciliation.run  — reconciliation event
 */

import type { Environment } from '../../types';

// ─── Account Types ─────────────────────────────────────────────────────────

export type AccountKind = 'reserve' | 'treasury' | 'lp_position' | 'fx_inventory' | 'settlement';

/** The canonical TreasuryAccountView. Frozen contract. */
export interface TreasuryAccountView {
  id: string;
  kind: AccountKind;
  ownerId: string;
  currency: string;
  availableBalance: number;
  reservedBalance: number;
  totalBalance: number;
  /** For LP positions: the LP ID. For FX: the currency pair. For reserves: the reserve ID. */
  reference: string | null;
  /** Whether the account is active. */
  isActive: boolean;
  createdAt: Date;
  lastUpdated: Date;
}

// ─── Event payloads ────────────────────────────────────────────────────────

export interface TreasuryAccountCreatedPayload {
  accountId: string;
  kind: AccountKind;
  ownerId: string;
  currency: string;
  reference: string | null;
  environment: string;
  createdAt: number;
}

export interface TreasuryAccountCreditedPayload {
  accountId: string;
  amount: number;
  currency: string;
  reason: string;
  counterparty: string | null;
  creditedAt: number;
}

export interface TreasuryAccountDebitedPayload {
  accountId: string;
  amount: number;
  currency: string;
  reason: string;
  counterparty: string | null;
  debitedAt: number;
}

export interface TreasuryPositionOpenedPayload {
  accountId: string;
  positionType: 'lp' | 'fx';
  reference: string;
  amount: number;
  currency: string;
  terms: string | null;
  openedAt: number;
}

export interface TreasuryPositionClosedPayload {
  accountId: string;
  closeAmount: number;
  reason: string;
  closedAt: number;
}

export interface TreasuryTransferRequestedPayload {
  transferId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  currency: string;
  reason: string;
  requestedAt: number;
}

export interface TreasuryTransferExecutedPayload {
  transferId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  currency: string;
  executedAt: number;
}

export interface TreasuryReconciliationRunPayload {
  reconciliationId: string;
  totalAccounts: number;
  totalBalance: number;
  discrepancies: number;
  reconciledAt: number;
}

// ─── Stream naming ─────────────────────────────────────────────────────────

export function treasuryStreamId(env: Environment, accountId: string): string {
  return `${env}:treasury:${accountId}`;
}

export const TREASURY_EVENT_PREFIXES = ['treasury.'] as const;

export const TREASURY_EVENT_TYPES = [
  'treasury.account.created',
  'treasury.account.credited',
  'treasury.account.debited',
  'treasury.position.opened',
  'treasury.position.closed',
  'treasury.transfer.requested',
  'treasury.transfer.executed',
  'treasury.reconciliation.run',
] as const;

// ─── Query options ─────────────────────────────────────────────────────────

export interface TreasuryListOptions {
  take?: number;
  skip?: number;
  kind?: AccountKind;
  ownerId?: string;
  currency?: string;
}

// ─── Prisma row (for backfill — maps from existing reserves/LP data) ───────

export interface PrismaTreasuryRow {
  id: string;
  kind: AccountKind;
  ownerId: string;
  currency: string;
  balance: number;
  reservedBalance: number;
  reference: string | null;
  createdAt: Date;
}
