/**
 * PaySwap Protocol — High-Level Stellar Settlement Helpers.
 *
 * These functions compose low-level `StellarChainAdapter` operations into
 * the settlement flows PaySwap actually needs:
 *
 *   - settleTwinTokenTransfer      — ensure trustlines, transfer, verify
 *   - settleTwinTokenBurn          — burn + verify
 *   - settleTwinTokenMint          — issuer mint + verify
 *   - settleWithClaimableBalance   — async settlement via claimable balance
 *   - verifySettlement             — confirm a settlement tx on-chain
 *   - reconcileSettlement          — verify tx amount matches expectations
 *
 * Every helper returns a `SettlementResult` carrying the on-chain `txHash`,
 * the kernel `Evidence`, and a `confirmed` flag. They NEVER throw — failures
 * are returned as `{ success: false, error }`.
 */
import type { Evidence } from '@/kernel/evidence';
import type { ChainMemo, ClaimPredicate } from '../adapter';
import { stellarChainAdapter } from './adapter';
import { isNative, isTwinToken, twinTokenCode } from './assets';

export interface SettlementResult {
  success: boolean;
  txHash?: string;
  balanceId?: string;
  confirmed: boolean;
  evidence?: Evidence;
  error?: string;
  mode?: 'simulation' | 'live';
  network?: 'testnet' | 'mainnet' | 'devnet' | 'custom';
}

// ============================================================================
// settleTwinTokenTransfer
// ============================================================================

/**
 * Settle a twin-token transfer between two accounts.
 *
 * Flow:
 *   1. Ensure both accounts have a trustline to the asset (skipped for native XLM).
 *   2. Execute the on-chain transfer with the supplied memo.
 *   3. Verify the transaction was confirmed.
 *
 * Returns evidence from the verify step (cryptographic, on-chain).
 */
export async function settleTwinTokenTransfer(params: {
  from: string;
  to: string;
  assetCode: string;
  amount: number;
  memo?: string;
  issuer?: string;
}): Promise<SettlementResult> {
  const { from, to, assetCode, amount, memo, issuer } = params;
  if (amount <= 0) return { success: false, confirmed: false, error: 'amount_must_be_positive' };
  if (!from || !to) return { success: false, confirmed: false, error: 'from_and_to_required' };

  // 1. Ensure trustlines (idempotent).
  if (!isNative(assetCode)) {
    await stellarChainAdapter.createTrustline({ account: from, assetCode, issuer });
    if (from !== to) {
      await stellarChainAdapter.createTrustline({ account: to, assetCode, issuer });
    }
  }

  // 2. Execute transfer.
  const memoObj: ChainMemo | undefined = memo ? { kind: 'text', value: memo } : undefined;
  const xfer = await stellarChainAdapter.transfer({
    assetCode,
    amount,
    from,
    to,
    memo: memoObj,
    issuer,
  });
  if (!xfer.success || !xfer.txHash) {
    return {
      success: false,
      confirmed: false,
      error: xfer.error ?? 'transfer_failed',
      mode: xfer.mode,
      network: xfer.network,
    };
  }

  // 3. Verify (in sim mode this is synchronous; in live mode it queries Horizon).
  const verify = await stellarChainAdapter.verifyTransaction({ txHash: xfer.txHash });
  return {
    success: verify.success && (verify.confirmed ?? false),
    txHash: xfer.txHash,
    confirmed: verify.confirmed ?? false,
    evidence: verify.evidence ?? xfer.evidence,
    mode: xfer.mode,
    network: xfer.network,
    error: verify.error,
  };
}

// ============================================================================
// settleTwinTokenBurn
// ============================================================================

/**
 * Settle a twin-token burn (redeem for fiat). The holder burns `amount` of
 * `assetCode` on-chain.
 */
export async function settleTwinTokenBurn(params: {
  from: string;
  assetCode: string;
  amount: number;
}): Promise<SettlementResult> {
  const { from, assetCode, amount } = params;
  if (amount <= 0) return { success: false, confirmed: false, error: 'amount_must_be_positive' };
  if (!from) return { success: false, confirmed: false, error: 'from_required' };

  const burn = await stellarChainAdapter.burnAsset({ assetCode, amount, from });
  if (!burn.success || !burn.txHash) {
    return {
      success: false,
      confirmed: false,
      error: burn.error ?? 'burn_failed',
      mode: burn.mode,
      network: burn.network,
    };
  }
  const verify = await stellarChainAdapter.verifyTransaction({ txHash: burn.txHash });
  return {
    success: verify.success && (verify.confirmed ?? false),
    txHash: burn.txHash,
    confirmed: verify.confirmed ?? false,
    evidence: verify.evidence ?? burn.evidence,
    mode: burn.mode,
    network: burn.network,
    error: verify.error,
  };
}

// ============================================================================
// settleTwinTokenMint
// ============================================================================

/**
 * Settle a twin-token mint — the issuer mints `amount` to `to`.
 *
 * For non-twin-token assets, the caller must supply the issuer explicitly.
 */
export async function settleTwinTokenMint(params: {
  to: string;
  assetCode: string;
  amount: number;
  issuer: string;
}): Promise<SettlementResult> {
  const { to, assetCode, amount, issuer } = params;
  if (amount <= 0) return { success: false, confirmed: false, error: 'amount_must_be_positive' };
  if (!to) return { success: false, confirmed: false, error: 'to_required' };
  if (!issuer) return { success: false, confirmed: false, error: 'issuer_required' };

  // Ensure the recipient has a trustline.
  if (!isNative(assetCode)) {
    await stellarChainAdapter.createTrustline({ account: to, assetCode, issuer });
  }

  const issue = await stellarChainAdapter.issueAsset({ assetCode, amount, to, issuer });
  if (!issue.success || !issue.txHash) {
    return {
      success: false,
      confirmed: false,
      error: issue.error ?? 'mint_failed',
      mode: issue.mode,
      network: issue.network,
    };
  }
  const verify = await stellarChainAdapter.verifyTransaction({ txHash: issue.txHash });
  return {
    success: verify.success && (verify.confirmed ?? false),
    txHash: issue.txHash,
    confirmed: verify.confirmed ?? false,
    evidence: verify.evidence ?? issue.evidence,
    mode: issue.mode,
    network: issue.network,
    error: verify.error,
  };
}

// ============================================================================
// settleWithClaimableBalance (async settlement)
// ============================================================================

/**
 * Settle asynchronously via a Stellar claimable balance. The sender locks
 * the funds in a claimable balance that the recipient can claim once the
 * predicate is satisfied (e.g. time-locked until a fiat confirmation).
 *
 * Returns the `balanceId` — the recipient uses `claimSettlementBalance()`
 * (or `adapter.claimBalance`) to release the funds.
 */
export async function settleWithClaimableBalance(params: {
  from: string;
  assetCode: string;
  amount: number;
  claimant: string;
  predicate: ClaimPredicate;
  issuer?: string;
}): Promise<SettlementResult> {
  const { from, assetCode, amount, claimant, predicate, issuer } = params;
  if (amount <= 0) return { success: false, confirmed: false, error: 'amount_must_be_positive' };
  if (!from || !claimant) return { success: false, confirmed: false, error: 'from_and_claimant_required' };

  const res = await stellarChainAdapter.createClaimableBalance({
    assetCode,
    amount,
    source: from,
    claimants: [{ destination: claimant, predicate }],
    issuer,
  });
  if (!res.success || !res.balanceId) {
    return {
      success: false,
      confirmed: false,
      error: res.error ?? 'create_claimable_balance_failed',
      mode: res.mode,
      network: res.network,
    };
  }
  return {
    success: true,
    balanceId: res.balanceId,
    txHash: res.txHash,
    confirmed: true, // claimable balance creation is the on-chain commitment
    evidence: res.evidence,
    mode: res.mode,
    network: res.network,
  };
}

/**
 * Claim a previously-created settlement balance. Returns the claim tx hash.
 */
export async function claimSettlementBalance(params: {
  balanceId: string;
  claimant: string;
}): Promise<SettlementResult> {
  const { balanceId, claimant } = params;
  if (!balanceId || !claimant) return { success: false, confirmed: false, error: 'balanceId_and_claimant_required' };
  const res = await stellarChainAdapter.claimBalance({ balanceId, claimant });
  if (!res.success || !res.txHash) {
    return {
      success: false,
      confirmed: false,
      error: res.error ?? 'claim_failed',
      mode: res.mode,
      network: res.network,
    };
  }
  const verify = await stellarChainAdapter.verifyTransaction({ txHash: res.txHash });
  return {
    success: verify.success && (verify.confirmed ?? false),
    txHash: res.txHash,
    confirmed: verify.confirmed ?? false,
    evidence: verify.evidence ?? res.evidence,
    mode: res.mode,
    network: res.network,
    error: verify.error,
  };
}

// ============================================================================
// verifySettlement + reconcileSettlement
// ============================================================================

/**
 * Verify that a settlement transaction is confirmed on-chain. Returns the
 * cryptographic evidence.
 */
export async function verifySettlement(txHash: string): Promise<SettlementResult> {
  if (!txHash) return { success: false, confirmed: false, error: 'txHash_required' };
  const verify = await stellarChainAdapter.verifyTransaction({ txHash });
  return {
    success: verify.success && (verify.confirmed ?? false),
    txHash,
    confirmed: verify.confirmed ?? false,
    evidence: verify.evidence,
    mode: verify.mode,
    network: verify.network,
    error: verify.error,
  };
}

/**
 * Reconcile a settlement: verify the tx is confirmed AND that the
 * on-chain amount matches `expectedAmount`.
 *
 * In sim mode, the amount is read from the recorded tx payload.
 * In live mode (future), it is read from the Horizon operation effects.
 */
export async function reconcileSettlement(txHash: string, expectedAmount: number): Promise<SettlementResult & { actualAmount?: number }> {
  if (!txHash) return { success: false, confirmed: false, error: 'txHash_required' };
  if (expectedAmount <= 0) return { success: false, confirmed: false, error: 'expected_amount_must_be_positive' };
  const verify = await stellarChainAdapter.verifyTransaction({ txHash });
  if (!verify.success || !verify.confirmed) {
    return {
      success: false,
      confirmed: verify.confirmed ?? false,
      txHash,
      error: verify.error ?? 'tx_not_confirmed',
      mode: verify.mode,
      network: verify.network,
    };
  }
  // Extract amount from the transaction's payload (sim mode) or effects (live).
  const tx = verify.transaction;
  let actualAmount: number | undefined;
  if (tx) {
    // Sim-mode records stash the amount in the evidence payload.
    const raw = (verify.evidence?.payload as { amount?: number }) ?? undefined;
    if (typeof raw?.amount === 'number') actualAmount = raw.amount;
  }
  const matches = actualAmount != null && Math.abs(actualAmount - expectedAmount) < 1e-7;
  return {
    success: matches,
    txHash,
    confirmed: true,
    actualAmount,
    evidence: verify.evidence,
    mode: verify.mode,
    network: verify.network,
    error: matches ? undefined : `amount_mismatch: expected=${expectedAmount} actual=${actualAmount ?? 'unknown'}`,
  };
}

// ============================================================================
// Convenience: derive a twin-token asset code from a currency
// ============================================================================

/** Helper: get the twin-token asset code for a fiat currency. */
export function twinAssetCode(currency: string): string {
  return twinTokenCode(currency);
}

/** Helper: is this asset a twin token? */
export function isTwinAsset(code: string): boolean {
  return isTwinToken(code);
}
