/**
 * PaySwap Protocol — Chain Abstraction Layer barrel.
 *
 * Auto-registers Stellar as the default chain on import. Ethereum, Base,
 * and Polygon stubs are also exported (but NOT auto-registered — register
 * them explicitly when their implementations come online).
 *
 * Usage:
 *   import { chainRegistry, stellarChainAdapter } from '@/protocol/chains';
 *   const adapter = chainRegistry.default();        // → stellarChainAdapter
 *   await adapter.transfer({ assetCode: 'TWINGHS', issuer, amount, from, to });
 */
import type { ChainAdapter } from './adapter';
import { chainRegistry } from './registry';
import { stellarChainAdapter, StellarAdapter, stellarNetwork, StellarNetwork } from './stellar/adapter';
import {
  twinTokenCode,
  nativeAsset,
  isTwinToken,
  twinTokenCurrency,
  assetMetadata,
  stellarAssetKey,
  parseStellarAssetKey,
  isValidAssetCode,
  syntheticIssuerAddress,
  NATIVE_ASSET_CODE,
} from './stellar/assets';
import {
  settleTwinTokenTransfer,
  settleTwinTokenBurn,
  settleTwinTokenMint,
  settleWithClaimableBalance,
  verifySettlement,
  settleNativeTransfer,
} from './stellar/settlement';
import { EthereumAdapter, ethereumChainAdapter } from './ethereum/adapter';
import { BaseAdapter, baseChainAdapter } from './base/adapter';
import { PolygonAdapter, polygonChainAdapter } from './polygon/adapter';

/* ============================================================================
 * Auto-register Stellar as the default chain on first import.
 * Idempotent — safe to import from multiple modules.
 * ========================================================================== */
if (!chainRegistry.isRegistered('stellar')) {
  chainRegistry.register(stellarChainAdapter);
}

/* ============================================================================
 * Re-exports.
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
} from './adapter';
export { assetKey, makeAsset } from './adapter';
export { chainRegistry } from './registry';
export {
  stellarChainAdapter,
  StellarAdapter,
  stellarNetwork,
  StellarNetwork,
} from './stellar/adapter';
export {
  twinTokenCode,
  nativeAsset,
  isTwinToken,
  twinTokenCurrency,
  assetMetadata,
  stellarAssetKey,
  parseStellarAssetKey,
  isValidAssetCode,
  syntheticIssuerAddress,
  NATIVE_ASSET_CODE,
} from './stellar/assets';
export type { StellarAssetMetadata } from './stellar/assets';
export {
  settleTwinTokenTransfer,
  settleTwinTokenBurn,
  settleTwinTokenMint,
  settleWithClaimableBalance,
  verifySettlement,
  settleNativeTransfer,
} from './stellar/settlement';
export type {
  SettlementResult,
  TwinTokenTransferParams,
  TwinTokenBurnParams,
  TwinTokenMintParams,
  ClaimableBalanceSettlementParams,
} from './stellar/settlement';
export { EthereumAdapter, ethereumChainAdapter } from './ethereum/adapter';
export { BaseAdapter, baseChainAdapter } from './base/adapter';
export { PolygonAdapter, polygonChainAdapter } from './polygon/adapter';

/** Convenience — registered adapter for a chain (or Stellar by default). */
export function getChainAdapter(chain?: string): ChainAdapter {
  if (!chain) {
    const def = chainRegistry.default();
    if (!def) throw new Error('No chain adapter registered');
    return def;
  }
  const a = chainRegistry.get(chain);
  if (!a) throw new Error(`Chain adapter not registered: ${chain}`);
  return a;
}
