/**
 * PaySwap Protocol — Blockchain Adapter Interface (BACKWARD-COMPAT SHIM).
 *
 * DEPRECATED: This module is preserved verbatim for backward compatibility
 * with existing twin-token / payouts / wallets / blockchain code. New code
 * should use the rich `ChainAdapter` interface from `@/protocol/chains`.
 *
 * What this module re-exports:
 *   - `BlockchainAdapter` interface (OLD, preserved verbatim — do NOT change)
 *   - `BlockchainAdapterRegistry` class (OLD, preserved verbatim)
 *   - `blockchainRegistry` singleton (OLD, preserved verbatim)
 *   - `chainRegistry` (NEW) — proxied re-export for consumers that want
 *     the new interface without changing their import path
 *   - All new types (`ChainAdapter`, `ChainResult`, etc.)
 *
 * The old API is preserved 1:1 so existing callers don't need edits. The
 * new `chainRegistry` lives in `../chains/registry`; this file re-exports
 * it so importers can use either.
 *
 * Frozen-kernel compliance: imports only `Evidence` from `@/kernel/evidence`.
 */
import type { Evidence } from '@/kernel/evidence';

/* ============================================================================
 * OLD BlockchainAdapter interface — preserved verbatim for backward compat.
 * New code: use `ChainAdapter` from `@/protocol/chains/adapter` instead.
 * ========================================================================== */
export interface BlockchainAdapter {
  chain: string;
  isInitialized: boolean;

  /** Issue (mint) an asset on-chain. */
  issueAsset(params: {
    assetCode: string;
    amount: number;
    issuer: string;
  }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }>;

  /** Burn an asset on-chain. */
  burnAsset(params: {
    assetCode: string;
    amount: number;
    from: string;
  }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }>;

  /** Transfer an asset between accounts. */
  transfer(params: {
    assetCode: string;
    amount: number;
    from: string;
    to: string;
    memo?: string;
  }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }>;

  /** Verify a transaction on-chain. */
  verify(params: {
    txHash: string;
  }): Promise<{ success: boolean; confirmed: boolean; evidence?: Evidence; error?: string }>;

  /** Get balance of an account for an asset. */
  getBalance(params: {
    address: string;
    assetCode: string;
  }): Promise<{ success: boolean; balance: number; evidence?: Evidence; error?: string }>;

  /** Submit a raw transaction. */
  submitTransaction(params: {
    signedTx: string;
  }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }>;

  /** Create escrow account (multisig/time-locked). */
  createEscrow(params: {
    amount: number;
    assetCode: string;
    signer1: string;
    signer2: string;
    unlockTime?: number;
  }): Promise<{ success: boolean; escrowAddress?: string; evidence?: Evidence; error?: string }>;

  /** Health check. */
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;
}

/* ============================================================================
 * OLD BlockchainAdapterRegistry — preserved verbatim for backward compat.
 * ========================================================================== */
export class BlockchainAdapterRegistry {
  private adapters: Map<string, BlockchainAdapter> = new Map();

  register(adapter: BlockchainAdapter): void {
    this.adapters.set(adapter.chain, adapter);
  }

  get(chain: string): BlockchainAdapter | undefined {
    return this.adapters.get(chain);
  }

  all(): BlockchainAdapter[] {
    return [...this.adapters.values()];
  }

  chains(): string[] {
    return [...this.adapters.keys()];
  }

  isRegistered(chain: string): boolean {
    return this.adapters.has(chain);
  }
}

export const blockchainRegistry = new BlockchainAdapterRegistry();

/* ============================================================================
 * NEW ChainAdapter / chainRegistry — re-exported for new consumers.
 * ========================================================================== */
export type {
  ChainAdapter,
  ChainAccount,
  ChainAsset,
  ChainMemo,
  ChainOperation,
  ChainTransaction,
  ChainResult,
  AccountResult,
  BalanceResult,
  BalancesResult,
  TxResult,
  VerifyResult,
  EscrowResult,
  ClaimableBalanceResult,
  ClaimableBalancesResult,
  SequenceResult,
  LedgerResult,
  LedgerEntryResult,
  HealthResult,
  PathPaymentResult,
  ClaimPredicate,
  MemoType,
  LedgerStreamCallback,
  CreateAccountParams,
  FundAccountParams,
  RegisterAssetParams,
  IssueAssetParams,
  BurnAssetParams,
  CreateTrustlineParams,
  TransferParams,
  PathPaymentParams,
  CreateClaimableBalanceParams,
  CreateEscrowAccountParams,
  ReleaseEscrowParams,
  SponsorReserveParams,
  FeeBumpParams,
  AddSignerParams,
  RemoveSignerParams,
  SetThresholdsParams,
  GetBalanceParams,
  VerifyTransactionParams,
  GetLedgerEntryParams,
} from '../chains/adapter';
export { assetKey, makeAsset } from '../chains/adapter';
export { chainRegistry } from '../chains/registry';
