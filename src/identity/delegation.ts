/**
 * Delegation Manager — authority granted from one identity to another. (M-ID-41.)
 *
 * Delegation is the "permissions" half of the Identity OS. It lets an
 * identity (the "from") grant another identity (the "to") the right to
 * act on its behalf, scoped to a list of dotted permission strings and
 * capped by optional financial limits.
 *
 * Scope strings follow `<domain>:<action>` convention:
 *   - payments:read / payments:write
 *   - payouts:read / payouts:write
 *   - treasury:read / treasury:rebalance:write
 *   - refunds:write
 *   - identity:manage (admin-level — allows managing credentials /
 *     attestations for the from-identity)
 *
 * `canAct(identityId, action, amount?)` is the policy check the runtime
 * calls before executing a delegated action.
 */

import type { Delegation } from './types';
import { store } from './store';
import { identityRegistry } from './registry';
import { uid } from '@/runtime/types';

export interface DelegateInput {
  scope: string[];
  limits?: Delegation['limits'];
  validFrom?: number;
  validUntil?: number;
}

export interface CanActResult {
  allowed: boolean;
  reason?: string;
  delegation?: Delegation;
}

export class DelegationManager {
  /**
   * Delegate authority from one identity to another. The `from` identity
   * must exist and be active.
   */
  async delegate(
    from: string,
    to: string,
    scope: string[],
    limits?: Delegation['limits'],
  ): Promise<Delegation> {
    const fromIdentity = identityRegistry.getSync(from);
    if (!fromIdentity) throw new Error(`From identity ${from} not found`);
    if (fromIdentity.status !== 'active') {
      throw new Error(`From identity ${from} is ${fromIdentity.status}`);
    }
    const toIdentity = identityRegistry.getSync(to);
    if (!toIdentity) throw new Error(`To identity ${to} not found`);

    const now = Date.now();
    const delegation: Delegation = {
      id: uid('dlg'),
      fromIdentityId: from,
      toIdentityId: to,
      scope,
      limits,
      validFrom: now,
      validUntil: limits?.dailyLimit ? now + 30 * 24 * 60 * 60 * 1000 : undefined,
      createdAt: now,
    };
    store.delegations.set(delegation.id, delegation);
    fromIdentity.delegations.push(delegation);
    fromIdentity.updatedAt = now;
    return delegation;
  }

  /**
   * Check whether `identityId` is allowed to perform `action` (with optional
   * `amount` for financial scope checks).
   *
   * Returns `{ allowed: true, delegation }` when a matching, valid
   * delegation exists. Returns `{ allowed: false, reason }` otherwise.
   */
  async canAct(
    identityId: string,
    action: string,
    amount?: number,
  ): Promise<CanActResult> {
    // Find all delegations where this identity is the "to" side and the
    // scope covers the action.
    const matching: Delegation[] = [];
    for (const dlg of store.delegations.values()) {
      if (dlg.toIdentityId !== identityId) continue;
      if (dlg.revokedAt) continue;
      if (!dlg.scope.some((s) => action === s || action.startsWith(`${s}:`))) continue;
      matching.push(dlg);
    }

    if (matching.length === 0) {
      return { allowed: false, reason: `No delegation grants '${action}' to ${identityId}` };
    }

    const now = Date.now();
    for (const dlg of matching) {
      if (dlg.validFrom > now) continue;
      if (dlg.validUntil && dlg.validUntil < now) continue;

      // The "from" identity must still be active.
      const fromIdentity = identityRegistry.getSync(dlg.fromIdentityId);
      if (!fromIdentity || fromIdentity.status !== 'active') continue;

      // Amount check.
      if (amount !== undefined && dlg.limits?.maxAmount !== undefined) {
        if (amount > dlg.limits.maxAmount) {
          continue;
        }
      }

      return { allowed: true, delegation: dlg };
    }

    return { allowed: false, reason: `All matching delegations are expired / over-limit / from-inactive` };
  }

  /** List delegations made BY an identity (who they delegated to). */
  async listFrom(identityId: string): Promise<Delegation[]> {
    return Array.from(store.delegations.values()).filter((d) => d.fromIdentityId === identityId);
  }

  /** List delegations made TO an identity (who can act on their behalf). */
  async listTo(identityId: string): Promise<Delegation[]> {
    return Array.from(store.delegations.values()).filter((d) => d.toIdentityId === identityId);
  }

  /** Revoke a delegation. */
  async revoke(delegationId: string, reason?: string): Promise<void> {
    const dlg = store.delegations.get(delegationId);
    if (!dlg) return;
    dlg.revokedAt = Date.now();
    dlg.revokedReason = reason;
    // Drop from the from-identity's list.
    const from = identityRegistry.getSync(dlg.fromIdentityId);
    if (from) {
      const idx = from.delegations.findIndex((d) => d.id === delegationId);
      if (idx >= 0) from.delegations.splice(idx, 1);
      from.updatedAt = Date.now();
    }
  }

  /** Lookup by ID. */
  getSync(delegationId: string): Delegation | null {
    return store.delegations.get(delegationId) ?? null;
  }

  /** All delegations (admin overview). */
  listAll(): Delegation[] {
    return Array.from(store.delegations.values());
  }
}

export const delegationManager = new DelegationManager();
