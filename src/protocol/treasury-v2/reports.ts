/**
 * PaySwap Protocol — Treasury Operations Center (v2) — Reports.
 *
 * Pure functions of treasury state. The reports module aggregates
 * the live state of every treasury sub-service into the canonical
 * `TreasuryReport` shape (daily snapshot), plus the
 * `SettlementReport` (settlement activity over a period) and the
 * `CapitalReport` (reserve + corridor allocation + efficiency).
 *
 * The reports are read-only — they never mutate state. They are
 * the canonical inputs to the daily treasury ops review + the
 * auditor's monthly examination.
 *
 * The kernel is FROZEN — this module imports only `nowTs` from
 * `@/kernel/support`. No kernel files are modified.
 */
import { nowTs } from '@/kernel/support';
import type {
  CapitalEfficiencySummary,
  CapitalReport,
  CorridorReserve,
  FrozenAsset,
  LimitUsageSummary,
  ReserveAccount,
  SettlementReport,
  TimeRange,
  TreasuryAlert,
  TreasuryReport,
} from './types';
import { corridorKey } from './types';
import { reserveMonitor } from './reserve-monitor';
import { mintLimitEngine, burnLimitEngine } from './limits';
import { backingVerifier } from './backing';
import { liquidityForecaster } from './forecasting';
import { corridorFundingService } from './corridor-funding';
import { lpProfitabilityService } from './lp-profitability';
import { stressTestService } from './stress-test';
import { emergencyFreezeEngine } from './freezes';

/** A treasury report generator — pure functions of treasury state. */
export class TreasuryReports {
  /** Tracks frozen assets (compliance hold). */
  private frozenAssets = new Map<string, FrozenAsset>();
  /** In-memory alert log (most recent N). */
  private alerts: TreasuryAlert[] = [];
  private maxAlerts = 500;

  /** Freeze an asset (compliance hold). */
  freezeAsset(assetCode: string, reason: string): void {
    this.frozenAssets.set(assetCode, {
      assetCode,
      reason,
      frozenAt: nowTs(),
    });
  }

  /** Unfreeze an asset. */
  unfreezeAsset(assetCode: string): void {
    this.frozenAssets.delete(assetCode);
  }

  /**
   * Is an asset currently frozen?
   *
   * Returns true iff EITHER:
   *   - the asset is in this generator's own `frozenAssets` map (set via
   *     `freezeAsset()`), OR
   *   - the `emergencyFreezeEngine` has an active asset-scope freeze for
   *     the same code (set via `emergencyFreezeEngine.freezeAsset()`).
   *
   * The second branch is what makes the pre-mint / pre-burn / pre-transfer
   * hooks honor emergency freezes — they all call `treasuryReports.isFrozen()`.
   */
  isFrozen(assetCode: string): boolean {
    if (this.frozenAssets.has(assetCode)) return true;
    return emergencyFreezeEngine.isFrozen('asset', assetCode);
  }

  /**
   * All currently-frozen assets.
   *
   * Merges this generator's own `frozenAssets` map with the active
   * asset-scope freezes in `emergencyFreezeEngine` so the daily report
   * shows every frozen asset regardless of which API the caller used.
   */
  frozenAssetList(): FrozenAsset[] {
    const out = new Map<string, FrozenAsset>();
    // Own freezes (set via `freezeAsset()`).
    for (const f of this.frozenAssets.values()) {
      out.set(f.assetCode, f);
    }
    // Emergency freezes (set via `emergencyFreezeEngine.freezeAsset()`).
    for (const ef of emergencyFreezeEngine.activeFreezes()) {
      if (ef.scope === 'asset' && !out.has(ef.target)) {
        out.set(ef.target, {
          assetCode: ef.target,
          reason: ef.reason,
          frozenAt: ef.initiatedAt,
        });
      }
    }
    return [...out.values()];
  }

  /** Push an alert into the in-memory log. */
  pushAlert(alert: TreasuryAlert): void {
    this.alerts.push(alert);
    if (this.alerts.length > this.maxAlerts) this.alerts.shift();
  }

  /** Recent alerts (most recent last). */
  recentAlerts(limit?: number): TreasuryAlert[] {
    return limit ? this.alerts.slice(-limit) : [...this.alerts];
  }

  /**
   * Generate the canonical daily treasury report — the snapshot
   * used by the daily ops review + the auditor's monthly exam.
   *
   * Aggregates: reserves, backing verification, mint/burn usage,
   * alerts, yields, capital efficiency, corridor funding, frozen
   * assets, LP profitability, and the latest stress test results.
   */
  generateDailyTreasuryReport(): TreasuryReport {
    const asOfTs = nowTs();

    // Reserves.
    const reserves: ReserveAccount[] = reserveMonitor.allReserves();

    // Backing verification (per tracked asset).
    const backingResults = backingVerifier.all().map((state) => {
      const currency = state.assetCode.startsWith('TWIN')
        ? state.assetCode.slice(4)
        : state.assetCode;
      const reserveAvailable = reserveMonitor.available(currency);
      const ratio = state.circulating <= 0
        ? 1.0
        : reserveAvailable / state.circulating;
      const discrepancy = state.circulating - reserveAvailable;
      return {
        assetCode: state.assetCode,
        verified: ratio >= 0.999,
        backingRatio: ratio,
        discrepancy,
      };
    });
    // Top-level boolean: true iff every tracked asset is verified.
    const backingVerified: boolean = backingResults.length === 0
      ? true
      : backingResults.every((r) => r.verified);

    // Mint / burn usage.
    const mintUsage: LimitUsageSummary[] = mintLimitEngine.all().map((l) => ({
      assetCode: l.assetCode,
      dailyLimit: l.dailyLimit,
      dailyUsed: l.dailyUsed,
      utilization: l.dailyLimit > 0 ? l.dailyUsed / l.dailyLimit : 0,
      windowStartTs: l.windowStartTs,
    }));
    const burnUsage: LimitUsageSummary[] = burnLimitEngine.all().map((l) => ({
      assetCode: l.assetCode,
      dailyLimit: l.dailyLimit,
      dailyUsed: l.dailyUsed,
      utilization: l.dailyLimit > 0 ? l.dailyUsed / l.dailyLimit : 0,
      windowStartTs: l.windowStartTs,
    }));

    // Alerts — combine recent alerts + any current low-reserve alerts.
    const lowReserveAlerts = reserveMonitor.scanForLowReserves();
    const shortfallAlerts = liquidityForecaster.shortfallAlerts()
      .map((a) => ({
        id: a.id,
        level: 'warning' as const,
        category: 'forecast' as const,
        message: `Corridor ${corridorKey(a.corridor)} projects shortfall of ${a.projectedShortfallAmount.toFixed(2)} at ${new Date(a.projectedShortfallTs).toISOString()}`,
        ts: a.ts,
        subject: corridorKey(a.corridor),
      }));
    const alerts: TreasuryAlert[] = [
      ...lowReserveAlerts,
      ...shortfallAlerts,
      ...this.recentAlerts(),
    ];

    // Yields (per corridor).
    const yields = lpProfitabilityService.getCorridorYields();

    // Capital efficiency.
    const totalDeployed = corridorFundingService.totalDeployed();
    const totalReserves = reserves.reduce((acc, r) => acc + r.balance, 0);
    const idleCapital = Math.max(0, totalReserves - totalDeployed);
    const capitalEfficiencySummary: CapitalEfficiencySummary = {
      totalCapitalDeployed: totalDeployed,
      idleCapital,
      efficiencyRatio: totalReserves > 0 ? totalDeployed / totalReserves : 0,
      averageUtilization: liquidityForecaster.averageUtilization(),
    };
    // TreasuryReport.capitalEfficiency is typed as an array (one row per
    // corridor in the dashboard). The daily report surfaces a single
    // platform-wide summary row.
    const capitalEfficiency: CapitalEfficiencySummary[] = [capitalEfficiencySummary];

    // Corridor reserves.
    const corridors: CorridorReserve[] = corridorFundingService.allCorridorReserves();

    // Frozen assets.
    const frozenAssetDetails = this.frozenAssetList();
    // `frozenAssets` is the asset-code string array (parallel to
    // `frozenAssetDetails` which carries the full records).
    const frozenAssets: string[] = frozenAssetDetails.map((f) => f.assetCode);

    // LP profitability (top 20 by volume).
    const lpProfitability = lpProfitabilityService.getTopLPs('volume', 20);

    // Stress test results (most recent run).
    const stressTestResults = stressTestService.getResults().slice(-20);

    return {
      asOfTs,
      reserves,
      backingVerified,
      backingResults,
      mintUsage,
      burnUsage,
      alerts,
      yields,
      capitalEfficiency,
      corridors,
      frozenAssets,
      frozenAssetDetails,
      lpProfitability,
      stressTestResults,
    };
  }

  /**
   * Generate a settlement report for a period (default: last 30 days).
   * Aggregates settlement volume / fees / counts by corridor and by LP.
   */
  generateSettlementReport(period?: TimeRange): SettlementReport {
    const r = period ?? { fromTs: nowTs() - 30 * 24 * 60 * 60 * 1000, toTs: nowTs() };
    const records = lpProfitabilityService.getRecords().filter(
      (rec) => rec.ts >= r.fromTs && rec.ts < r.toTs,
    );
    const totalVolume = records.reduce((acc, rec) => acc + rec.volume, 0);
    const totalFees = records.reduce((acc, rec) => acc + rec.fee, 0);
    const totalSettlements = records.length;

    const byCorridorMap = new Map<string, { corridor: typeof records[0]['corridor']; volume: number; settlements: number; fees: number }>();
    for (const rec of records) {
      const key = corridorKey(rec.corridor);
      const existing = byCorridorMap.get(key) ?? {
        corridor: rec.corridor,
        volume: 0,
        settlements: 0,
        fees: 0,
      };
      existing.volume += rec.volume;
      existing.settlements += 1;
      existing.fees += rec.fee;
      byCorridorMap.set(key, existing);
    }
    const byCorridor = [...byCorridorMap.values()].map((v) => ({
      corridor: v.corridor,
      volume: v.volume,
      settlements: v.settlements,
      fees: v.fees,
    }));

    const byLpMap = new Map<string, { lpId: string; volume: number; settlements: number; pnl: number }>();
    for (const rec of records) {
      const existing = byLpMap.get(rec.lpId) ?? {
        lpId: rec.lpId,
        volume: 0,
        settlements: 0,
        pnl: 0,
      };
      existing.volume += rec.volume;
      existing.settlements += 1;
      existing.pnl += rec.fee - rec.cost;
      byLpMap.set(rec.lpId, existing);
    }
    const byLP = [...byLpMap.values()].map((v) => ({
      lpId: v.lpId,
      volume: v.volume,
      settlements: v.settlements,
      pnl: v.pnl,
    }));

    return {
      period: r,
      totalVolume,
      totalSettlements,
      totalFees,
      byCorridor,
      byLP,
    };
  }

  /**
   * Generate a capital report — reserves + corridor allocation +
   * capital efficiency. Used for capital-planning decisions.
   */
  generateCapitalReport(): CapitalReport {
    const asOfTs = nowTs();
    const byCurrency: ReserveAccount[] = reserveMonitor.allReserves();
    const totalReserves = byCurrency.reduce((acc, r) => acc + r.balance, 0);
    const totalAvailable = byCurrency.reduce((acc, r) => acc + r.available, 0);
    const totalReserved = byCurrency.reduce((acc, r) => acc + r.reserved, 0);
    const corridorReserves = corridorFundingService.allCorridorReserves();
    const totalDeployed = corridorFundingService.totalDeployed();
    const corridorAllocation = corridorReserves.map((cr) => ({
      corridor: cr.corridor,
      amount: cr.amount,
      share: totalDeployed > 0 ? cr.amount / totalDeployed : 0,
    }));
    const idleCapital = Math.max(0, totalReserves - totalDeployed);
    const capitalEfficiency: CapitalEfficiencySummary = {
      totalCapitalDeployed: totalDeployed,
      idleCapital,
      efficiencyRatio: totalReserves > 0 ? totalDeployed / totalReserves : 0,
      averageUtilization: liquidityForecaster.averageUtilization(),
    };
    return {
      asOfTs,
      totalReserves,
      totalAvailable,
      totalReserved,
      byCurrency,
      corridorAllocation,
      capitalEfficiency,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  var __PAYSWAP_TREASURY_REPORTS: TreasuryReports | undefined;
}

export const treasuryReports: TreasuryReports =
  globalThis.__PAYSWAP_TREASURY_REPORTS ?? new TreasuryReports();

if (!globalThis.__PAYSWAP_TREASURY_REPORTS) {
  globalThis.__PAYSWAP_TREASURY_REPORTS = treasuryReports;
}
