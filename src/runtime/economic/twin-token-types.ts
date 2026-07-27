/**
 * Twin Token Runtime — Types. (M-RT-25, Economic Kernel.)
 *
 * Every movement of value in PaySwap distinguishes between 4 token types:
 *
 *   1. Claim Token      — Customer's claim on the treasury (wallet balance)
 *   2. Settlement Token — Treasury's internal settlement unit
 *   3. Reserve Token    — Backing reserve (fiat/stablecoin held in custody)
 *   4. Liquidity Token  — LP's contribution to the liquidity pool
 *
 * Value flow:
 *   Wallet → Claim Token → Treasury → Settlement Token → Reserve Token
 *
 * This separation is fully event-sourced. Token balances are DERIVED from
 * events — no mutable balance records.
 *
 * EVENTS:
 *   - twin.minted        — tokens minted (claim → customer, liquidity → LP)
 *   - twin.burned        — tokens burned (claim redeemed, LP withdrawn)
 *   - twin.transferred   — tokens transferred between accounts
 *   - twin.converted     — one token type converted to another (claim → settlement)
 *   - twin.backed        — reserve tokens backing settlement tokens
 *   - twin.unbacked      — reserve tokens unbacked
 */

import type { Environment } from '../types';

// ─── Token Types ───────────────────────────────────────────────────────────

export type TokenType = 'claim' | 'settlement' | 'reserve' | 'liquidity';

/** A Twin Token position (derived from events). */
export interface TwinTokenPosition {
  /** Account ID (wallet ID, treasury account ID, LP ID, reserve ID). */
  accountId: string;
  /** Token type. */
  tokenType: TokenType;
  /** Currency code. */
  currency: string;
  /** Current balance (derived from mint - burn + transferIn - transferOut). */
  balance: number;
  /** Amount backed by reserves (for settlement tokens). */
  backedAmount: number;
  /** Last updated (timestamp of last event). */
  lastUpdated: number;
}

/** View for API responses. */
export interface TwinTokenView {
  positions: TwinTokenPosition[];
  totalByType: Record<TokenType, number>;
  totalByCurrency: Record<string, number>;
}

// ─── Event Payloads ────────────────────────────────────────────────────────

export interface TwinMintedPayload {
  accountId: string;
  tokenType: TokenType;
  currency: string;
  amount: number;
  reason: string;
  backed: boolean;
  mintedAt: number;
}

export interface TwinBurnedPayload {
  accountId: string;
  tokenType: TokenType;
  currency: string;
  amount: number;
  reason: string;
  burnedAt: number;
}

export interface TwinTransferredPayload {
  fromAccountId: string;
  toAccountId: string;
  tokenType: TokenType;
  currency: string;
  amount: number;
  reason: string;
  transferredAt: number;
}

export interface TwinConvertedPayload {
  accountId: string;
  fromTokenType: TokenType;
  toTokenType: TokenType;
  currency: string;
  amount: number;
  fxRate: number;
  reason: string;
  convertedAt: number;
}

export interface TwinBackedPayload {
  settlementAccountId: string;
  reserveAccountId: string;
  currency: string;
  amount: number;
  backedAt: number;
}

export interface TwinUnbackedPayload {
  settlementAccountId: string;
  reserveAccountId: string;
  currency: string;
  amount: number;
  unbackedAt: number;
}

// ─── Stream naming ─────────────────────────────────────────────────────────

export function twinStreamId(env: Environment, accountId: string): string {
  return `${env}:twin:${accountId}`;
}

export const TWIN_EVENT_PREFIXES = ['twin.'] as const;

export const TWIN_EVENT_TYPES = [
  'twin.minted',
  'twin.burned',
  'twin.transferred',
  'twin.converted',
  'twin.backed',
  'twin.unbacked',
] as const;

// ─── Query options ─────────────────────────────────────────────────────────

export interface TwinTokenQuery {
  accountId?: string;
  tokenType?: TokenType;
  currency?: string;
}
