/**
 * PaySwap Protocol — Wallet Policy Service.
 *
 * Enforces spending limits, chain/asset restrictions, address
 * whitelisting, MFA requirements, and approval thresholds on every
 * withdrawal / signed transaction.
 *
 * Policies are attached per-wallet via `setPolicy(walletId, policy)`.
 * Before any withdrawal executes, the withdrawal service calls
 * `enforcePolicy(walletId, tx)` — if the transaction violates any
 * policy constraint, `WalletError('policy.violation')` is thrown
 * and the withdrawal is blocked.
 *
 * Policy dimensions:
 *  - `spendingLimitPerTx`        — hard cap on a single transaction.
 *  - `dailySpendingLimit`        — rolling 24h aggregate cap.
 *  - `monthlySpendingLimit`      — rolling 30d aggregate cap.
 *  - `allowedChains`             — whitelist of permitted chains.
 *  - `allowedAssets`             — whitelist of permitted asset codes.
 *  - `requireMFA`                — MFA must precede every withdrawal.
 *  - `requireApprovalAbove`      — withdrawals above this amount need
 *                                  explicit approver sign-off.
 *  - `whitelistedAddresses`      — only these destination addresses
 *                                  may receive funds (empty = any).
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `wallet.policy_set`
 *  - `wallet.policy_violation`
 *  - `wallet.policy_whitelist_added`
 *  - `wallet.policy_whitelist_removed`
 *
 * The kernel is FROZEN — this module only imports `uid`, `nowTs` from
 * `@/kernel/support`, `eventEngine` from `@/kernel/event`, and uses
 * `WalletError` + types.
 */
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import {
  DEFAULT_DAILY_SPENDING_LIMIT,
  DEFAULT_MONTHLY_SPENDING_LIMIT,
  DEFAULT_REQUIRE_APPROVAL_ABOVE,
  DEFAULT_SPENDING_LIMIT_PER_TX,
  DAILY_WINDOW_MS,
  MONTHLY_WINDOW_MS,
  WalletError,
  type WalletPolicy,
  type WalletTx,
} from './types';

/** Recorded spend event (used for rolling-window limit checks). */
interface SpendRecord {
  walletId: string;
  amount: number;
  asset: string;
  ts: number;
  txRef: string;
}

export class WalletPolicyService {
  private policies = new Map<string, WalletPolicy>();
  private spendHistory = new Map<string, SpendRecord[]>();

  // ------------------------------------------------- setPolicy
  /**
   * Set / replace the policy for a wallet. Defaults are applied for
   * any field the caller omits.
   */
  setPolicy(
    walletId: string,
    partial: Partial<Omit<WalletPolicy, 'walletId' | 'updatedAt'>>,
  ): WalletPolicy {
    const existing = this.policies.get(walletId);
    const policy: WalletPolicy = {
      walletId,
      spendingLimitPerTx: partial.spendingLimitPerTx ?? existing?.spendingLimitPerTx ?? DEFAULT_SPENDING_LIMIT_PER_TX,
      dailySpendingLimit: partial.dailySpendingLimit ?? existing?.dailySpendingLimit ?? DEFAULT_DAILY_SPENDING_LIMIT,
      monthlySpendingLimit: partial.monthlySpendingLimit ?? existing?.monthlySpendingLimit ?? DEFAULT_MONTHLY_SPENDING_LIMIT,
      allowedChains: partial.allowedChains ?? existing?.allowedChains ?? [],
      allowedAssets: partial.allowedAssets ?? existing?.allowedAssets ?? [],
      requireMFA: partial.requireMFA ?? existing?.requireMFA ?? false,
      requireApprovalAbove: partial.requireApprovalAbove ?? existing?.requireApprovalAbove ?? DEFAULT_REQUIRE_APPROVAL_ABOVE,
      whitelistedAddresses: partial.whitelistedAddresses ?? existing?.whitelistedAddresses ?? [],
      updatedAt: nowTs(),
    };
    this.policies.set(walletId, policy);
    eventEngine.emit('wallet.policy_set', { walletId, policy });
    return policy;
  }

  // ------------------------------------------------- getPolicy
  getPolicy(walletId: string): WalletPolicy | undefined {
    return this.policies.get(walletId);
  }

  /** True if a policy is set for this wallet. */
  hasPolicy(walletId: string): boolean {
    return this.policies.has(walletId);
  }

  // ------------------------------------------------- enforcePolicy
  /**
   * Hard gate: throws `WalletError('policy.violation')` if the
   * transaction violates any policy constraint. Returns the policy
   * (for caller's reference) on success.
   *
   * `tx` is the minimal transaction shape (`WalletTx`).
   */
  enforcePolicy(walletId: string, tx: WalletTx): WalletPolicy {
    const policy = this.policies.get(walletId);
    if (!policy) {
      // No policy = no restrictions (caller's responsibility to set a
      // policy before allowing withdrawals).
      return {
        walletId,
        spendingLimitPerTx: Number.POSITIVE_INFINITY,
        dailySpendingLimit: Number.POSITIVE_INFINITY,
        monthlySpendingLimit: Number.POSITIVE_INFINITY,
        allowedChains: [],
        allowedAssets: [],
        requireMFA: false,
        requireApprovalAbove: Number.POSITIVE_INFINITY,
        whitelistedAddresses: [],
        updatedAt: 0,
      };
    }

    // 1. Per-tx spending limit.
    if (tx.amount > policy.spendingLimitPerTx) {
      this.emitViolation(walletId, tx, 'spending_limit_per_tx', `${tx.amount} > ${policy.spendingLimitPerTx}`);
      throw new WalletError(
        'policy.violation',
        `Tx amount ${tx.amount} exceeds per-tx limit ${policy.spendingLimitPerTx}`,
        { walletId, violation: 'spending_limit_per_tx', amount: tx.amount, limit: policy.spendingLimitPerTx },
      );
    }

    // 2. Chain whitelist.
    if (policy.allowedChains.length > 0 && !policy.allowedChains.includes(tx.chain)) {
      this.emitViolation(walletId, tx, 'chain_not_allowed', `chain ${tx.chain} not in ${policy.allowedChains.join(',')}`);
      throw new WalletError(
        'policy.violation',
        `Chain ${tx.chain} is not allowed for wallet ${walletId}`,
        { walletId, violation: 'chain_not_allowed', chain: tx.chain, allowed: policy.allowedChains },
      );
    }

    // 3. Asset whitelist.
    if (policy.allowedAssets.length > 0 && !policy.allowedAssets.includes(tx.asset)) {
      this.emitViolation(walletId, tx, 'asset_not_allowed', `asset ${tx.asset} not in ${policy.allowedAssets.join(',')}`);
      throw new WalletError(
        'policy.violation',
        `Asset ${tx.asset} is not allowed for wallet ${walletId}`,
        { walletId, violation: 'asset_not_allowed', asset: tx.asset, allowed: policy.allowedAssets },
      );
    }

    // 4. Destination whitelist.
    if (policy.whitelistedAddresses.length > 0 && !policy.whitelistedAddresses.includes(tx.destination)) {
      this.emitViolation(walletId, tx, 'destination_not_whitelisted', `${tx.destination} not in whitelist`);
      throw new WalletError(
        'policy.violation',
        `Destination ${tx.destination} is not whitelisted for wallet ${walletId}`,
        { walletId, violation: 'destination_not_whitelisted', destination: tx.destination, whitelist: policy.whitelistedAddresses },
      );
    }

    // 5. Daily rolling window.
    const dailySpend = this.aggregateSpend(walletId, DAILY_WINDOW_MS);
    if (dailySpend + tx.amount > policy.dailySpendingLimit) {
      this.emitViolation(walletId, tx, 'daily_limit', `daily ${dailySpend}+${tx.amount} > ${policy.dailySpendingLimit}`);
      throw new WalletError(
        'policy.violation',
        `Daily spend limit exceeded: current ${dailySpend} + tx ${tx.amount} > limit ${policy.dailySpendingLimit}`,
        { walletId, violation: 'daily_limit', currentSpend: dailySpend, amount: tx.amount, limit: policy.dailySpendingLimit },
      );
    }

    // 6. Monthly rolling window.
    const monthlySpend = this.aggregateSpend(walletId, MONTHLY_WINDOW_MS);
    if (monthlySpend + tx.amount > policy.monthlySpendingLimit) {
      this.emitViolation(walletId, tx, 'monthly_limit', `monthly ${monthlySpend}+${tx.amount} > ${policy.monthlySpendingLimit}`);
      throw new WalletError(
        'policy.violation',
        `Monthly spend limit exceeded: current ${monthlySpend} + tx ${tx.amount} > limit ${policy.monthlySpendingLimit}`,
        { walletId, violation: 'monthly_limit', currentSpend: monthlySpend, amount: tx.amount, limit: policy.monthlySpendingLimit },
      );
    }

    return policy;
  }

  // ------------------------------------------------- requireMFA
  /**
   * Returns true if MFA is required for this wallet before signing.
   * The caller (withdrawal service / signing flow) checks this and
   * prompts the user for MFA.
   */
  requiresMFA(walletId: string): boolean {
    return this.policies.get(walletId)?.requireMFA ?? false;
  }

  // ------------------------------------------------- requiresApproval
  /**
   * Returns true if a withdrawal of `amount` requires explicit
   * approver sign-off (per `requireApprovalAbove`).
   */
  requiresApproval(walletId: string, amount: number): boolean {
    const policy = this.policies.get(walletId);
    if (!policy) return false;
    return amount > policy.requireApprovalAbove;
  }

  // ------------------------------------------------- addToWhitelist / removeFromWhitelist
  addToWhitelist(walletId: string, address: string): WalletPolicy {
    const policy = this.requirePolicy(walletId);
    if (!policy.whitelistedAddresses.includes(address)) {
      policy.whitelistedAddresses = [...policy.whitelistedAddresses, address];
      policy.updatedAt = nowTs();
      eventEngine.emit('wallet.policy_whitelist_added', { walletId, address });
    }
    return policy;
  }

  removeFromWhitelist(walletId: string, address: string): WalletPolicy {
    const policy = this.requirePolicy(walletId);
    policy.whitelistedAddresses = policy.whitelistedAddresses.filter((a) => a !== address);
    policy.updatedAt = nowTs();
    eventEngine.emit('wallet.policy_whitelist_removed', { walletId, address });
    return policy;
  }

  // ------------------------------------------------- recordSpend
  /**
   * Record a successful spend against the wallet's rolling-window
   * history. Called by the withdrawal service after `executeWithdrawal`
   * succeeds.
   */
  recordSpend(walletId: string, amount: number, asset: string, txRef: string): void {
    const history = this.spendHistory.get(walletId) ?? [];
    history.push({ walletId, amount, asset, ts: nowTs(), txRef });
    this.spendHistory.set(walletId, history);
  }

  /** Aggregate spend over the last `windowMs` for a wallet. */
  aggregateSpend(walletId: string, windowMs: number): number {
    const cutoff = nowTs() - windowMs;
    const history = this.spendHistory.get(walletId) ?? [];
    return history
      .filter((r) => r.ts >= cutoff)
      .reduce((sum, r) => sum + r.amount, 0);
  }

  /** Get the spend history for a wallet (optionally windowed). */
  getSpendHistory(walletId: string, windowMs?: number): SpendRecord[] {
    const history = this.spendHistory.get(walletId) ?? [];
    if (windowMs === undefined) return [...history];
    const cutoff = nowTs() - windowMs;
    return history.filter((r) => r.ts >= cutoff);
  }

  // ------------------------------------------------- helpers
  private requirePolicy(walletId: string): WalletPolicy {
    const policy = this.policies.get(walletId);
    if (!policy) {
      throw new WalletError('policy.not_set', `No policy set for wallet ${walletId}`, { walletId });
    }
    return policy;
  }

  private emitViolation(walletId: string, tx: WalletTx, violation: string, detail: string): void {
    eventEngine.emit('wallet.policy_violation', {
      walletId,
      violation,
      detail,
      tx,
      violationId: uid('viol'),
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForPolicy = globalThis as unknown as { __PAYSWAP_WALLET_POLICY_SERVICE?: WalletPolicyService };
export const walletPolicyService =
  _globalForPolicy.__PAYSWAP_WALLET_POLICY_SERVICE ?? new WalletPolicyService();
if (!_globalForPolicy.__PAYSWAP_WALLET_POLICY_SERVICE) {
  _globalForPolicy.__PAYSWAP_WALLET_POLICY_SERVICE = walletPolicyService;
}
