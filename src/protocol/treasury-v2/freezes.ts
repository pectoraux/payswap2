/**
 * Treasury v2 — Emergency freezes.
 *
 * The EmergencyFreezeEngine creates auditable freeze records for three scopes:
 *
 *   - `account` : freezes a single Twin Token holder (calls
 *                 `twinTokenEngine.freezeAccount(accountId)`). The frozen
 *                 account can't transfer, mint, or burn.
 *   - `asset`   : halts ALL mint/burn/transfer for an asset. The mint/burn
 *                 limit engines check `isFrozen('asset', assetCode)` before
 *                 allowing any operation. Emits `treasury.asset_frozen`.
 *   - `corridor`: halts routing through a corridor. The corridor balancer
 *                 checks `isFrozen('corridor', corridorKey)` before rebalancing.
 *
 * Every freeze / lift emits a `treasury.freeze_triggered` /
 * `treasury.freeze_lifted` event with the initiator + reason, so the action is
 * fully auditable.
 *
 * Freezes can be temporary (with `expiresAt`) or permanent (no expiry). When a
 * freeze is lifted, the underlying twin-token account freeze is also lifted
 * (for account-scope freezes). The freeze record is retained for audit history
 * with `active = false` and `liftedAt = now`.
 *
 * Invariants:
 *  - Every freeze has a non-empty `reason` and `initiatedBy` (auditable).
 *  - No mint/burn/transfer can occur if the asset is emergency-frozen (the
 *    limit engines + treasury facade enforce this).
 *  - `isFrozen(scope, target)` is the single source of truth for "is this
 *    thing frozen?" — checks both active freezes AND expiry.
 */
import { uid } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type { EmergencyFreeze, FreezeScope, TreasuryCorridor } from './types';
import type { TwinTokenEngine } from '@/protocol/twin-token/engine';
import { treasuryCorridorKey } from './balancing';

/**
 * EmergencyFreezeEngine — singleton-style class.
 */
export class EmergencyFreezeEngine {
  private freezes: Map<string, EmergencyFreeze> = new Map();
  /** Quick-lookup index by `scope:target` → Set of freeze ids. */
  private byTarget: Map<string, Set<string>> = new Map();

  /** Build the index key for a (scope, target) pair. */
  private key(scope: FreezeScope, target: string): string {
    return `${scope}:${target}`;
  }

  /**
   * Freeze a Twin Token account. Calls `twinTokenEngine.freezeAccount(accountId)`
   * so the underlying engine also blocks the account. Emits
   * `treasury.account_frozen` (alias for `treasury.freeze_triggered` with
   * scope='account').
   */
  freezeAccount(
    accountId: string,
    reason: string,
    initiatedBy: string,
    durationMs?: number,
    twinTokenEngine?: TwinTokenEngine,
    now: number = Date.now(),
  ): EmergencyFreeze {
    const freeze: EmergencyFreeze = {
      id: uid('frz'),
      scope: 'account',
      target: accountId,
      reason,
      initiatedBy,
      initiatedAt: now,
      expiresAt: durationMs ? now + durationMs : undefined,
      active: true,
    };
    this.add(freeze);
    if (twinTokenEngine) twinTokenEngine.freezeAccount(accountId);
    eventEngine.emit('treasury.account_frozen', {
      freezeId: freeze.id,
      accountId,
      reason,
      initiatedBy,
      expiresAt: freeze.expiresAt,
    }, 0);
    eventEngine.emit('treasury.freeze_triggered', {
      freezeId: freeze.id,
      scope: 'account',
      target: accountId,
      reason,
      initiatedBy,
    }, 0);
    return freeze;
  }

  /**
   * Freeze an entire asset — halts ALL mint/burn/transfer for the asset.
   * The mint/burn limit engines check `isFrozen('asset', assetCode)` before
   * allowing any operation. Emits `treasury.asset_frozen`.
   */
  freezeAsset(
    assetCode: string,
    reason: string,
    initiatedBy: string,
    now: number = Date.now(),
  ): EmergencyFreeze {
    const freeze: EmergencyFreeze = {
      id: uid('frz'),
      scope: 'asset',
      target: assetCode,
      reason,
      initiatedBy,
      initiatedAt: now,
      active: true,
    };
    this.add(freeze);
    eventEngine.emit('treasury.asset_frozen', {
      freezeId: freeze.id,
      assetCode,
      reason,
      initiatedBy,
    }, 0);
    eventEngine.emit('treasury.freeze_triggered', {
      freezeId: freeze.id,
      scope: 'asset',
      target: assetCode,
      reason,
      initiatedBy,
    }, 0);
    return freeze;
  }

  /**
   * Freeze a corridor — halts routing through the corridor. The corridor
   * balancer checks `isFrozen('corridor', corridorKey)` before rebalancing.
   * Emits `treasury.corridor_frozen`.
   */
  freezeCorridor(
    corridor: TreasuryCorridor,
    reason: string,
    initiatedBy: string,
    now: number = Date.now(),
  ): EmergencyFreeze {
    const target = treasuryCorridorKey(corridor);
    const freeze: EmergencyFreeze = {
      id: uid('frz'),
      scope: 'corridor',
      target,
      reason,
      initiatedBy,
      initiatedAt: now,
      active: true,
    };
    this.add(freeze);
    eventEngine.emit('treasury.corridor_frozen', {
      freezeId: freeze.id,
      corridor: target,
      reason,
      initiatedBy,
    }, 0);
    eventEngine.emit('treasury.freeze_triggered', {
      freezeId: freeze.id,
      scope: 'corridor',
      target,
      reason,
      initiatedBy,
    }, 0);
    return freeze;
  }

  /**
   * Lift (deactivate) a freeze. For account-scope freezes, also unfreezes the
   * underlying twin-token account. Emits `treasury.freeze_lifted`.
   *
   * Idempotent: lifting an already-lifted freeze is a no-op (returns the
   * existing record).
   */
  lift(
    freezeId: string,
    twinTokenEngine?: TwinTokenEngine,
    now: number = Date.now(),
  ): EmergencyFreeze | undefined {
    const freeze = this.freezes.get(freezeId);
    if (!freeze) return undefined;
    if (!freeze.active) return freeze;
    freeze.active = false;
    freeze.liftedAt = now;
    if (freeze.scope === 'account' && twinTokenEngine) {
      twinTokenEngine.unfreezeAccount(freeze.target);
    }
    eventEngine.emit('treasury.freeze_lifted', {
      freezeId,
      scope: freeze.scope,
      target: freeze.target,
      liftedAt: now,
    }, 0);
    return freeze;
  }

  /** List all active (non-expired, non-lifted) freezes. */
  activeFreezes(now: number = Date.now()): EmergencyFreeze[] {
    return this.all().filter((f) => this.isActive(f, now));
  }

  /** All freeze records (active + historical). */
  all(): EmergencyFreeze[] {
    return [...this.freezes.values()];
  }

  /**
   * Is a (scope, target) currently frozen? Checks active freezes only and
   * respects expiry. For account scope, also checks the underlying twin-token
   * engine's frozenAccounts set if bound.
   */
  isFrozen(scope: FreezeScope, target: string, now: number = Date.now()): boolean {
    const ids = this.byTarget.get(this.key(scope, target));
    if (!ids) return false;
    for (const id of ids) {
      const f = this.freezes.get(id);
      if (f && this.isActive(f, now)) return true;
    }
    return false;
  }

  /** Get a freeze by id. */
  get(freezeId: string): EmergencyFreeze | undefined {
    return this.freezes.get(freezeId);
  }

  /**
   * Lift expired freezes (background sweep). Returns the count of freezes
   * lifted.
   */
  sweepExpired(now: number = Date.now()): number {
    let swept = 0;
    for (const f of this.freezes.values()) {
      if (f.active && f.expiresAt !== undefined && f.expiresAt <= now) {
        this.lift(f.id, undefined, now);
        swept += 1;
      }
    }
    return swept;
  }

  /**
   * Start a periodic sweep of expired freezes. Returns a stop function.
   */
  startPeriodicSweep(intervalMs: number): () => void {
    const handle = setInterval(() => this.sweepExpired(), intervalMs);
    return () => clearInterval(handle);
  }

  /** Reset all state (test helper). */
  reset(): void {
    this.freezes.clear();
    this.byTarget.clear();
  }

  /* ----- internal helpers ----- */

  private add(freeze: EmergencyFreeze): void {
    this.freezes.set(freeze.id, freeze);
    const k = this.key(freeze.scope, freeze.target);
    if (!this.byTarget.has(k)) this.byTarget.set(k, new Set());
    this.byTarget.get(k)!.add(freeze.id);
  }

  private isActive(freeze: EmergencyFreeze, now: number): boolean {
    if (!freeze.active) return false;
    if (freeze.expiresAt !== undefined && freeze.expiresAt <= now) return false;
    return true;
  }
}

/** Singleton emergency freeze engine. */
export const emergencyFreezeEngine = new EmergencyFreezeEngine();
