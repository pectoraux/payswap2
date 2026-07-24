/**
 * Treasury v2 — Daily treasury reports.
 *
 * Pure functions that assemble treasury subsystem state into report objects.
 * Reports are READ-ONLY snapshots — they never mutate state. Three report
 * generators:
 *
 *   - `generateDailyTreasuryReport(asOfTs, deps)` — the comprehensive daily
 *     report. Pulls from reserve, limits, backing, alerts, yield, efficiency,
 *     corridors, and freezes.
 *   - `generateSettlementReport(period, deps)` — yield + reserve movements
 *     for a settlement period (used by the settlement team to reconcile).
 *   - `generateCapitalReport(deps)` — capital efficiency summary across all
 *     assets.
 *
 * Reports are pure functions of the treasury subsystem state.
 */
import { round } from '@/kernel/support';
import type {
  CapitalEfficiency,
  ReserveAccount,
  TreasuryReport,
  YieldRecord,
} from './types';
import type { ReserveMonitor } from './reserve';
import type { MintLimitEngine, BurnLimitEngine } from './limits';
import type { BackingVerifier } from './backing';
import type { AlertEngine } from './alerts';
import type { YieldEngine } from './yield';
import type { TwinTokenEngine } from '@/protocol/twin-token/engine';
import type { CorridorBalancer } from './balancing';
import type { EmergencyFreezeEngine } from './freezes';
import { efficiencyReport } from './efficiency';

/** Dependencies for report generation — passed in explicitly for testability. */
export interface ReportDeps {
  reserveMonitor: ReserveMonitor;
  mintLimitEngine: MintLimitEngine;
  burnLimitEngine: BurnLimitEngine;
  backingVerifier: BackingVerifier;
  alertEngine: AlertEngine;
  yieldEngine: YieldEngine;
  twinTokenEngine: TwinTokenEngine;
  corridorBalancer: CorridorBalancer;
  emergencyFreezeEngine: EmergencyFreezeEngine;
  /** Optional map of assetCode → annualized tx volume (for efficiency velocity). */
  txVolumeMap?: Record<string, number>;
}

/**
 * Generate the comprehensive daily treasury report. Pulls from every
 * subsystem and assembles a `TreasuryReport`.
 *
 *   - `reserves`         : all reserve accounts from the reserve monitor.
 *   - `backingVerified`  : true iff every Twin Token asset is fully backed.
 *   - `mintUsage`        : per-asset mint limit usage (dailyUsed, dailyLimit, remaining).
 *   - `burnUsage`        : per-asset burn limit usage.
 *   - `alerts`           : active (unresolved) alerts.
 *   - `yields`           : all yield records.
 *   - `capitalEfficiency`: per-asset capital efficiency metrics.
 *   - `corridors`        : all configured corridor targets.
 *   - `frozenAssets`     : list of asset codes currently emergency-frozen.
 */
export function generateDailyTreasuryReport(asOfTs: number, deps: ReportDeps): TreasuryReport {
  const reserves: ReserveAccount[] = deps.reserveMonitor.allReserves();

  const { allVerified } = deps.backingVerifier.verifyAll(
    deps.twinTokenEngine,
    deps.reserveMonitor,
  );

  const mintUsage = deps.mintLimitEngine.all().map((l) => ({
    assetCode: l.assetCode,
    dailyUsed: l.dailyUsed,
    dailyLimit: l.dailyLimit,
    remaining: round(Math.max(0, l.dailyLimit - l.dailyUsed), 6),
  }));

  const burnUsage = deps.burnLimitEngine.all().map((l) => ({
    assetCode: l.assetCode,
    dailyUsed: l.dailyUsed,
    dailyLimit: l.dailyLimit,
    remaining: round(Math.max(0, l.dailyLimit - l.dailyUsed), 6),
  }));

  const alerts = deps.alertEngine.active();

  const yields: YieldRecord[] = deps.yieldEngine.all();

  const capitalEfficiency: CapitalEfficiency[] = efficiencyReport(
    deps.twinTokenEngine,
    deps.reserveMonitor,
    deps.txVolumeMap,
  );

  const corridors = deps.corridorBalancer.all();

  // Frozen assets: any asset-scope freeze that's currently active.
  const frozenAssets: string[] = deps.emergencyFreezeEngine
    .activeFreezes(asOfTs)
    .filter((f) => f.scope === 'asset')
    .map((f) => f.target);

  return {
    asOfTs,
    reserves,
    backingVerified: allVerified,
    mintUsage,
    burnUsage,
    alerts,
    yields,
    capitalEfficiency,
    corridors,
    frozenAssets,
  };
}

/**
 * Per-asset settlement-period summary: yield earned + reserve movement over
 * the period. Used by the settlement team to reconcile per-period books.
 */
export interface SettlementReport {
  period: string;
  asOfTs: number;
  perAsset: {
    assetCode: string;
    currency: string;
    grossYield: number;
    netYield: number;
    apy: number;
    reserve: number;
    circulating: number;
    escrowed: number;
    backingRatio: number;
  }[];
  totalGrossYield: number;
  totalNetYield: number;
}

/**
 * Generate a settlement-period report — yield + reserve snapshot for every
 * asset, for a given period label (e.g. '2024-06-01' or '2024-W22').
 */
export function generateSettlementReport(
  period: string,
  deps: ReportDeps,
  now: number = Date.now(),
): SettlementReport {
  const perAsset = deps.twinTokenEngine.allAssets().map((asset) => {
    const yields = deps.yieldEngine.yieldHistory(asset.code).filter((y) => y.period === period);
    const grossYield = round(yields.reduce((s, y) => s + y.grossYield, 0), 6);
    const netYield = round(yields.reduce((s, y) => s + y.netYield, 0), 6);
    const apy = deps.yieldEngine.computeAPY(asset.code, deps.reserveMonitor, now);
    const reserve = deps.reserveMonitor.available(asset.currency);
    const liabilities = round(asset.circulating + asset.escrowed, 6);
    const backingRatio = liabilities > 0 ? round(reserve / liabilities, 6) : 1;
    return {
      assetCode: asset.code,
      currency: asset.currency,
      grossYield,
      netYield,
      apy,
      reserve,
      circulating: asset.circulating,
      escrowed: asset.escrowed,
      backingRatio,
    };
  });
  const totalGrossYield = round(perAsset.reduce((s, a) => s + a.grossYield, 0), 6);
  const totalNetYield = round(perAsset.reduce((s, a) => s + a.netYield, 0), 6);
  return {
    period,
    asOfTs: now,
    perAsset,
    totalGrossYield,
    totalNetYield,
  };
}

/**
 * Capital efficiency summary across all assets. Used by the treasury AI to
 * decide where to deploy idle reserves for higher yield.
 */
export interface CapitalReport {
  asOfTs: number;
  perAsset: CapitalEfficiency[];
  averageEfficiency: number;
  totalReserve: number;
  totalCirculating: number;
  totalEscrowed: number;
  overallBackingRatio: number;
}

/**
 * Generate a capital-efficiency summary report. Aggregates per-asset metrics
 * into a portfolio-level view.
 */
export function generateCapitalReport(deps: ReportDeps, now: number = Date.now()): CapitalReport {
  const perAsset = efficiencyReport(
    deps.twinTokenEngine,
    deps.reserveMonitor,
    deps.txVolumeMap,
  );
  const averageEfficiency = perAsset.length > 0
    ? round(perAsset.reduce((s, a) => s + a.efficiency, 0) / perAsset.length, 4)
    : 0;

  let totalReserve = 0;
  let totalCirculating = 0;
  let totalEscrowed = 0;
  for (const asset of deps.twinTokenEngine.allAssets()) {
    totalReserve = round(totalReserve + deps.reserveMonitor.available(asset.currency), 6);
    totalCirculating = round(totalCirculating + asset.circulating, 6);
    totalEscrowed = round(totalEscrowed + asset.escrowed, 6);
  }
  const totalLiabilities = round(totalCirculating + totalEscrowed, 6);
  const overallBackingRatio = totalLiabilities > 0
    ? round(totalReserve / totalLiabilities, 6)
    : 1;

  return {
    asOfTs: now,
    perAsset,
    averageEfficiency,
    totalReserve,
    totalCirculating,
    totalEscrowed,
    overallBackingRatio,
  };
}
