/**
 * PaySwap Protocol — Withdrawal Approval Flow.
 *
 * Withdrawals from custodial wallets follow a multi-step approval
 * flow:
 *
 *   1. `requestWithdrawal(walletId, amount, asset, destination)`
 *      creates a `pending` withdrawal request. The wallet policy is
 *      enforced immediately — if the request violates any policy
 *      constraint, the request is rejected at creation time.
 *
 *   2. If `amount > policy.requireApprovalAbove`, the request must
 *      be explicitly approved via `approveWithdrawal(requestId,
 *      approverId)` before it can execute. If the amount is below
 *      the threshold, the request can be executed directly (still
 *      subject to MFA if `requireMFA` is true).
 *
 *   3. `executeWithdrawal(requestId)` performs the on-chain transfer
 *      via the chain adapter (`chainRegistry.get(chain).transfer(...)`),
 *      debits the wallet balance, records the spend against the
 *      wallet's rolling-window policy history, and marks the request
 *      `executed` (or `failed` if the chain adapter returns an error).
 *
 *   4. `rejectWithdrawal(requestId, approverId, reason)` allows an
 *      approver to reject a pending request.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `wallet.withdrawal_requested`
 *  - `wallet.withdrawal_approved`
 *  - `wallet.withdrawal_rejected`
 *  - `wallet.withdrawal_executed`
 *  - `wallet.withdrawal_failed`
 *
 * The kernel is FROZEN — this module only imports `uid`, `nowTs` from
 * `@/kernel/support`, `eventEngine` from `@/kernel/event`, and uses
 * `custodialWalletService` + `walletPolicyService` + `WalletError` +
 * the existing `chainRegistry`.
 */
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { custodialWalletService } from './custodial';
import { walletPolicyService } from './policies';
import {
  WalletError,
  type WithdrawalRequest,
  type WithdrawalStatus,
} from './types';

/** Filter for `listWithdrawals`. */
export interface WithdrawalFilter {
  walletId?: string;
  status?: WithdrawalStatus;
  asset?: string;
  /** Inclusive lower-bound timestamp. */
  fromTs?: number;
  /** Inclusive upper-bound timestamp. */
  toTs?: number;
}

/** Optional chain-adapter executor (decoupled from `chainRegistry` for testability). */
export interface WithdrawalExecutor {
  execute(params: {
    chain: string;
    from: string;
    to: string;
    asset: string;
    amount: number;
  }): Promise<{ success: boolean; txHash?: string; error?: string }>;
}

export class WithdrawalService {
  private requests = new Map<string, WithdrawalRequest>();
  /** walletId → withdrawalIds[] index. */
  private byWallet = new Map<string, string[]>();
  /** Pending approval queue (requestIds awaiting approver sign-off). */
  private pendingApprovals: string[] = [];
  /** Pluggable chain-adapter executor. */
  private executor: WithdrawalExecutor | undefined;

  // ------------------------------------------------- setExecutor
  /**
   * Plug in a chain-adapter executor. If unset, `executeWithdrawal`
   * uses a built-in adapter that looks up the chain via
   * `chainRegistry` (lazy-imported to avoid a hard dependency).
   */
  setExecutor(executor: WithdrawalExecutor): void {
    this.executor = executor;
  }

  // ------------------------------------------------- requestWithdrawal
  /**
   * Create a new withdrawal request. The wallet policy is enforced
   * immediately. If `amount > policy.requireApprovalAbove`, the
   * request is queued for explicit approval; otherwise it can be
   * executed directly.
   */
  requestWithdrawal(
    walletId: string,
    amount: number,
    asset: string,
    destination: string,
  ): WithdrawalRequest {
    if (amount <= 0) throw new WalletError('withdrawal.bad_amount', 'amount must be positive');
    if (!asset) throw new WalletError('withdrawal.bad_asset', 'asset is required');
    if (!destination) throw new WalletError('withdrawal.bad_destination', 'destination is required');

    // Wallet must exist and be active.
    const walletRecord = custodialWalletService.requireActive(walletId);
    const wallet = walletRecord.wallet;

    // Verify sufficient balance.
    const available =
      (walletRecord.balance.balances[asset] ?? 0) - (walletRecord.balance.locked[asset] ?? 0);
    if (available < amount) {
      throw new WalletError(
        'withdrawal.insufficient_balance',
        `Insufficient ${asset} balance: have ${available}, need ${amount}`,
        { walletId, asset, available, required: amount },
      );
    }

    // Enforce the wallet policy.
    const policy = walletPolicyService.enforcePolicy(walletId, {
      walletId,
      amount,
      asset,
      chain: wallet.chain,
      destination,
      ts: nowTs(),
    });

    const id = uid('wd');
    const request: WithdrawalRequest = {
      id,
      walletId,
      amount,
      asset,
      destination,
      requestedAt: nowTs(),
      status: 'pending',
    };
    this.requests.set(id, request);
    const list = this.byWallet.get(walletId) ?? [];
    list.push(id);
    this.byWallet.set(walletId, list);

    // If approval is required, queue it; otherwise it can be executed
    // directly (the caller still calls `executeWithdrawal`).
    if (policy.requireApprovalAbove !== Number.POSITIVE_INFINITY && amount > policy.requireApprovalAbove) {
      this.pendingApprovals.push(id);
    }

    eventEngine.emit('wallet.withdrawal_requested', {
      requestId: id,
      walletId,
      amount,
      asset,
      destination,
      requiresApproval: amount > policy.requireApprovalAbove,
      requireMFA: policy.requireMFA,
    });
    return request;
  }

  // ------------------------------------------------- approveWithdrawal
  /** Approve a pending withdrawal request. */
  approveWithdrawal(requestId: string, approverId: string): WithdrawalRequest {
    const request = this.requireRequest(requestId);
    if (request.status !== 'pending') {
      throw new WalletError(
        'withdrawal.bad_state',
        `Withdrawal ${requestId} is in status ${request.status} — cannot approve`,
        { requestId, status: request.status },
      );
    }
    if (!approverId) throw new WalletError('withdrawal.bad_approver', 'approverId is required');

    request.status = 'approved';
    request.approvedBy = approverId;
    request.approvedAt = nowTs();
    this.pendingApprovals = this.pendingApprovals.filter((id) => id !== requestId);

    eventEngine.emit('wallet.withdrawal_approved', {
      requestId,
      walletId: request.walletId,
      approverId,
    });
    return request;
  }

  // ------------------------------------------------- rejectWithdrawal
  /** Reject a pending withdrawal request. */
  rejectWithdrawal(requestId: string, approverId: string, reason: string): WithdrawalRequest {
    const request = this.requireRequest(requestId);
    if (request.status !== 'pending' && request.status !== 'approved') {
      throw new WalletError(
        'withdrawal.bad_state',
        `Withdrawal ${requestId} is in status ${request.status} — cannot reject`,
        { requestId, status: request.status },
      );
    }
    if (!reason || reason.length < 3) {
      throw new WalletError('withdrawal.bad_reason', 'rejection reason must be at least 3 chars');
    }

    request.status = 'rejected';
    request.rejectedBy = approverId;
    request.rejectionReason = reason;
    request.rejectedAt = nowTs();
    this.pendingApprovals = this.pendingApprovals.filter((id) => id !== requestId);

    eventEngine.emit('wallet.withdrawal_rejected', {
      requestId,
      walletId: request.walletId,
      approverId,
      reason,
    });
    return request;
  }

  // ------------------------------------------------- executeWithdrawal
  /**
   * Execute an approved (or auto-approvable) withdrawal. Performs the
   * on-chain transfer via the chain adapter, debits the wallet, and
   * records the spend against the wallet's policy history.
   *
   * If `amount > policy.requireApprovalAbove`, the request MUST be
   * in `approved` state. Otherwise `pending` is acceptable.
   */
  async executeWithdrawal(requestId: string): Promise<WithdrawalRequest> {
    const request = this.requireRequest(requestId);
    if (request.status !== 'pending' && request.status !== 'approved') {
      throw new WalletError(
        'withdrawal.bad_state',
        `Withdrawal ${requestId} is in status ${request.status} — cannot execute`,
        { requestId, status: request.status },
      );
    }

    // Re-check approval requirement.
    if (walletPolicyService.requiresApproval(request.walletId, request.amount) && request.status !== 'approved') {
      throw new WalletError(
        'withdrawal.needs_approval',
        `Withdrawal ${requestId} of amount ${request.amount} requires explicit approval before execution`,
        { requestId, amount: request.amount },
      );
    }

    // Re-check policy (limits may have changed since request was made).
    const walletRecord = custodialWalletService.requireActive(request.walletId);
    const wallet = walletRecord.wallet;
    walletPolicyService.enforcePolicy(request.walletId, {
      walletId: request.walletId,
      amount: request.amount,
      asset: request.asset,
      chain: wallet.chain,
      destination: request.destination,
      ts: nowTs(),
    });

    // Lock the funds for the in-flight withdrawal.
    custodialWalletService.lock(request.walletId, request.asset, request.amount);

    let txHash: string | undefined;
    let executeError: string | undefined;
    try {
      const result = await this.invokeExecutor({
        chain: wallet.chain,
        from: wallet.address,
        to: request.destination,
        asset: request.asset,
        amount: request.amount,
      });
      if (!result.success) {
        executeError = result.error ?? 'chain adapter returned failure';
      } else {
        txHash = result.txHash;
      }
    } catch (err) {
      executeError = err instanceof Error ? err.message : String(err);
    }

    if (executeError || !txHash) {
      // Unlock funds and mark failed.
      custodialWalletService.unlock(request.walletId, request.asset, request.amount);
      request.status = 'failed';
      request.failureReason = executeError ?? 'no txHash returned';
      eventEngine.emit('wallet.withdrawal_failed', {
        requestId,
        walletId: request.walletId,
        error: request.failureReason,
      });
      return request;
    }

    // Success: debit the wallet and record the spend.
    custodialWalletService.unlock(request.walletId, request.asset, request.amount);
    custodialWalletService.debit(request.walletId, request.asset, request.amount);
    walletPolicyService.recordSpend(request.walletId, request.amount, request.asset, txHash);

    request.status = 'executed';
    request.executedAt = nowTs();
    request.txHash = txHash;

    eventEngine.emit('wallet.withdrawal_executed', {
      requestId,
      walletId: request.walletId,
      amount: request.amount,
      asset: request.asset,
      destination: request.destination,
      txHash,
    });
    return request;
  }

  // ------------------------------------------------- getWithdrawal / listWithdrawals / getPendingApprovals
  getWithdrawal(requestId: string): WithdrawalRequest | undefined {
    return this.requests.get(requestId);
  }

  listWithdrawals(filter?: WithdrawalFilter): WithdrawalRequest[] {
    let list = [...this.requests.values()];
    if (filter?.walletId) list = list.filter((r) => r.walletId === filter.walletId);
    if (filter?.status) list = list.filter((r) => r.status === filter.status);
    if (filter?.asset) list = list.filter((r) => r.asset === filter.asset);
    if (filter?.fromTs !== undefined) list = list.filter((r) => r.requestedAt >= filter.fromTs!);
    if (filter?.toTs !== undefined) list = list.filter((r) => r.requestedAt <= filter.toTs!);
    return list.sort((a, b) => b.requestedAt - a.requestedAt);
  }

  /**
   * Get the pending-approval queue. If `approverId` is supplied, the
   * caller is indicating they are an approver — the same list is
   * returned (in production this would filter by the approver's
   * jurisdiction / role).
   */
  getPendingApprovals(approverId?: string): WithdrawalRequest[] {
    void approverId; // accepted for API symmetry; filter logic is upstream.
    return this.pendingApprovals
      .map((id) => this.requests.get(id))
      .filter((r): r is WithdrawalRequest => r !== undefined);
  }

  /** Get all withdrawals for a wallet. */
  getWithdrawalsForWallet(walletId: string): WithdrawalRequest[] {
    const ids = this.byWallet.get(walletId) ?? [];
    return ids
      .map((id) => this.requests.get(id))
      .filter((r): r is WithdrawalRequest => r !== undefined);
  }

  // ------------------------------------------------- helpers
  private requireRequest(requestId: string): WithdrawalRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new WalletError('withdrawal.not_found', `Withdrawal ${requestId} not found`);
    }
    return request;
  }

  /**
   * Invoke the chain-adapter executor. If a custom executor is set
   * (via `setExecutor`), use it. Otherwise, lazy-import the chain
   * registry and use the registered adapter for the chain.
   */
  private async invokeExecutor(params: {
    chain: string;
    from: string;
    to: string;
    asset: string;
    amount: number;
  }): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (this.executor) {
      return this.executor.execute(params);
    }
    // Lazy import — avoids a hard dependency on the chains module.
    const { chainRegistry } = await import('../chains/registry');
    const adapter = chainRegistry.get(params.chain);
    if (!adapter) {
      return {
        success: false,
        error: `no chain adapter registered for chain '${params.chain}'`,
      };
    }
    try {
      const result = await adapter.transfer({
        assetCode: params.asset,
        amount: params.amount,
        from: params.from,
        to: params.to,
      });
      return { success: result.success, txHash: result.txHash, error: result.error };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForWithdrawal = globalThis as unknown as { __PAYSWAP_WITHDRAWAL_SERVICE?: WithdrawalService };
export const withdrawalService =
  _globalForWithdrawal.__PAYSWAP_WITHDRAWAL_SERVICE ?? new WithdrawalService();
if (!_globalForWithdrawal.__PAYSWAP_WITHDRAWAL_SERVICE) {
  _globalForWithdrawal.__PAYSWAP_WITHDRAWAL_SERVICE = withdrawalService;
}
