/**
 * Treasury v2 — High-level facade.
 *
 * The TreasuryEngine wires together every treasury subsystem (reserve monitor,
 * limit engines, backing verifier, freeze engine, alert engine, yield engine,
 * corridor balancer) and exposes a single entry point for the rest of the
 * protocol.
 *
 * Responsibilities:
 *   - `init(opts)`: bind the twin-token engine + stellar adapter + liquidity
 *     network, start periodic background checks (reserve sync, backing verify,
 *     alert checks, corridor balancing, freeze sweep). Returns an object with
 *     a `stopAll()` function and individual stop callbacks.
 *   - `preMintHook(assetCode, amount)`: called by the twin-token engine before
 *     minting. Checks (in order): asset freeze, mint limit, backing sufficiency.
 *     Returns `{ allowed: boolean; reason? }`.
 *   - `preBurnHook(assetCode, amount)`: same for burns. Checks: asset freeze,
 *     burn limit. (Backing is always improved by burning — no check needed.)
 *   - `preTransferHook(assetCode, amount, from, to)`: checks asset freeze and
 *     account freeze.
 *   - `status()`: a full treasury snapshot (alias to generateDailyTreasuryReport).
 *   - `dailyReport()`: same as status(), explicit name for the daily report.
 *
 * Invariants enforced by the facade:
 *  1. No mint can exceed the daily limit or per-tx limit (checked by
 *     `mintLimitEngine.checkMint`).
 *  2. No mint can occur if backing is insufficient (checked by
 *     `backingVerifier.onMint`).
 *  3. No mint/burn/transfer can occur if the asset is emergency-frozen
 *     (checked by `emergencyFreezeEngine.isFrozen`).
 *  4. Backing ratio is always ≥ 1.0 after a successful backing verification OR
 *     an alert is raised (the alert engine raises `backing_mismatch` alerts on
 *     the periodic check + on the pre-mint hook denial).
 *  5. Emergency freezes are auditable (every freeze / lift emits an event with
 *     initiator + reason — enforced by `EmergencyFreezeEngine`).
 */
import { round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type { TwinTokenEngine } from '@/protocol/twin-token/engine';
import type { StellarAdapter } from '@/protocol/blockchains/stellar/adapter';
import type { LiquidityNetwork } from '@/protocol/liquidity-network';

import type { HookResult, TreasuryReport } from './types';
import { reserveMonitor, type ReserveMonitor } from './reserve';
import { mintLimitEngine, burnLimitEngine, type MintLimitEngine, type BurnLimitEngine } from './limits';
import { backingVerifier, type BackingVerifier } from './backing';
import { corridorBalancer, type CorridorBalancer } from './balancing';
import { emergencyFreezeEngine, type EmergencyFreezeEngine } from './freezes';
import { alertEngine, type AlertEngine } from './alerts';
import { yieldEngine, type YieldEngine } from './yield';
import {
  generateDailyTreasuryReport,
  generateSettlementReport,
  generateCapitalReport,
  type ReportDeps,
  type SettlementReport,
  type CapitalReport,
} from './reports';
import type { TreasuryCorridor } from './types';

/** Options for `TreasuryEngine.init()`. */
export interface TreasuryInitOpts {
  twinTokenEngine: TwinTokenEngine;
  stellarAdapter?: StellarAdapter;
  liquidityNetwork?: LiquidityNetwork;
  /** Periodic check intervals (ms). Defaults: 60s reserve sync, 30s backing verify, 30s alerts, 60s corridor balancing, 60s freeze sweep. */
  intervals?: {
    reserveSyncMs?: number;
    backingVerifyMs?: number;
    alertCheckMs?: number;
    corridorBalanceMs?: number;
    freezeSweepMs?: number;
  };
  /** Low-reserve thresholds per currency (for the alert check). */
  lowReserveThresholds?: Record<string, number>;
}

/** Result of `TreasuryEngine.init()` — holds the stop callbacks. */
export interface TreasuryInitResult {
  /** Stop all periodic checks. */
  stopAll: () => void;
  /** Individual stop functions (one per periodic check). */
  stops: Array<() => void>;
}

/**
 * TreasuryEngine — high-level facade tying together all treasury subsystems.
 */
export class TreasuryEngine {
  /** Bound twin-token engine (set on init). */
  private twinTokenEngine: TwinTokenEngine | null = null;
  /** Bound stellar adapter (optional — set on init if supplied). */
  private stellarAdapter: StellarAdapter | null = null;
  /** Bound liquidity network (optional — set on init if supplied). */
  private liquidityNetwork: LiquidityNetwork | null = null;
  /** Low-reserve thresholds for the periodic alert check. */
  private lowReserveThresholds: Record<string, number> = {};
  /** Stop callbacks from the last init() call. */
  private stops: Array<() => void> = [];

  /**
   * Initialize the treasury engine: bind dependencies, start periodic checks.
   * Returns an object with `stopAll()` and individual `stops`.
   *
   * Calling `init()` multiple times will stop the previous periodic checks
   * before starting new ones (idempotent re-init).
   */
  init(opts: TreasuryInitOpts): TreasuryInitResult {
    // Stop any previously-started periodic checks.
    this.stopAll();

    this.twinTokenEngine = opts.twinTokenEngine;
    this.stellarAdapter = opts.stellarAdapter ?? null;
    this.liquidityNetwork = opts.liquidityNetwork ?? null;
    this.lowReserveThresholds = opts.lowReserveThresholds ?? {};

    // Bind the twin-token engine to the reserve monitor so backing ratios are
    // computed from live circulating / escrowed numbers.
    reserveMonitor.bindTwinTokenEngine(opts.twinTokenEngine);

    const intervals = opts.intervals ?? {};
    const reserveSyncMs = intervals.reserveSyncMs ?? 60_000;
    const backingVerifyMs = intervals.backingVerifyMs ?? 30_000;
    const alertCheckMs = intervals.alertCheckMs ?? 30_000;
    const corridorBalanceMs = intervals.corridorBalanceMs ?? 60_000;
    const freezeSweepMs = intervals.freezeSweepMs ?? 60_000;

    const stops: Array<() => void> = [];

    // 1. Periodic reserve sync (async — fire and forget).
    if (this.stellarAdapter) {
      const handle = setInterval(() => {
        void reserveMonitor.syncFromChain(this.stellarAdapter!);
      }, reserveSyncMs);
      stops.push(() => clearInterval(handle));
    }

    // 2. Periodic backing verification.
    {
      const handle = setInterval(() => {
        if (!this.twinTokenEngine) return;
        const { allVerified, results } = backingVerifier.verifyAll(
          this.twinTokenEngine,
          reserveMonitor,
        );
        if (!allVerified) {
          for (const r of results) {
            if (!r.verified) {
              alertEngine.raise({
                severity: 'critical',
                type: 'backing_mismatch',
                assetCode: r.assetCode,
                target: r.assetCode,
                message: `Backing mismatch for ${r.assetCode}: ratio=${r.backingRatio}, discrepancy=${r.discrepancy}`,
              });
            }
          }
        }
      }, backingVerifyMs);
      stops.push(() => clearInterval(handle));
    }

    // 3. Periodic alert checks (reserves + corridors).
    {
      const handle = setInterval(() => {
        alertEngine.checkReserves(reserveMonitor, this.lowReserveThresholds);
        if (this.twinTokenEngine) {
          alertEngine.checkBacking(backingVerifier, this.twinTokenEngine, reserveMonitor);
        }
        alertEngine.checkCorridors(corridorBalancer, reserveMonitor);
      }, alertCheckMs);
      stops.push(() => clearInterval(handle));
    }

    // 4. Periodic corridor balancing.
    if (this.liquidityNetwork) {
      const handle = setInterval(() => {
        corridorBalancer.rebalanceAll(this.liquidityNetwork!, reserveMonitor);
      }, corridorBalanceMs);
      stops.push(() => clearInterval(handle));
    }

    // 5. Periodic freeze sweep (lift expired freezes).
    {
      const handle = setInterval(() => {
        emergencyFreezeEngine.sweepExpired();
      }, freezeSweepMs);
      stops.push(() => clearInterval(handle));
    }

    this.stops = stops;

    eventEngine.emit('treasury.initialized', {
      intervals: { reserveSyncMs, backingVerifyMs, alertCheckMs, corridorBalanceMs, freezeSweepMs },
      hasStellarAdapter: this.stellarAdapter !== null,
      hasLiquidityNetwork: this.liquidityNetwork !== null,
    }, 0);

    return {
      stops,
      stopAll: () => this.stopAll(),
    };
  }

  /** Stop all periodic checks started by `init()`. */
  stopAll(): void {
    for (const stop of this.stops) {
      try { stop(); } catch { /* ignore */ }
    }
    this.stops = [];
  }

  /**
   * Pre-mint hook — called by the twin-token engine before minting. Checks:
   *   1. Asset is not emergency-frozen.
   *   2. Mint limit allows the amount (daily + per-tx + cooldown).
   *   3. Reserve can back the new tokens.
   *
   * Returns `{ allowed: true }` if all checks pass, otherwise
   * `{ allowed: false, reason }`.
   */
  preMintHook(assetCode: string, amount: number): HookResult {
    // 1. Asset freeze check.
    if (emergencyFreezeEngine.isFrozen('asset', assetCode)) {
      eventEngine.emit('treasury.mint_blocked', {
        assetCode, amount, reason: 'asset_frozen',
      }, 0);
      return { allowed: false, reason: 'asset_frozen' };
    }

    // 2. Mint limit check.
    const limitCheck = mintLimitEngine.checkMint(assetCode, amount);
    if (!limitCheck.allowed) {
      alertEngine.raise({
        severity: 'warning',
        type: 'mint_limit_exceeded',
        assetCode,
        target: assetCode,
        message: `Mint of ${amount} ${assetCode} blocked: ${limitCheck.reason}`,
      });
      eventEngine.emit('treasury.mint_blocked', {
        assetCode, amount, reason: limitCheck.reason, remainingDaily: limitCheck.remainingDaily,
      }, 0);
      return { allowed: false, reason: limitCheck.reason };
    }

    // 3. Backing check.
    if (this.twinTokenEngine) {
      const canBack = backingVerifier.onMint(
        assetCode, amount, this.twinTokenEngine, reserveMonitor,
      );
      if (!canBack) {
        alertEngine.raise({
          severity: 'critical',
          type: 'backing_mismatch',
          assetCode,
          target: assetCode,
          message: `Mint of ${amount} ${assetCode} blocked: insufficient reserve to back post-mint liabilities`,
        });
        eventEngine.emit('treasury.mint_blocked', {
          assetCode, amount, reason: 'backing_insufficient',
        }, 0);
        return { allowed: false, reason: 'backing_insufficient' };
      }
    }

    return { allowed: true };
  }

  /**
   * Pre-burn hook — called by the twin-token engine before burning. Checks:
   *   1. Asset is not emergency-frozen.
   *   2. Burn limit allows the amount.
   *
   * (Backing is always improved by burning — no check needed.)
   */
  preBurnHook(assetCode: string, amount: number): HookResult {
    if (emergencyFreezeEngine.isFrozen('asset', assetCode)) {
      eventEngine.emit('treasury.burn_blocked', {
        assetCode, amount, reason: 'asset_frozen',
      }, 0);
      return { allowed: false, reason: 'asset_frozen' };
    }

    const limitCheck = burnLimitEngine.checkBurn(assetCode, amount);
    if (!limitCheck.allowed) {
      eventEngine.emit('treasury.burn_blocked', {
        assetCode, amount, reason: limitCheck.reason, remainingDaily: limitCheck.remainingDaily,
      }, 0);
      return { allowed: false, reason: limitCheck.reason };
    }

    return { allowed: true };
  }

  /**
   * Pre-transfer hook — called by the twin-token engine before a transfer.
   * Checks:
   *   1. Asset is not emergency-frozen.
   *   2. Sender account is not emergency-frozen (in addition to the twin-token
   *      engine's own compliance freeze).
   */
  preTransferHook(assetCode: string, _amount: number, from: string): HookResult {
    if (emergencyFreezeEngine.isFrozen('asset', assetCode)) {
      eventEngine.emit('treasury.transfer_blocked', {
        assetCode, from, reason: 'asset_frozen',
      }, 0);
      return { allowed: false, reason: 'asset_frozen' };
    }
    if (emergencyFreezeEngine.isFrozen('account', from)) {
      eventEngine.emit('treasury.transfer_blocked', {
        assetCode, from, reason: 'account_frozen',
      }, 0);
      return { allowed: false, reason: 'account_frozen' };
    }
    return { allowed: true };
  }

  /**
   * Record a successful mint — the twin-token engine calls this AFTER a mint
   * is confirmed on-chain. Updates the mint limit engine's daily used counter
   * and updates the reserve's `reserved` to reflect the new liability.
   */
  recordMint(assetCode: string, amount: number): void {
    mintLimitEngine.recordMint(assetCode, amount);
    // Increase the reserve's `reserved` to reflect the new liability.
    const currency = assetCode.startsWith('TWIN') ? assetCode.slice(4) : assetCode;
    const r = reserveMonitor.getReserve(currency);
    if (r) {
      reserveMonitor.setReserve(currency, r.balance, round(r.reserved + amount, 6));
    }
    reserveMonitor.refreshBackingRatios();
  }

  /**
   * Record a successful burn — updates the burn limit engine's daily used
   * counter and reduces the reserve's `reserved`.
   */
  recordBurn(assetCode: string, amount: number): void {
    burnLimitEngine.recordBurn(assetCode, amount);
    const currency = assetCode.startsWith('TWIN') ? assetCode.slice(4) : assetCode;
    const r = reserveMonitor.getReserve(currency);
    if (r) {
      reserveMonitor.setReserve(currency, r.balance, round(Math.max(0, r.reserved - amount), 6));
    }
    reserveMonitor.refreshBackingRatios();
  }

  /** Build a ReportDeps object from the engine's bound subsystems. */
  private deps(): ReportDeps {
    if (!this.twinTokenEngine) {
      throw new Error('TreasuryEngine not initialized — call init() first');
    }
    return {
      reserveMonitor,
      mintLimitEngine,
      burnLimitEngine,
      backingVerifier,
      alertEngine,
      yieldEngine,
      twinTokenEngine: this.twinTokenEngine,
      corridorBalancer,
      emergencyFreezeEngine,
    };
  }

  /** Convenience accessor — the bound reserve monitor (or the singleton). */
  getReserveMonitor(): ReserveMonitor { return reserveMonitor; }
  /** Convenience accessor — the singleton mint limit engine. */
  getMintLimitEngine(): MintLimitEngine { return mintLimitEngine; }
  /** Convenience accessor — the singleton burn limit engine. */
  getBurnLimitEngine(): BurnLimitEngine { return burnLimitEngine; }
  /** Convenience accessor — the singleton backing verifier. */
  getBackingVerifier(): BackingVerifier { return backingVerifier; }
  /** Convenience accessor — the singleton alert engine. */
  getAlertEngine(): AlertEngine { return alertEngine; }
  /** Convenience accessor — the singleton yield engine. */
  getYieldEngine(): YieldEngine { return yieldEngine; }
  /** Convenience accessor — the singleton corridor balancer. */
  getCorridorBalancer(): CorridorBalancer { return corridorBalancer; }
  /** Convenience accessor — the singleton emergency freeze engine. */
  getEmergencyFreezeEngine(): EmergencyFreezeEngine { return emergencyFreezeEngine; }

  /** Full treasury snapshot — same as `dailyReport()`. */
  status(now: number = Date.now()): TreasuryReport {
    return generateDailyTreasuryReport(now, this.deps());
  }

  /** Daily treasury report. */
  dailyReport(now: number = Date.now()): TreasuryReport {
    return generateDailyTreasuryReport(now, this.deps());
  }

  /** Settlement report for a period. */
  settlementReport(period: string, now: number = Date.now()): SettlementReport {
    return generateSettlementReport(period, this.deps(), now);
  }

  /** Capital report. */
  capitalReport(now: number = Date.now()): CapitalReport {
    return generateCapitalReport(this.deps(), now);
  }

  /**
   * Configure a corridor target envelope. Convenience wrapper around the
   * singleton corridor balancer.
   */
  configureCorridor(
    corridor: TreasuryCorridor,
    targetReserve: number,
    minReserve: number,
    maxReserve: number,
    rebalanceThreshold: number,
  ): void {
    corridorBalancer.configure({ corridor, targetReserve, minReserve, maxReserve, rebalanceThreshold });
  }

  /**
   * Emergency-freeze an asset. Convenience wrapper.
   */
  freezeAsset(assetCode: string, reason: string, initiatedBy: string): void {
    emergencyFreezeEngine.freezeAsset(assetCode, reason, initiatedBy);
  }

  /**
   * Lift an emergency freeze. Convenience wrapper.
   */
  liftFreeze(freezeId: string): void {
    emergencyFreezeEngine.lift(freezeId, this.twinTokenEngine ?? undefined);
  }

  /** Reset all subsystem state (test helper). */
  reset(): void {
    this.stopAll();
    this.twinTokenEngine = null;
    this.stellarAdapter = null;
    this.liquidityNetwork = null;
    this.lowReserveThresholds = {};
    reserveMonitor.reset();
    mintLimitEngine.reset();
    burnLimitEngine.reset();
    corridorBalancer.reset();
    emergencyFreezeEngine.reset();
    alertEngine.reset();
    yieldEngine.reset();
  }
}

/** Singleton treasury engine. */
export const treasuryEngine = new TreasuryEngine();
