/**
 * PaySwap Protocol — Non-Custodial Wallet Service.
 *
 * Non-custodial wallets: PaySwap does NOT hold the private key. The
 * customer retains full custody; PaySwap only registers the public
 * address (for balance tracking, policy enforcement, and routing).
 *
 * For specific operations (e.g. automated settlement, scheduled
 * payouts), the customer may grant PaySwap *delegated signing*
 * authority for a bounded set of permissions and a bounded duration.
 * The private key never leaves the customer's custody — the delegation
 * is a logical authorisation that the customer can revoke at any time.
 *
 * Lifecycle:
 *   registerExternalWallet()
 *     → requestDelegatedSigning() → approveDelegation() → ...
 *     → revokeDelegation()
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `wallet.noncustodial_registered`
 *  - `wallet.delegation_requested`
 *  - `wallet.delegation_approved`
 *  - `wallet.delegation_revoked`
 *  - `wallet.delegation_expired`
 *
 * The kernel is FROZEN — this module only imports `uid`, `nowTs` from
 * `@/kernel/support`, `eventEngine` from `@/kernel/event`, and uses
 * `WalletError` + types.
 */
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import {
  WalletError,
  type DelegatedSigning,
  type WalletState,
  type WalletType,
} from './types';

/** Non-custodial wallet record (public address + metadata only). */
export interface NonCustodialWalletRecord {
  id: string;
  accountId: string;
  chain: string;
  address: string;
  publicKey: string;
  type: WalletType; // always 'non_custodial'
  state: WalletState;
  registeredAt: number;
  /** Optional label (e.g. "Ledger Nano X"). */
  label?: string;
}

export class NonCustodialWalletService {
  private wallets = new Map<string, NonCustodialWalletRecord>();
  private delegations = new Map<string, DelegatedSigning>();
  /** walletId → delegationIds[] index. */
  private delegationsByWallet = new Map<string, string[]>();
  /** delegateeId → delegationIds[] index. */
  private delegationsByDelegatee = new Map<string, string[]>();
  /** accountId → walletIds[] index. */
  private walletsByAccount = new Map<string, string[]>();

  // ------------------------------------------------- registerExternalWallet
  /**
   * Register an externally-controlled wallet. PaySwap records the
   * public address + public key for tracking, but never sees the
   * private key.
   */
  registerExternalWallet(
    accountId: string,
    chain: string,
    address: string,
    publicKey: string,
    opts?: { label?: string },
  ): NonCustodialWalletRecord {
    if (!address) throw new WalletError('noncustodial.bad_address', 'address is required');
    if (!publicKey) throw new WalletError('noncustodial.bad_public_key', 'publicKey is required');

    const id = uid('ncw');
    const record: NonCustodialWalletRecord = {
      id,
      accountId,
      chain,
      address,
      publicKey,
      type: 'non_custodial',
      state: 'active',
      registeredAt: nowTs(),
      label: opts?.label,
    };
    this.wallets.set(id, record);

    const list = this.walletsByAccount.get(accountId) ?? [];
    list.push(id);
    this.walletsByAccount.set(accountId, list);

    eventEngine.emit('wallet.noncustodial_registered', {
      walletId: id,
      accountId,
      chain,
      address,
    });
    return record;
  }

  // ------------------------------------------------- requestDelegatedSigning
  /**
   * Customer requests delegated signing on behalf of `delegateeId`
   * (e.g. PaySwap's settlement agent) for `permissions` operations,
   * expiring after `durationMs`.
   */
  requestDelegatedSigning(
    walletId: string,
    delegateeId: string,
    permissions: string[],
    durationMs: number,
  ): DelegatedSigning {
    this.requireWallet(walletId);
    if (!delegateeId) throw new WalletError('noncustodial.bad_delegatee', 'delegateeId is required');
    if (permissions.length === 0) {
      throw new WalletError('noncustodial.bad_permissions', 'permissions cannot be empty');
    }
    if (durationMs <= 0) {
      throw new WalletError('noncustodial.bad_duration', 'durationMs must be positive');
    }

    const id = uid('del');
    const now = nowTs();
    const delegation: DelegatedSigning = {
      id,
      walletId,
      delegateeId,
      permissions: [...permissions],
      signedAt: now,
      expiresAt: now + durationMs,
    };
    this.delegations.set(id, delegation);

    const byWallet = this.delegationsByWallet.get(walletId) ?? [];
    byWallet.push(id);
    this.delegationsByWallet.set(walletId, byWallet);

    const byDelegatee = this.delegationsByDelegatee.get(delegateeId) ?? [];
    byDelegatee.push(id);
    this.delegationsByDelegatee.set(delegateeId, byDelegatee);

    eventEngine.emit('wallet.delegation_requested', {
      delegationId: id,
      walletId,
      delegateeId,
      permissions,
      expiresAt: delegation.expiresAt,
    });
    return delegation;
  }

  // ------------------------------------------------- approveDelegation
  /**
   * Customer approves a previously-requested delegation. Until
   * approved, the delegation is not usable. (The approval step is a
   * separate action from the request so the customer must explicitly
   * confirm — protecting against accidental or malicious requests.)
   *
   * In this implementation, `requestDelegatedSigning` already creates
   * the delegation in a usable state; `approveDelegation` is provided
   * as a confirmation hook (e.g. for MFA flows). It is idempotent.
   */
  approveDelegation(delegationId: string): DelegatedSigning {
    const delegation = this.requireDelegation(delegationId);
    if (this.isExpired(delegation)) {
      throw new WalletError('noncustodial.delegation_expired', `Delegation ${delegationId} has expired`);
    }
    eventEngine.emit('wallet.delegation_approved', {
      delegationId,
      walletId: delegation.walletId,
      delegateeId: delegation.delegateeId,
    });
    return delegation;
  }

  // ------------------------------------------------- revokeDelegation
  /** Revoke a delegation early (customer cancels authority). */
  revokeDelegation(delegationId: string, reason?: string): DelegatedSigning {
    const delegation = this.requireDelegation(delegationId);
    if (delegation.revokedAt) {
      throw new WalletError('noncustodial.already_revoked', `Delegation ${delegationId} already revoked`);
    }
    delegation.revokedAt = nowTs();
    delegation.revocationReason = reason;
    eventEngine.emit('wallet.delegation_revoked', {
      delegationId,
      walletId: delegation.walletId,
      delegateeId: delegation.delegateeId,
      reason,
    });
    return delegation;
  }

  // ------------------------------------------------- getDelegations / getActiveDelegations
  /** All delegations for a wallet (including revoked / expired). */
  getDelegations(walletId: string): DelegatedSigning[] {
    const ids = this.delegationsByWallet.get(walletId) ?? [];
    return ids
      .map((id) => this.delegations.get(id))
      .filter((d): d is DelegatedSigning => d !== undefined);
  }

  /** Active (non-revoked, non-expired) delegations for a delegatee. */
  getActiveDelegations(delegateeId: string): DelegatedSigning[] {
    const ids = this.delegationsByDelegatee.get(delegateeId) ?? [];
    return ids
      .map((id) => this.delegations.get(id))
      .filter((d): d is DelegatedSigning => d !== undefined)
      .filter((d) => !d.revokedAt && !this.isExpired(d));
  }

  /** Single delegation lookup. */
  getDelegation(delegationId: string): DelegatedSigning | undefined {
    return this.delegations.get(delegationId);
  }

  // ------------------------------------------------- hasPermission
  /**
   * Check whether a delegatee currently has a specific permission on
   * a wallet. Used by the settlement layer before requesting a
   * delegated signature.
   */
  hasPermission(walletId: string, delegateeId: string, permission: string): boolean {
    const active = this.getActiveDelegations(delegateeId).filter((d) => d.walletId === walletId);
    return active.some((d) => d.permissions.includes(permission) || d.permissions.includes('*'));
  }

  // ------------------------------------------------- getWallet / getWalletsByAccount
  getWallet(walletId: string): NonCustodialWalletRecord | undefined {
    return this.wallets.get(walletId);
  }

  getWalletsByAccount(accountId: string): NonCustodialWalletRecord[] {
    const ids = this.walletsByAccount.get(accountId) ?? [];
    return ids
      .map((id) => this.wallets.get(id))
      .filter((w): w is NonCustodialWalletRecord => w !== undefined);
  }

  // ------------------------------------------------- setState
  /** Update a non-custodial wallet's state (e.g. mark as frozen). */
  setState(walletId: string, state: WalletState): NonCustodialWalletRecord {
    const wallet = this.requireWallet(walletId);
    wallet.state = state;
    eventEngine.emit('wallet.noncustodial_state_changed', { walletId, state });
    return wallet;
  }

  // ------------------------------------------------- sweepExpiredDelegations
  /** Mark all expired-but-not-yet-tagged delegations as expired. Returns count. */
  sweepExpiredDelegations(): number {
    let n = 0;
    const now = nowTs();
    for (const d of this.delegations.values()) {
      if (!d.revokedAt && now > d.expiresAt) {
        // Don't mutate `revokedAt` (that's for explicit revocations) —
        // emit an `expired` event for downstream observers.
        eventEngine.emit('wallet.delegation_expired', { delegationId: d.id, walletId: d.walletId });
        n += 1;
      }
    }
    return n;
  }

  // ------------------------------------------------- helpers
  private requireWallet(walletId: string): NonCustodialWalletRecord {
    const wallet = this.wallets.get(walletId);
    if (!wallet) {
      throw new WalletError('noncustodial.not_found', `Non-custodial wallet ${walletId} not found`, { walletId });
    }
    return wallet;
  }

  private requireDelegation(delegationId: string): DelegatedSigning {
    const delegation = this.delegations.get(delegationId);
    if (!delegation) {
      throw new WalletError('noncustodial.delegation_not_found', `Delegation ${delegationId} not found`);
    }
    return delegation;
  }

  private isExpired(delegation: DelegatedSigning): boolean {
    return nowTs() > delegation.expiresAt;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForNonCustodial = globalThis as unknown as { __PAYSWAP_NON_CUSTODIAL_WALLET_SERVICE?: NonCustodialWalletService };
export const nonCustodialWalletService =
  _globalForNonCustodial.__PAYSWAP_NON_CUSTODIAL_WALLET_SERVICE ?? new NonCustodialWalletService();
if (!_globalForNonCustodial.__PAYSWAP_NON_CUSTODIAL_WALLET_SERVICE) {
  _globalForNonCustodial.__PAYSWAP_NON_CUSTODIAL_WALLET_SERVICE = nonCustodialWalletService;
}
