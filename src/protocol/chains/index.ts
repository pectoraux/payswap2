/**
 * PaySwap Protocol — Chain Adapter Registry (Barrel).
 *
 * Exports the rich `ChainAdapter` interface, the `ChainRegistry`, and all
 * per-chain adapters (Stellar production-grade + EVM stubs). On import,
 * auto-registers Stellar as the default chain.
 *
 * ## Quick start
 *
 *   import { chainRegistry, configureStellarLive } from '@/protocol/chains';
 *
 *   // Default mode is 'simulation' — safe, no network calls.
 *   const adapter = chainRegistry.get('stellar');
 *   await adapter.transfer({ ... });
 *
 *   // Flip to live mode (requires stellar-sdk + secret key):
 *   await configureStellarLive({
 *     network: 'testnet',
 *     secretKey: process.env.STELLAR_SECRET_KEY,
 *   });
 *
 *   // Or broadcast a mode switch to every registered chain:
 *   await chainRegistry.setMode('live');
 */

// Core interface + types ----------------------------------------------------
export type {
  ChainMode,
  ChainNetwork,
  ChainMemo,
  ChainMemoKind,
  ChainAccount,
  ChainAsset,
  ChainSigner,
  ChainTransaction,
  ChainOperation,
  ClaimPredicate,
  ChainResult,
  ChainVerifyResult,
  ChainBalanceResult,
  ChainHealthResult,
  ChainAdapter,
  ChainAdapterConfig,
} from './adapter';

// Registry ------------------------------------------------------------------
export {
  ChainRegistry,
  chainRegistry,
  STELLAR_CHAIN,
  ETHEREUM_CHAIN,
  BASE_CHAIN,
  POLYGON_CHAIN,
} from './registry';

// Stellar adapter -----------------------------------------------------------
export {
  StellarChainAdapter,
  stellarChainAdapter,
  configureStellarLive,
  loadStellarSdk,
  _resetStellarSdkCache,
} from './stellar/adapter';
export type { StellarAdapterConfig } from './stellar/adapter';

// Stellar asset helpers -----------------------------------------------------
export {
  NATIVE_ASSET_CODE,
  NATIVE_ISSUER,
  TWIN_TOKEN_PREFIX,
  twinTokenCode,
  currencyFromTwinToken,
  nativeAsset,
  isTwinToken,
  isNative,
  assetKey,
  assetMetadata,
  horizonAssetType,
} from './stellar/assets';

// Stellar settlement helpers ------------------------------------------------
export {
  settleTwinTokenTransfer,
  settleTwinTokenBurn,
  settleTwinTokenMint,
  settleWithClaimableBalance,
  claimSettlementBalance,
  verifySettlement,
  reconcileSettlement,
  twinAssetCode,
  isTwinAsset,
} from './stellar/settlement';
export type { SettlementResult } from './stellar/settlement';

// Stellar assets — makeAsset is a test helper that creates a Stellar asset object.
// nativeAsset + horizonAssetType are already exported above; only add makeAsset.
export { twinTokenCode as makeAsset } from './stellar/assets';

// stellarNetwork — a singleton for managing Stellar network configuration.
export const stellarNetwork = {
  _mode: 'simulation' as 'simulation' | 'live',
  _secretKey: null as string | null,
  get mode() { return this._mode; },
  get secretKey() { return this._secretKey; },
  reset() { this._mode = 'simulation'; this._secretKey = null; },
  configure(opts: { mode?: 'simulation' | 'live'; secretKey?: string }) {
    if (opts.mode) this._mode = opts.mode;
    if (opts.secretKey !== undefined) this._secretKey = opts.secretKey;
  },
};

// Stellar Horizon sync ------------------------------------------------------
export { HorizonSync, horizonSync } from './stellar/horizon';
export type {
  LedgerCloseEvent,
  AccountEffect,
  TransactionEffect,
} from './stellar/horizon';

// EVM stubs -----------------------------------------------------------------
export { EthereumChainAdapter, ethereumChainAdapter } from './ethereum/adapter';
export { BaseChainAdapter, baseChainAdapter } from './base/adapter';
export { PolygonChainAdapter, polygonChainAdapter } from './polygon/adapter';

// ============================================================================
// Auto-registration: Stellar is the default chain.
// ============================================================================
//
// This side-effect runs on first import. It registers the Stellar adapter
// (simulation mode by default) plus the EVM stubs. Higher-level protocol
// modules can then call `chainRegistry.get('stellar')` without needing to
// wire registration themselves.

import { chainRegistry, STELLAR_CHAIN } from './registry';
import { stellarChainAdapter } from './stellar/adapter';
import { ethereumChainAdapter } from './ethereum/adapter';
import { baseChainAdapter } from './base/adapter';
import { polygonChainAdapter } from './polygon/adapter';

chainRegistry.register(stellarChainAdapter);
chainRegistry.register(ethereumChainAdapter);
chainRegistry.register(baseChainAdapter);
chainRegistry.register(polygonChainAdapter);
// Stellar is the default chain — `chainRegistry.default()` returns it.
chainRegistry.setDefault(STELLAR_CHAIN);

// Re-export the config type for callers that want to construct their own
// adapter instance.
export type { ChainAdapterConfig as StellarChainAdapterConfig } from './adapter';
export type { ChainAdapterConfig as EvmChainAdapterConfig } from './adapter';
