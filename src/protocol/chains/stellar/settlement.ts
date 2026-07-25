/**
 * PaySwap Protocol — Settlement Helpers (Stellar).
 *
 * High-level settlement operations built on top of the Stellar `ChainAdapter`.
 * These compose multiple adapter calls into business-meaningful flows used
 * by the payout service, twin-token engine, and settlement orchestrator.
 *
 * Each helper:
 *   1. Ensures preconditions (trustlines exist, accounts are funded)
 *   2. Performs the on-chain operation
 *   3. Verifies inclusion in a closed ledger
 *   4. Returns the cryptographic Evidence
 *
 * All flows go through `stellarChainAdapter` — the protocol layer never
 * touches `stellar-sdk` directly.
 */
import type { Evidence } from '@/kernel/evidence';
import type { ChainAsset, ClaimPredicate } from '../adapter';
import { stellarChainAdapter } from './adapter';
import { twinTokenCode, isTwinToken, NATIVE_ASSET_CODE } from './assets';

export interface SettlementResult {
  success: boolean;
  txHash?: string;
  evidence?: Evidence;
  error?: string;
  ledger?: number;
}

export interface TwinTokenTransferParams {
  from: string;
  to: string;
  currency: string;        // e.g. 'GHS' — auto-converted to TWINGHS
  amount: number;
  memo?: string;
  /** Issuer of the Twin Token (defaults to a synthetic issuer). */
  issuer?: string;
}

export interface TwinTokenBurnParams {
  from: string;
  currency: string;
  amount: number;
  memo?: string;
}

export interface TwinTokenMintParams {
  to: string;
  currency: string;
  amount: number;
  issuer: string;
  memo?: string;
}

export interface ClaimableBalanceSettlementParams {
  from: string;
  currency: string;
  amount: number;
  claimant: string;
  /** Predicate for when the claimant can claim. Default = unconditional. */
  predicate?: ClaimPredicate;
  issuer?: string;
  memo?: string;
}

/** Default issuer for Twin Token assets in the simulation. */
function defaultIssuer(currency: string): string {
  return `G${currency.toUpperCase()}ISSUER000000000000000000000000000000`;
}

/** Ensure a holder has a trustline for a Twin Token asset. */
async function ensureTrustline(
  holder: string,
  assetCode: string,
  issuer: string,
): Promise<SettlementResult> {
  // Check current trustlines via getBalances
  const balances = await stellarChainAdapter.getBalances(holder);
  if (!balances.success) return { success: false, error: balances.error };
  const key = `${assetCode}:${issuer}`;
  const has = balances.balances.some((b) => b.asset === key);
  if (has) return { success: true };
  // Create trustline
  const r = await stellarChainAdapter.createTrustline({ holder, assetCode, issuer });
  if (!r.success) return { success: false, error: r.error };
  return { success: true, txHash: r.txHash, evidence: r.evidence, ledger: r.ledger };
}

/**
 * Settle a Twin Token transfer between two holders.
 * Ensures both trustlines exist, transfers, verifies, returns Evidence.
 */
export async function settleTwinTokenTransfer(
  params: TwinTokenTransferParams,
): Promise<SettlementResult> {
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    return { success: false, error: 'Amount must be positive' };
  }
  const assetCode = twinTokenCode(params.currency);
  if (!isTwinToken(assetCode)) {
    return { success: false, error: `Invalid Twin Token code: ${assetCode}` };
  }
  const issuer = params.issuer ?? defaultIssuer(params.currency);

  // Register asset (idempotent)
  await stellarChainAdapter.registerAsset({ assetCode, issuer });

  // Ensure recipient trustline (sender is assumed to already hold the asset)
  const tl = await ensureTrustline(params.to, assetCode, issuer);
  if (!tl.success) {
    return { success: false, error: `Trustline setup failed: ${tl.error}` };
  }

  // Transfer
  const transfer = await stellarChainAdapter.transfer({
    assetCode, issuer, amount: params.amount,
    from: params.from, to: params.to,
    memo: params.memo ? { type: 'text', value: params.memo } : undefined,
  });
  if (!transfer.success || !transfer.txHash) {
    return { success: false, error: transfer.error ?? 'Transfer failed' };
  }

  // Verify
  const verify = await stellarChainAdapter.verifyTransaction({ txHash: transfer.txHash });
  if (!verify.confirmed) {
    return { success: false, error: 'Transfer not confirmed', txHash: transfer.txHash };
  }

  return {
    success: true,
    txHash: transfer.txHash,
    evidence: transfer.evidence,
    ledger: transfer.ledger,
  };
}

/**
 * Settle a Twin Token burn (redeem for fiat).
 * Burns the asset from the holder and returns cryptographic Evidence.
 */
export async function settleTwinTokenBurn(
  params: TwinTokenBurnParams,
): Promise<SettlementResult> {
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    return { success: false, error: 'Amount must be positive' };
  }
  const assetCode = twinTokenCode(params.currency);
  if (!isTwinToken(assetCode)) {
    return { success: false, error: `Invalid Twin Token code: ${assetCode}` };
  }

  const burn = await stellarChainAdapter.burnAsset({
    assetCode, amount: params.amount, from: params.from,
    memo: params.memo ? { type: 'text', value: params.memo } : undefined,
  });
  if (!burn.success || !burn.txHash) {
    return { success: false, error: burn.error ?? 'Burn failed' };
  }
  const verify = await stellarChainAdapter.verifyTransaction({ txHash: burn.txHash });
  if (!verify.confirmed) {
    return { success: false, error: 'Burn not confirmed', txHash: burn.txHash };
  }
  return {
    success: true, txHash: burn.txHash, evidence: burn.evidence, ledger: burn.ledger,
  };
}

/**
 * Settle a Twin Token mint — issuer credits a holder.
 * Ensures recipient trustline, mints, verifies, returns Evidence.
 */
export async function settleTwinTokenMint(
  params: TwinTokenMintParams,
): Promise<SettlementResult> {
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    return { success: false, error: 'Amount must be positive' };
  }
  const assetCode = twinTokenCode(params.currency);
  if (!isTwinToken(assetCode)) {
    return { success: false, error: `Invalid Twin Token code: ${assetCode}` };
  }

  // Register asset (idempotent)
  await stellarChainAdapter.registerAsset({ assetCode, issuer: params.issuer });

  // Ensure recipient trustline
  const tl = await ensureTrustline(params.to, assetCode, params.issuer);
  if (!tl.success) {
    return { success: false, error: `Trustline setup failed: ${tl.error}` };
  }

  // Issue
  const issue = await stellarChainAdapter.issueAsset({
    assetCode, issuer: params.issuer, amount: params.amount, to: params.to,
    memo: params.memo ? { type: 'text', value: params.memo } : undefined,
  });
  if (!issue.success || !issue.txHash) {
    return { success: false, error: issue.error ?? 'Mint failed' };
  }
  const verify = await stellarChainAdapter.verifyTransaction({ txHash: issue.txHash });
  if (!verify.confirmed) {
    return { success: false, error: 'Mint not confirmed', txHash: issue.txHash };
  }
  return {
    success: true, txHash: issue.txHash, evidence: issue.evidence, ledger: issue.ledger,
  };
}

/**
 * Settle using a claimable balance — for async settlement where the
 * recipient must satisfy a predicate (e.g. time-locked or after KYC)
 * before claiming.
 *
 * Flow: create claimable balance → recipient claims when predicate is true.
 */
export async function settleWithClaimableBalance(
  params: ClaimableBalanceSettlementParams,
): Promise<{ success: boolean; balanceId?: string; txHash?: string; evidence?: Evidence; error?: string }> {
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    return { success: false, error: 'Amount must be positive' };
  }
  const assetCode = twinTokenCode(params.currency);
  if (!isTwinToken(assetCode)) {
    return { success: false, error: `Invalid Twin Token code: ${assetCode}` };
  }
  const issuer = params.issuer ?? defaultIssuer(params.currency);
  const asset: ChainAsset = { code: assetCode, issuer };

  // Ensure claimant trustline
  const tl = await ensureTrustline(params.claimant, assetCode, issuer);
  if (!tl.success) {
    return { success: false, error: `Trustline setup failed: ${tl.error}` };
  }

  const create = await stellarChainAdapter.createClaimableBalance({
    asset, amount: params.amount, from: params.from,
    claimant: params.claimant,
    predicate: params.predicate ?? { kind: 'unconditional' },
    memo: params.memo ? { type: 'text', value: params.memo } : undefined,
  });
  if (!create.success || !create.balanceId) {
    return { success: false, error: create.error ?? 'Claimable balance creation failed' };
  }
  return {
    success: true, balanceId: create.balanceId,
    txHash: create.txHash, evidence: create.evidence,
  };
}

/**
 * Verify a settlement transaction — returns confirmed status + Evidence.
 */
export async function verifySettlement(txHash: string): Promise<{
  confirmed: boolean;
  evidence?: Evidence;
  ledger?: number;
  error?: string;
}> {
  const verify = await stellarChainAdapter.verifyTransaction({ txHash });
  return {
    confirmed: verify.confirmed,
    evidence: verify.evidence,
    ledger: verify.ledger,
    error: verify.error,
  };
}

/**
 * Convenience — settle a native (XLM) transfer.
 */
export async function settleNativeTransfer(params: {
  from: string;
  to: string;
  amount: number;
  memo?: string;
}): Promise<SettlementResult> {
  const r = await stellarChainAdapter.transfer({
    assetCode: NATIVE_ASSET_CODE,
    amount: params.amount,
    from: params.from,
    to: params.to,
    memo: params.memo ? { type: 'text', value: params.memo } : undefined,
  });
  return r;
}
