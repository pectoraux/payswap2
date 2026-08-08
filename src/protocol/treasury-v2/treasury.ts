/**
 * PaySwap Protocol — Treasury Operations Center (v2) — Treasury Engine.
 *
 * High-level facade that binds every treasury sub-service together.
 * This is the single entry point the protocol layer (settlement
 * engine, mint/burn service, etc.) uses to interact with the
 * treasury.
 *
 * Public contract:
 *   - `init(opts)`             — wire up dependencies, start periodic
 *                                 checks (reserve refresh + forecast
 *                                 refresh). Returns `stop` functions.
 *   - `preMintHook(asset, amt)` — the GATE every mint goes through.
 *                                 Checks (in order): freeze status,
 *                                 daily limit, per-tx limit, cooldown,
 *                                 backing sufficiency. Returns
 *                                 `{allowed, reason?}` — `allowed: false`
 *                                 blocks the mint.
 *   - `preBurnHook(asset, amt)` — the GATE every burn goes through.
 *                                 Checks: freeze status, daily limit,
 *                                 per-tx limit. Returns `{allowed, reason?}`.
 *   - `status()`                — the live `TreasuryReport` snapshot.
 *   - `dailyReport()`           — alias for `treasuryReports.generateDailyTreasuryReport()`.
 *   - `runStressTests()`        — runs all stress test scenarios.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `treasury.pre_mint_blocked`  — when preMintHook blocks a mint.
 *  - `treasury.pre_mint_approved` — when preMintHook approves a mint.
 *  - `treasury.pre_burn_blocked`  — when preBurnHook blocks a burn.
 *  - `treasury.pre_burn_approved` — when preBurnHook approves a burn.
 *  - `treasury.periodic_check`    — after each periodic reserve check.
 *
 * The kernel is FROZEN — this module imports only `nowTs` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`. No
 * kernel files are modified.
 */
import { nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type {
  LimitCheckResult,
  TreasuryReport,
  TreasuryEngineOptions,
} from './types';
import { reserveMonitor } from './reserve-monitor';
import { mintLimitEngine, burnLimitEngine } from './limits';
import { backingVerifier } from './backing';
import { liquidityForecaster } from './forecasting';
import { corridorFundingService } from './corridor-funding';
import { lpProfitabilityService } from './lp-profitability';
import { stressTestService } from './stress-test';
import { treasuryReports } from './reports';
import { emergencyFreezeEngine } from './freezes';

/** Outcome of a pre-mint / pre-burn hook. */
export interface HookResult extends LimitCheckResult {
  /** The checks that were performed + their outcomes. */
  checks: Array<{ name: string; passed: boolean; reason?: string }>;
}

/**
 * Treasury engine — the financial control tower facade.
 */
export class TreasuryEngine {
  private initialised = false;
  private opts: Required<TreasuryEngineOptions>;
  private timers: Array<() => void> = [];

  constructor(opts?: TreasuryEngineOptions) {
    this.opts = {
      checkIntervalMs: opts?.checkIntervalMs ?? 60_000,
      forecastIntervalMs: opts?.forecastIntervalMs ?? 300_000,
      defaultReserveAlertThreshold: opts?.defaultReserveAlertThreshold ?? 0.20,
      costOfCapitalApr: opts?.costOfCapitalApr ?? 0.08,
      opexPerSettlement: opts?.opexPerSettlement ?? 0.10,
    };
  }

  /**
   * Initialise the treasury engine — wire up cross-service
   * dependencies and start periodic checks.
   *
   * Returns an array of `stop` functions (one per periodic task).
   * Call each to stop the corresponding periodic check.
   */
  init(initOpts?: TreasuryEngineOptions): Array<() => void> {
    if (initOpts) {
      this.opts = {
        checkIntervalMs: initOpts.checkIntervalMs ?? this.opts.checkIntervalMs,
        forecastIntervalMs: initOpts.forecastIntervalMs ?? this.opts.forecastIntervalMs,
        defaultReserveAlertThreshold: initOpts.defaultReserveAlertThreshold ?? this.opts.defaultReserveAlertThreshold,
        costOfCapitalApr: initOpts.costOfCapitalApr ?? this.opts.costOfCapitalApr,
        opexPerSettlement: initOpts.opexPerSettlement ?? this.opts.opexPerSettlement,
      };
    }

    // Wire up the reserve monitor's threshold default.
    reserveMonitor.setDefaultThreshold(this.opts.defaultReserveAlertThreshold);

    // Wire up the backing verifier's reserve resolver: for an asset
    // code like `TWINGHS`, the reserve is the available GHS balance.
    backingVerifier.setReserveResolver((assetCode) => {
      const currency = assetCode.startsWith('TWIN') ? assetCode.slice(4) : assetCode;
      return reserveMonitor.available(currency);
    });

    // Wire up LP profitability cost parameters.
    lpProfitabilityService.setCostOfCapitalApr(this.opts.costOfCapitalApr);
    lpProfitabilityService.setOpexPerSettlement(this.opts.opexPerSettlement);

    // Start periodic tasks.
    const stopCheck = this.startPeriodicCheck();
    const stopForecast = this.startPeriodicForecast();
    this.timers = [stopCheck, stopForecast];

    this.initialised = true;
    eventEngine.emit('treasury.initialized', {
      checkIntervalMs: this.opts.checkIntervalMs,
      forecastIntervalMs: this.opts.forecastIntervalMs,
      ts: nowTs(),
    });
    return this.timers;
  }

  /** Stop all periodic tasks. */
  shutdown(): void {
    for (const stop of this.timers) stop();
    this.timers = [];
    this.initialised = false;
    eventEngine.emit('treasury.shutdown', { ts: nowTs() });
  }

  /** Is the engine initialised? */
  isInitialised(): boolean {
    return this.initialised;
  }

  /**
   * Pre-mint hook — the GATE every mint goes through.
   *
   * Checks (in order):
   *   1. asset is not frozen (compliance hold)
   *   2. daily limit (24h rolling window)
   *   3. per-tx limit
   *   4. cooldown
   *   5. backing sufficiency
   *
   * Returns `{allowed: true}` if all checks pass; otherwise
   * `{allowed: false, reason}` with the first failing check's
   * reason. Emits `treasury.pre_mint_approved` or
   * `treasury.pre_mint_blocked` accordingly.
   */
  preMintHook(assetCode: string, amount: number): HookResult {
    const checks: HookResult['checks'] = [];

    // 1. freeze status
    const frozen = treasuryReports.isFrozen(assetCode);
    checks.push({
      name: 'freeze_status',
      passed: !frozen,
      reason: frozen ? 'asset_frozen' : undefined,
    });
    if (frozen) {
      const result: HookResult = {
        allowed: false,
        reason: `asset_frozen:${assetCode}`,
        checks,
      };
      this.emitMintBlocked(assetCode, amount, result);
      return result;
    }

    // 2-4. mint limit (daily + per-tx + cooldown in one call).
    const limitCheck = mintLimitEngine.checkMint(assetCode, amount);
    checks.push({
      name: 'mint_limit',
      passed: limitCheck.allowed,
      reason: limitCheck.reason,
    });
    if (!limitCheck.allowed) {
      const result: HookResult = {
        allowed: false,
        reason: limitCheck.reason,
        remainingDaily: limitCheck.remainingDaily,
        checks,
      };
      this.emitMintBlocked(assetCode, amount, result);
      return result;
    }

    // 5. backing sufficiency.
    const backingCheck = backingVerifier.onMint(assetCode, amount);
    checks.push({
      name: 'backing_sufficiency',
      passed: backingCheck.allowed,
      reason: backingCheck.reason,
    });
    if (!backingCheck.allowed) {
      const result: HookResult = {
        allowed: false,
        reason: backingCheck.reason,
        remainingDaily: limitCheck.remainingDaily,
        checks,
      };
      this.emitMintBlocked(assetCode, amount, result);
      return result;
    }

    const result: HookResult = {
      allowed: true,
      remainingDaily: limitCheck.remainingDaily,
      checks,
    };
    eventEngine.emit('treasury.pre_mint_approved', {
      assetCode, amount,
      remainingDaily: limitCheck.remainingDaily,
      ts: nowTs(),
    });
    return result;
  }

  /**
   * Pre-burn hook — the GATE every burn goes through.
   *
   * Checks (in order):
   *   1. asset is not frozen
   *   2. daily burn limit
   *   3. per-tx burn limit
   *
   * Burns are less risky than mints (burning reduces supply which
   * is always backed), so we skip the backing check.
   */
  preBurnHook(assetCode: string, amount: number): HookResult {
    const checks: HookResult['checks'] = [];

    const frozen = treasuryReports.isFrozen(assetCode);
    checks.push({
      name: 'freeze_status',
      passed: !frozen,
      reason: frozen ? 'asset_frozen' : undefined,
    });
    if (frozen) {
      const result: HookResult = {
        allowed: false,
        reason: `asset_frozen:${assetCode}`,
        checks,
      };
      this.emitBurnBlocked(assetCode, amount, result);
      return result;
    }

    const limitCheck = burnLimitEngine.checkBurn(assetCode, amount);
    checks.push({
      name: 'burn_limit',
      passed: limitCheck.allowed,
      reason: limitCheck.reason,
    });
    if (!limitCheck.allowed) {
      const result: HookResult = {
        allowed: false,
        reason: limitCheck.reason,
        remainingDaily: limitCheck.remainingDaily,
        checks,
      };
      this.emitBurnBlocked(assetCode, amount, result);
      return result;
    }

    const result: HookResult = {
      allowed: true,
      remainingDaily: limitCheck.remainingDaily,
      checks,
    };
    eventEngine.emit('treasury.pre_burn_approved', {
      assetCode, amount,
      remainingDaily: limitCheck.remainingDaily,
      ts: nowTs(),
    });
    return result;
  }

  /**
   * Confirm a mint — call after the on-chain mint succeeds to
   * update treasury state (limit usage, backing supply, reserve).
   * Throws if the mint was not pre-approved (defence in depth).
   */
  confirmMint(assetCode: string, amount: number): void {
    const pre = this.preMintHook(assetCode, amount);
    if (!pre.allowed) {
      throw new Error(`mint_not_approved:${pre.reason}`);
    }
    mintLimitEngine.recordMint(assetCode, amount);
    backingVerifier.recordMint(assetCode, amount);
    // Minting a TWIN token increases the reserve needed — but the
    // actual fiat backing must already be in the reserve (the
    // backing check verified it). So we don't credit the reserve
    // here; the fiat was credited when the LP deposited it.
    eventEngine.emit('treasury.mint_confirmed', { assetCode, amount, ts: nowTs() });
  }

  /**
   * Confirm a burn — call after the on-chain burn succeeds to
   * update treasury state (limit usage, backing supply).
   */
  confirmBurn(assetCode: string, amount: number): void {
    const pre = this.preBurnHook(assetCode, amount);
    if (!pre.allowed) {
      throw new Error(`burn_not_approved:${pre.reason}`);
    }
    burnLimitEngine.recordBurn(assetCode, amount);
    backingVerifier.recordBurn(assetCode, amount);
    eventEngine.emit('treasury.burn_confirmed', { assetCode, amount, ts: nowTs() });
  }

  /** Live treasury status — the canonical `TreasuryReport` snapshot. */
  status(): TreasuryReport {
    return treasuryReports.generateDailyTreasuryReport();
  }

  /** Alias for `status()` — the daily report. */
  dailyReport(): TreasuryReport {
    return this.status();
  }

  /** Lift (remove) a freeze by id. Delegates to the emergency freeze engine. */
  liftFreeze(freezeId: string): boolean {
    try {
      emergencyFreezeEngine.lift(freezeId);
      return true;
    } catch {
      return false;
    }
  }

  /** Reset all treasury sub-engines to their initial state. Test helper. */
  reset(): void {
    reserveMonitor.reset();
    backingVerifier.reset();
    mintLimitEngine.reset();
    burnLimitEngine.reset();
    emergencyFreezeEngine.reset();
    this.initialised = false;
    this.timers.forEach((stop) => { try { stop(); } catch { /* noop */ } });
    this.timers = [];
  }

  /** Record a mint (alias for confirmMint without the pre-check). */
  recordMint(assetCode: string, amount: number): void {
    mintLimitEngine.recordMint(assetCode, amount);
    backingVerifier.recordMint(assetCode, amount);
  }

  /** Record a burn (alias for confirmBurn without the pre-check). */
  recordBurn(assetCode: string, amount: number): void {
    burnLimitEngine.recordBurn(assetCode, amount);
    backingVerifier.recordBurn(assetCode, amount);
  }

  /** Run all stress test scenarios + return the results. */
  runStressTests() {
    return stressTestService.runAllScenarios();
  }

  // --------------------------------------------------------------- internals

  private emitMintBlocked(assetCode: string, amount: number, result: HookResult): void {
    eventEngine.emit('treasury.pre_mint_blocked', {
      assetCode, amount,
      reason: result.reason,
      checks: result.checks,
      ts: nowTs(),
    });
  }

  private emitBurnBlocked(assetCode: string, amount: number, result: HookResult): void {
    eventEngine.emit('treasury.pre_burn_blocked', {
      assetCode, amount,
      reason: result.reason,
      checks: result.checks,
      ts: nowTs(),
    });
  }

  /**
   * Start the periodic reserve + alert check. Returns a `stop`
   * function.
   *
   * Uses `setInterval` (server-side). Each tick:
   *   1. Scans all reserves for low-reserve conditions.
   *   2. Pushes any alerts into the report log.
   *   3. Emits `treasury.periodic_check`.
   */
  private startPeriodicCheck(): () => void {
    const interval = setInterval(() => {
      const alerts = reserveMonitor.scanForLowReserves();
      for (const a of alerts) treasuryReports.pushAlert(a);
      const shortfallAlerts = liquidityForecaster.shortfallAlerts();
      for (const sa of shortfallAlerts) {
        treasuryReports.pushAlert({
          id: sa.id,
          level: 'warning',
          category: 'forecast',
          message: `Corridor ${sa.corridor.from}->${sa.corridor.to} projects shortfall of ${sa.projectedShortfallAmount.toFixed(2)} at ${new Date(sa.projectedShortfallTs).toISOString()}`,
          ts: sa.ts,
          subject: `${sa.corridor.from}->${sa.corridor.to}`,
        });
      }
      eventEngine.emit('treasury.periodic_check', {
        alerts: alerts.length + shortfallAlerts.length,
        ts: nowTs(),
      });
    }, this.opts.checkIntervalMs);
    // Don't keep the Node.js process alive just for this timer.
    if (typeof interval === 'object' && interval && typeof interval.unref === 'function') {
      interval.unref();
    }
    return () => clearInterval(interval);
  }

  /**
   * Start the periodic liquidity forecast refresh. Returns a `stop`
   * function. Each tick scans for shortfall alerts (which auto-emit
   * `treasury.shortfall_alert` events).
   */
  private startPeriodicForecast(): () => void {
    const interval = setInterval(() => {
      liquidityForecaster.shortfallAlerts();
    }, this.opts.forecastIntervalMs);
    if (typeof interval === 'object' && interval && typeof interval.unref === 'function') {
      interval.unref();
    }
    return () => clearInterval(interval);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  var __PAYSWAP_TREASURY_ENGINE: TreasuryEngine | undefined;
}

export const treasuryEngine: TreasuryEngine =
  globalThis.__PAYSWAP_TREASURY_ENGINE ?? new TreasuryEngine();

if (!globalThis.__PAYSWAP_TREASURY_ENGINE) {
  globalThis.__PAYSWAP_TREASURY_ENGINE = treasuryEngine;
}
