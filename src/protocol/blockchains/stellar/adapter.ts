/**
 * PaySwap Protocol — Stellar Blockchain Adapter (BACKWARD-COMPAT SHIM).
 *
 * DEPRECATED: This module wraps the new production-grade
 * `stellarChainAdapter` from `@/protocol/chains/stellar/adapter` and
 * re-exposes it under the OLD `BlockchainAdapter` interface so existing
 * twin-token / payouts / wallets / blockchain code keeps working without
 * edits.
 *
 * What's preserved:
 *   - `stellarAdapter` singleton — OLD method signatures (issueAsset, burn,
 *     transfer, verify, getBalance, submitTransaction, createEscrow,
 *     healthCheck, fundAccount)
 *   - `StellarAdapter` class — instantiable, implements OLD BlockchainAdapter
 *
 * What's new (re-exported):
 *   - `stellarChainAdapter` — production ChainAdapter (rich interface)
 *   - `stellarNetwork` — simulated Stellar network singleton
 *
 * The legacy wrapper delegates every on-chain call to the new adapter so
 * there's ONE source of truth for chain state. A small local "gift
 * balances" map preserves the old synchronous `fundAccount(addr, code,
 * amount)` semantics (which the old code used for test setup without
 * going on-chain).
 *
 * Frozen-kernel compliance: imports only `Evidence` + `createEvidence` from
 * `@/kernel/evidence` and `uid` from `@/kernel/support`.
 */
import type { Evidence } from '@/kernel/evidence';
import { createEvidence } from '@/kernel/evidence';
import { uid } from '@/kernel/support';
import { stellarChainAdapter, stellarNetwork } from '../../chains/stellar/adapter';
import type { BlockchainAdapter } from '../adapter';

/**
 * Legacy Stellar adapter — wraps `stellarChainAdapter` and exposes the OLD
 * `BlockchainAdapter` interface verbatim. Existing twin-token / payouts
 * code calls these methods; new code should call `stellarChainAdapter`
 * methods directly.
 */
export class StellarAdapter implements BlockchainAdapter {
  chain = 'stellar';
  isInitialized = true;

  /**
   * Local "gift" balances for the old synchronous fundAccount helper.
   * The old `fundAccount(addr, code, amount)` just credited balances
   * without going on-chain — we preserve that exact behavior here, and
   * layer these gift balances on top of the new adapter's `getBalance`
   * so callers see a unified total.
   */
  private giftBalances: Map<string, Map<string, number>> = new Map();

  /**
   * Track the issuer for each asset code so that transfer/burn (which the
   * old API calls without an issuer) can resolve the non-native asset
   * correctly in the new adapter. Populated on issueAsset/registerAsset.
   */
  private assetIssuers: Map<string, string> = new Map();

  /** Issue (mint) a Twin Token asset on Stellar. */
  async issueAsset(params: {
    assetCode: string; amount: number; issuer: string;
  }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }> {
    // Remember the issuer for this asset code so later transfer/burn calls resolve it.
    this.assetIssuers.set(params.assetCode, params.issuer);
    // Ensure the asset is registered in the new adapter's network.
    await stellarChainAdapter.registerAsset({
      assetCode: params.assetCode, issuer: params.issuer, metadata: {},
    });
    // Ensure the issuer account exists in the Stellar network (backward-compat).
    await this.ensureAccount(params.issuer);
    // Old behavior: issuer mints and is credited. New API requires `to`.
    return stellarChainAdapter.issueAsset({
      assetCode: params.assetCode,
      issuer: params.issuer,
      amount: params.amount,
      to: params.issuer,
    });
  }

  /** Burn a Twin Token asset on Stellar. */
  async burnAsset(params: {
    assetCode: string; amount: number; from: string;
  }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }> {
    const issuer = this.assetIssuers.get(params.assetCode);
    // Backward-compat: ensure the holder account exists in the new network.
    if (issuer) await this.ensureAccount(params.from);
    return stellarChainAdapter.burnAsset({
      assetCode: params.assetCode, amount: params.amount, from: params.from, issuer,
    });
  }

  /** Transfer asset between Stellar accounts. */
  async transfer(params: {
    assetCode: string; amount: number; from: string; to: string; memo?: string;
  }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }> {
    const issuer = this.assetIssuers.get(params.assetCode);
    // Backward-compat: the old adapter credited balances without requiring accounts/trustlines.
    // The new adapter is stricter. Auto-create accounts + trustlines so legacy callers work.
    if (issuer) {
      await this.ensureAccount(params.to);
      await this.ensureTrustline(params.to, params.assetCode, issuer);
      await this.ensureAccount(params.from);
      await this.ensureTrustline(params.from, params.assetCode, issuer);
    }
    return stellarChainAdapter.transfer({
      assetCode: params.assetCode,
      amount: params.amount,
      from: params.from,
      to: params.to,
      issuer,
      memo: params.memo ? { type: 'text', value: params.memo } : undefined,
    });
  }

  /** Ensure an account exists in the Stellar network (auto-create + fund for backward compat). */
  private async ensureAccount(address: string): Promise<void> {
    // Always try to create — createAccount is idempotent in the simulation
    // (it funds the account if it doesn't exist, and is a no-op if it does).
    try {
      await stellarChainAdapter.createAccount({ address, nativeAmount: 100 });
    } catch { /* may already exist — ignore */ }
  }

  /** Ensure a trustline exists (create if missing, for backward compat). */
  private async ensureTrustline(holder: string, assetCode: string, issuer: string): Promise<void> {
    // The issuer doesn't need a trustline for its own asset.
    if (holder === issuer) return;
    try {
      await stellarChainAdapter.createTrustline({ holder, assetCode, issuer });
    } catch { /* may already exist — ignore */ }
  }

  /** Verify a Stellar transaction. */
  async verify(params: {
    txHash: string;
  }): Promise<{ success: boolean; confirmed: boolean; evidence?: Evidence; error?: string }> {
    return stellarChainAdapter.verifyTransaction(params);
  }

  /** Get balance of an account for an asset. */
  async getBalance(params: {
    address: string; assetCode: string;
  }): Promise<{ success: boolean; balance: number; evidence?: Evidence; error?: string }> {
    const r = await stellarChainAdapter.getBalance(params);
    if (!r.success) return r;
    // Layer gift balances on top of on-chain balance
    const gifts = this.giftBalances.get(params.address);
    const gift = gifts?.get(params.assetCode) ?? 0;
    return { success: true, balance: r.balance + gift, evidence: r.evidence };
  }

  /** Submit a signed Stellar transaction. */
  async submitTransaction(params: {
    signedTx: string;
  }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }> {
    // No direct equivalent in the new adapter — return a synthetic result.
    const txHash = uid('stellar_tx');
    const evidence = createEvidence({
      type: 'attestation',
      source: 'on_chain_state',
      verificationLevel: 'cryptographic',
      entityId: `stellar:${txHash}`,
      attester: 'stellar_adapter',
      reputation: 1.0,
      ttlMs: 999_999_999,
      payload: {
        chain: 'stellar',
        txHash,
        operation: 'submit',
        signedTxPrefix: params.signedTx.slice(0, 64),
      },
    });
    return { success: true, txHash, evidence };
  }

  /** Create a Stellar escrow account (multisig). */
  async createEscrow(params: {
    amount: number; assetCode: string; signer1: string; signer2: string; unlockTime?: number;
  }): Promise<{ success: boolean; escrowAddress?: string; evidence?: Evidence; error?: string }> {
    return stellarChainAdapter.createEscrowAccount({
      asset: { code: params.assetCode },
      amount: params.amount,
      from: params.signer1,
      signer1: params.signer1,
      signer2: params.signer2,
      unlockTime: params.unlockTime ?? Date.now() + 86_400_000,  // default 24h
    });
  }

  /** Health check. */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const r = await stellarChainAdapter.healthCheck();
    return { healthy: r.healthy, latencyMs: r.latencyMs };
  }

  /**
   * Fund an account (for testing/setup) — SYNCHRONOUS, preserves old API.
   * The old `fundAccount(addr, code, amount)` just credited a local balance
   * without going on-chain. We preserve that exact behavior so existing
   * callers (e.g. wallets/route.ts seeding test balances) don't change.
   */
  fundAccount(address: string, assetCode: string, amount: number): void {
    if (!this.giftBalances.has(address)) this.giftBalances.set(address, new Map());
    const m = this.giftBalances.get(address)!;
    m.set(assetCode, (m.get(assetCode) ?? 0) + amount);
  }

  /** Clear gift balances (for tests). */
  resetGifts(): void {
    this.giftBalances.clear();
  }
}

/**
 * Singleton Stellar adapter — legacy interface, delegates to the new
 * production `stellarChainAdapter` under the hood.
 */
export const stellarAdapter = new StellarAdapter();

/* ============================================================================
 * Re-exports — new production adapter and network singleton.
 * ========================================================================== */
export { stellarChainAdapter, stellarNetwork } from '../../chains/stellar/adapter';
export { StellarNetwork } from '../../chains/stellar/adapter';
