/**
 * PaySwap Protocol — Observability — High-Level Dashboard Aggregators.
 *
 * Pure read-only projections that pull from every sibling analytics service
 * + the kernel + the existing protocol layer to shape the views each PaySwap
 * persona needs:
 *
 *   - `executiveDashboard()`    : revenue, volume, success rates, growth
 *   - `operationsDashboard()`   : real-time ops — settlements, connectors, alerts
 *   - `complianceDashboard()`   : AML, sanctions, SARs, KYC status
 *   - `treasuryDashboard()`     : reserves, backing, limits, stress tests
 *   - `merchantDashboard(id?)`  : merchant-specific analytics (or all-merchants rollup)
 *
 * TODO(HARDEN): A second dashboard module exists at `src/protocol/ops/dashboards.ts`
 * (447 lines) that ALSO exports `lpDashboard` + `treasuryDashboard` (different
 * shape — partial overlap, not identical API). Keep this file (7 dashboard
 * variants vs ops's 5) as canonical; migrate ops callers then delete
 * `ops/dashboards.ts`. Tracked by HARDEN-1 audit (bonus dead-code win).
 *   - `lpDashboard()`           : LP performance, utilization, health
 *   - `developerDashboard()`    : API usage, error rates, latency, span throughput
 *
 * Every function is defensive — any thrown error is caught and the function
 * returns an empty-shaped result with an `error` field, so a single broken
 * subsystem can never take down the whole dashboard view.
 *
 * The kernel is FROZEN — this module imports only from `@/kernel/*` and the
 * sibling observability + treasury-v2 modules. No kernel files are modified.
 */
import { nowTs, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { kpiTracker } from './business-kpis';
import { paymentAnalytics } from './payment-analytics';
import { settlementAnalytics } from './settlement-analytics';
import { connectorAnalytics } from './connector-analytics';
import { merchantAnalytics } from './merchant-analytics';
import { lpAnalytics } from './lp-analytics';
import { realTimeDashboard } from './real-time-dashboard';
import { inMemorySpanExporter, SPAN_NAMES } from './tracing';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function last24h() {
  const now = nowTs();
  return { from: now - DAY_MS, to: now };
}

function last1h() {
  const now = nowTs();
  return { from: now - HOUR_MS, to: now };
}

function last30d() {
  const now = nowTs();
  return { from: now - 30 * DAY_MS, to: now };
}

// ---------------------------------------------------------------------------
// Executive dashboard
// ---------------------------------------------------------------------------

export interface ExecutiveDashboard {
  checkedAt: number;
  revenue: { value: number; target?: number; changePct: number; status: string };
  paymentVolume: { value: number; target?: number; changePct: number; status: string };
  payoutVolume: { value: number; target?: number; changePct: number; status: string };
  settlementSuccessRate: { value: number; target?: number; status: string };
  payoutSuccessRate: { value: number; target?: number; status: string };
  activeMerchants: { value: number; target?: number; status: string };
  activeLPs: { value: number; target?: number; status: string };
  twinTokenSupply: { value: number; target?: number; status: string };
  reserveBackingRatio: { value: number; target?: number; status: string };
  topMerchantsByVolume: { merchantId: string; value: number; transactions: number }[];
  topLPsByVolume: { lpId: string; value: number; settlements: number }[];
  paymentVolumeTimeSeries: { ts: number; value: number; count: number }[];
  error?: string;
}

export function executiveDashboard(): ExecutiveDashboard {
  try {
    const range24h = last24h();
    const range30d = last30d();
    const revenueKPI = safe(() => kpiTracker.getKPI('revenue'), undefined);
    const paymentVolKPI = safe(() => kpiTracker.getKPI('total_payment_volume'), undefined);
    const payoutVolKPI = safe(() => kpiTracker.getKPI('total_payout_volume'), undefined);
    const settlementRateKPI = safe(() => kpiTracker.getKPI('settlement_success_rate'), undefined);
    const payoutRateKPI = safe(() => kpiTracker.getKPI('payout_success_rate'), undefined);
    const activeMerchantsKPI = safe(() => kpiTracker.getKPI('active_merchants'), undefined);
    const activeLPsKPI = safe(() => kpiTracker.getKPI('active_lps'), undefined);
    const twinSupplyKPI = safe(() => kpiTracker.getKPI('twin_token_supply'), undefined);
    const reserveRatioKPI = safe(() => kpiTracker.getKPI('reserve_backing_ratio'), undefined);

    return {
      checkedAt: nowTs(),
      revenue: {
        value: revenueKPI?.value ?? 0,
        target: revenueKPI?.target,
        changePct: revenueKPI?.changePct ?? 0,
        status: revenueKPI?.status ?? 'on_track',
      },
      paymentVolume: {
        value: paymentVolKPI?.value ?? 0,
        target: paymentVolKPI?.target,
        changePct: paymentVolKPI?.changePct ?? 0,
        status: paymentVolKPI?.status ?? 'on_track',
      },
      payoutVolume: {
        value: payoutVolKPI?.value ?? 0,
        target: payoutVolKPI?.target,
        changePct: payoutVolKPI?.changePct ?? 0,
        status: payoutVolKPI?.status ?? 'on_track',
      },
      settlementSuccessRate: {
        value: settlementRateKPI?.value ?? 0,
        target: settlementRateKPI?.target,
        status: settlementRateKPI?.status ?? 'on_track',
      },
      payoutSuccessRate: {
        value: payoutRateKPI?.value ?? 0,
        target: payoutRateKPI?.target,
        status: payoutRateKPI?.status ?? 'on_track',
      },
      activeMerchants: {
        value: activeMerchantsKPI?.value ?? 0,
        target: activeMerchantsKPI?.target,
        status: activeMerchantsKPI?.status ?? 'on_track',
      },
      activeLPs: {
        value: activeLPsKPI?.value ?? 0,
        target: activeLPsKPI?.target,
        status: activeLPsKPI?.status ?? 'on_track',
      },
      twinTokenSupply: {
        value: twinSupplyKPI?.value ?? 0,
        target: twinSupplyKPI?.target,
        status: twinSupplyKPI?.status ?? 'on_track',
      },
      reserveBackingRatio: {
        value: reserveRatioKPI?.value ?? 0,
        target: reserveRatioKPI?.target,
        status: reserveRatioKPI?.status ?? 'on_track',
      },
      topMerchantsByVolume: safe(
        () => merchantAnalytics.getTopMerchants('volume', 10, range30d),
        [],
      ),
      topLPsByVolume: safe(() => lpAnalytics.getTopLPs('volume', 10, range30d), []),
      paymentVolumeTimeSeries: safe(
        () => paymentAnalytics.getTimeSeries(range24h, 'hourly'),
        [],
      ),
    };
  } catch (e) {
    return {
      checkedAt: nowTs(),
      revenue: { value: 0, changePct: 0, status: 'critical' },
      paymentVolume: { value: 0, changePct: 0, status: 'critical' },
      payoutVolume: { value: 0, changePct: 0, status: 'critical' },
      settlementSuccessRate: { value: 0, status: 'critical' },
      payoutSuccessRate: { value: 0, status: 'critical' },
      activeMerchants: { value: 0, status: 'critical' },
      activeLPs: { value: 0, status: 'critical' },
      twinTokenSupply: { value: 0, status: 'critical' },
      reserveBackingRatio: { value: 0, status: 'critical' },
      topMerchantsByVolume: [],
      topLPsByVolume: [],
      paymentVolumeTimeSeries: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// Operations dashboard
// ---------------------------------------------------------------------------

export interface OperationsDashboard {
  checkedAt: number;
  settlements: {
    count24h: number;
    avgDurationMs: number;
    failureRate: number;
    p95: number;
    p99: number;
    byCorridor: { corridor: string; count: number; volume: number; failureRate: number }[];
  };
  connectors: {
    count: number;
    avgUptime: number;
    avgLatencyMs: number;
    avgErrorRate: number;
    topByErrorRate: { connectorId: string; errorRate: number; uptime: number; avgLatencyMs: number }[];
  };
  alerts: {
    activeCount: number;
    recent: { id: string; ts: number; severity: string; source: string; message: string }[];
  };
  payments: {
    count24h: number;
    volume24h: number;
    successRate: number;
  };
  payouts: {
    volume24h: number;
    successRate: number;
  };
  error?: string;
}

export function operationsDashboard(): OperationsDashboard {
  try {
    const range24h = last24h();
    const range1h = last1h();
    const settlementDist = safe(
      () => settlementAnalytics.getSettlementTimeDistribution(range24h),
      { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0, count: 0 },
    );
    const settlementByCorridor = safe(
      () => settlementAnalytics.getSettlementByCorridor(range24h),
      [],
    );
    const connectorComparison = safe(
      () => connectorAnalytics.getConnectorComparison(range1h),
      { connectors: [], totals: { count: 0, totalRequests: 0, avgUptime: 0, avgLatencyMs: 0, avgErrorRate: 0 } },
    );
    const recentAlerts = safe(() => realTimeDashboard.getAlertFeed(20), []);
    const activeAlerts = recentAlerts.filter(
      (a) => a.severity === 'warning' || a.severity === 'critical',
    );
    return {
      checkedAt: nowTs(),
      settlements: {
        count24h: safe(() => settlementAnalytics.getSettlementCount(range24h), 0),
        avgDurationMs: settlementDist.avg,
        failureRate: safe(() => settlementAnalytics.getFailureRate(range24h), 0),
        p95: settlementDist.p95,
        p99: settlementDist.p99,
        byCorridor: settlementByCorridor.map((c) => ({
          corridor: c.corridor,
          count: c.count,
          volume: c.volume,
          failureRate: c.failureRate,
        })),
      },
      connectors: {
        count: connectorComparison.totals.count,
        avgUptime: connectorComparison.totals.avgUptime,
        avgLatencyMs: connectorComparison.totals.avgLatencyMs,
        avgErrorRate: connectorComparison.totals.avgErrorRate,
        topByErrorRate: [...connectorComparison.connectors]
          .sort((a, b) => b.errorRate - a.errorRate)
          .slice(0, 10)
          .map((c) => ({
            connectorId: c.connectorId,
            errorRate: c.errorRate,
            uptime: c.uptime,
            avgLatencyMs: c.avgLatencyMs,
          })),
      },
      alerts: {
        activeCount: activeAlerts.length,
        recent: recentAlerts.slice(-20).map((a) => ({
          id: a.id,
          ts: a.ts,
          severity: a.severity,
          source: a.source,
          message: a.message,
        })),
      },
      payments: {
        count24h: safe(() => paymentAnalytics.getPaymentCount(range24h), 0),
        volume24h: safe(() => paymentAnalytics.getPaymentVolume(range24h), 0),
        successRate: safe(() => paymentAnalytics.getSuccessRate(range24h), 0),
      },
      payouts: {
        volume24h: safe(() => paymentAnalytics.getPayoutVolume(range24h), 0),
        successRate: safe(() => paymentAnalytics.getPayoutSuccessRate(range24h), 0),
      },
    };
  } catch (e) {
    return {
      checkedAt: nowTs(),
      settlements: {
        count24h: 0,
        avgDurationMs: 0,
        failureRate: 0,
        p95: 0,
        p99: 0,
        byCorridor: [],
      },
      connectors: { count: 0, avgUptime: 0, avgLatencyMs: 0, avgErrorRate: 0, topByErrorRate: [] },
      alerts: { activeCount: 0, recent: [] },
      payments: { count24h: 0, volume24h: 0, successRate: 0 },
      payouts: { volume24h: 0, successRate: 0 },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// Compliance dashboard
// ---------------------------------------------------------------------------

export interface ComplianceDashboard {
  checkedAt: number;
  aml: {
    alertCount: number;
    recentAlerts: { ts: number; type: string; severity: string; details: unknown }[];
  };
  sanctions: {
    hitCount: number;
    recentHits: { ts: number; entity: string; list: string }[];
  };
  sars: {
    filedCount: number;
    recentFiled: { ts: number; caseId: string; amount: number }[];
  };
  kyc: {
    pendingCount: number;
    approvedCount: number;
    rejectedCount: number;
  };
  recentComplianceEvents: { ts: number; type: string; payload: Record<string, unknown> }[];
  error?: string;
}

export function complianceDashboard(): ComplianceDashboard {
  try {
    // Pull from the kernel event bus — count AML / sanctions / SAR / KYC events.
    const events = safe(() => eventEngine.read(), []);
    const amlEvents = events.filter((e) => e.type.startsWith('aml.') || e.type.startsWith('compliance.aml.'));
    const sanctionsEvents = events.filter(
      (e) => e.type.startsWith('sanctions.') || e.type.startsWith('compliance.sanctions.'),
    );
    const sarEvents = events.filter((e) => e.type.startsWith('sar.') || e.type.startsWith('compliance.sar.'));
    const kycEvents = events.filter((e) => e.type.startsWith('kyc.') || e.type.startsWith('compliance.kyc.'));
    const recent = [...events]
      .filter((e) => e.type.startsWith('compliance.') || e.type.startsWith('aml.') || e.type.startsWith('sanctions.') || e.type.startsWith('sar.') || e.type.startsWith('kyc.'))
      .slice(-20)
      .map((e) => ({ ts: e.ts, type: e.type, payload: e.payload }));

    return {
      checkedAt: nowTs(),
      aml: {
        alertCount: amlEvents.length,
        recentAlerts: amlEvents.slice(-10).map((e) => ({
          ts: e.ts,
          type: e.type,
          severity: (e.payload as { severity?: string }).severity ?? 'unknown',
          details: e.payload,
        })),
      },
      sanctions: {
        hitCount: sanctionsEvents.length,
        recentHits: sanctionsEvents.slice(-10).map((e) => ({
          ts: e.ts,
          entity: (e.payload as { entity?: string; name?: string }).entity ??
            (e.payload as { name?: string }).name ??
            'unknown',
          list: (e.payload as { list?: string }).list ?? 'unknown',
        })),
      },
      sars: {
        filedCount: sarEvents.length,
        recentFiled: sarEvents.slice(-10).map((e) => ({
          ts: e.ts,
          caseId: (e.payload as { caseId?: string; sarId?: string }).caseId ??
            (e.payload as { sarId?: string }).sarId ??
            'unknown',
          amount: (e.payload as { amount?: number }).amount ?? 0,
        })),
      },
      kyc: {
        pendingCount: kycEvents.filter((e) => e.type.endsWith('.pending') || e.type.endsWith('.submitted')).length,
        approvedCount: kycEvents.filter((e) => e.type.endsWith('.approved') || e.type.endsWith('.verified')).length,
        rejectedCount: kycEvents.filter((e) => e.type.endsWith('.rejected') || e.type.endsWith('.failed')).length,
      },
      recentComplianceEvents: recent,
    };
  } catch (e) {
    return {
      checkedAt: nowTs(),
      aml: { alertCount: 0, recentAlerts: [] },
      sanctions: { hitCount: 0, recentHits: [] },
      sars: { filedCount: 0, recentFiled: [] },
      kyc: { pendingCount: 0, approvedCount: 0, rejectedCount: 0 },
      recentComplianceEvents: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// Treasury dashboard
// ---------------------------------------------------------------------------

export interface TreasuryDashboard {
  checkedAt: number;
  reserves: {
    backingRatio: number;
    twinTokenSupply: number;
    reserveBalance: number;
    backed: boolean;
  };
  limits: {
    mintUsage: { assetCode: string; dailyUsed: number; dailyLimit: number; usagePct: number }[];
    burnUsage: { assetCode: string; dailyUsed: number; dailyLimit: number; usagePct: number }[];
  };
  stressTests: {
    completedCount: number;
    lastRun: { scenario: string; passed: boolean; shortfall: number; recoveryTimeMs: number }[];
  };
  corridorFunding: {
    corridor: string;
    reserve: number;
  }[];
  alerts: { ts: number; severity: string; source: string; message: string }[];
  error?: string;
}

export function treasuryDashboard(): TreasuryDashboard {
  try {
    // Use KPIs (already fed by treasury-v2 if attached) + treasury events.
    const backingKPI = safe(() => kpiTracker.getKPI('reserve_backing_ratio'), undefined);
    const twinSupplyKPI = safe(() => kpiTracker.getKPI('twin_token_supply'), undefined);
    const events = safe(() => eventEngine.read(), []);
    const mintBlocked = events.filter((e) => e.type === 'treasury.mint_blocked');
    const burnBlocked = events.filter((e) => e.type === 'treasury.burn_blocked');
    const stressCompleted = events.filter((e) => e.type === 'treasury.stress_test_completed');
    const corridorFunded = events.filter((e) => e.type === 'treasury.corridor_funded');
    const corridorReserves = new Map<string, number>();
    for (const e of corridorFunded) {
      const p = e.payload as { corridor?: string; amount?: number; fromCurrency?: string; toCurrency?: string };
      const c = p.corridor ?? (p.fromCurrency && p.toCurrency ? `${p.fromCurrency}→${p.toCurrency}` : 'unknown');
      corridorReserves.set(c, (corridorReserves.get(c) ?? 0) + (p.amount ?? 0));
    }
    const treasuryAlerts = events
      .filter(
        (e) =>
          e.type === 'treasury.reserve_low' ||
          e.type === 'treasury.backing_mismatch' ||
          e.type === 'treasury.shortfall_alert' ||
          e.type === 'treasury.lp_underperforming' ||
          e.type === 'treasury.pre_mint_blocked',
      )
      .slice(-20)
      .map((e) => ({
        ts: e.ts,
        severity:
          e.type === 'treasury.pre_mint_blocked' || e.type === 'treasury.backing_mismatch'
            ? 'critical'
            : 'warning',
        source: e.type,
        message: e.type.replace('treasury.', '').replace(/_/g, ' '),
      }));

    return {
      checkedAt: nowTs(),
      reserves: {
        backingRatio: backingKPI?.value ?? 0,
        twinTokenSupply: twinSupplyKPI?.value ?? 0,
        reserveBalance: (backingKPI?.value ?? 0) * (twinSupplyKPI?.value ?? 0),
        backed: (backingKPI?.value ?? 0) >= 0.99,
      },
      limits: {
        mintUsage: mintBlocked.slice(-10).map((e) => {
          const p = e.payload as { assetCode?: string; dailyUsed?: number; dailyLimit?: number };
          return {
            assetCode: p.assetCode ?? 'unknown',
            dailyUsed: p.dailyUsed ?? 0,
            dailyLimit: p.dailyLimit ?? 0,
            usagePct: p.dailyLimit ? round(((p.dailyUsed ?? 0) / p.dailyLimit) * 100, 4) : 0,
          };
        }),
        burnUsage: burnBlocked.slice(-10).map((e) => {
          const p = e.payload as { assetCode?: string; dailyUsed?: number; dailyLimit?: number };
          return {
            assetCode: p.assetCode ?? 'unknown',
            dailyUsed: p.dailyUsed ?? 0,
            dailyLimit: p.dailyLimit ?? 0,
            usagePct: p.dailyLimit ? round(((p.dailyUsed ?? 0) / p.dailyLimit) * 100, 4) : 0,
          };
        }),
      },
      stressTests: {
        completedCount: stressCompleted.length,
        lastRun: stressCompleted.slice(-10).map((e) => {
          const p = e.payload as { scenario?: string; passed?: boolean; shortfall?: number; recoveryTimeMs?: number };
          return {
            scenario: p.scenario ?? 'unknown',
            passed: p.passed ?? false,
            shortfall: p.shortfall ?? 0,
            recoveryTimeMs: p.recoveryTimeMs ?? 0,
          };
        }),
      },
      corridorFunding: [...corridorReserves.entries()]
        .map(([corridor, reserve]) => ({ corridor, reserve: round(reserve, 2) }))
        .sort((a, b) => b.reserve - a.reserve),
      alerts: treasuryAlerts,
    };
  } catch (e) {
    return {
      checkedAt: nowTs(),
      reserves: { backingRatio: 0, twinTokenSupply: 0, reserveBalance: 0, backed: false },
      limits: { mintUsage: [], burnUsage: [] },
      stressTests: { completedCount: 0, lastRun: [] },
      corridorFunding: [],
      alerts: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// Merchant dashboard
// ---------------------------------------------------------------------------

export interface MerchantDashboard {
  checkedAt: number;
  merchantId?: string;
  totalMerchants: number;
  activeMerchants: number;
  topMerchantsByVolume: { merchantId: string; value: number; transactions: number }[];
  topMerchantsByTransactions: { merchantId: string; value: number; transactions: number }[];
  topMerchantsByRevenue: { merchantId: string; value: number; transactions: number }[];
  growth: { ts: number; newMerchants: number; cumulative: number }[];
  churn: { ts: number; churned: number; churnRate: number }[];
  merchantStats?: {
    merchantId: string;
    totalVolume: number;
    totalTransactions: number;
    totalRefunds: number;
    refundRate: number;
    revenue: number;
    status: string;
  };
  error?: string;
}

export function merchantDashboard(merchantId?: string): MerchantDashboard {
  try {
    const range30d = last30d();
    const range90d = { from: nowTs() - 90 * DAY_MS, to: nowTs() };
    const base: Omit<MerchantDashboard, 'merchantStats' | 'merchantId'> = {
      checkedAt: nowTs(),
      totalMerchants: safe(() => merchantAnalytics.stats().merchants, 0),
      activeMerchants: safe(() => merchantAnalytics.getActiveMerchantCount(7 * DAY_MS), 0),
      topMerchantsByVolume: safe(
        () => merchantAnalytics.getTopMerchants('volume', 20, range30d),
        [],
      ),
      topMerchantsByTransactions: safe(
        () => merchantAnalytics.getTopMerchants('transactions', 20, range30d),
        [],
      ),
      topMerchantsByRevenue: safe(
        () => merchantAnalytics.getTopMerchants('revenue', 20, range30d),
        [],
      ),
      growth: safe(() => merchantAnalytics.getMerchantGrowth(range90d), []),
      churn: safe(() => merchantAnalytics.getMerchantChurn(range30d), []),
    };
    if (merchantId) {
      return {
        ...base,
        merchantId,
        merchantStats: safe(() => merchantAnalytics.getMerchantStats(merchantId), undefined),
      };
    }
    return base;
  } catch (e) {
    return {
      checkedAt: nowTs(),
      totalMerchants: 0,
      activeMerchants: 0,
      topMerchantsByVolume: [],
      topMerchantsByTransactions: [],
      topMerchantsByRevenue: [],
      growth: [],
      churn: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// LP dashboard
// ---------------------------------------------------------------------------

export interface LPDashboard {
  checkedAt: number;
  totalLPs: number;
  activeLPs: number;
  topLPsByVolume: { lpId: string; value: number; settlements: number }[];
  topLPsByRevenue: { lpId: string; value: number; settlements: number }[];
  topLPsBySettlements: { lpId: string; value: number; settlements: number }[];
  rewardDistribution: {
    lpId: string;
    totalFees: number;
    settlementCount: number;
    sharePct: number;
  }[];
  corridorCoverage: { corridor: string; lpCount: number; volume: number }[];
  healthScores: {
    lpId: string;
    score: number;
    status: string;
  }[];
  error?: string;
}

export function lpDashboard(): LPDashboard {
  try {
    const range30d = last30d();
    const topLPs = safe(() => lpAnalytics.getTopLPs('volume', 20, range30d), []);
    const healthScores = topLPs.map((lp) => {
      const h = safe(() => lpAnalytics.getLPHealthScore(lp.lpId, range30d), {
        lpId: lp.lpId,
        score: 0,
        components: { uptime: 0, successRate: 0, utilization: 0, reputation: 0 },
        status: 'critical' as const,
      });
      return { lpId: lp.lpId, score: h.score, status: h.status };
    });
    return {
      checkedAt: nowTs(),
      totalLPs: safe(() => lpAnalytics.stats().lps, 0),
      activeLPs: safe(() => lpAnalytics.getActiveLPCount(range30d), 0),
      topLPsByVolume: topLPs,
      topLPsByRevenue: safe(() => lpAnalytics.getTopLPs('revenue', 20, range30d), []),
      topLPsBySettlements: safe(() => lpAnalytics.getTopLPs('settlements', 20, range30d), []),
      rewardDistribution: safe(() => lpAnalytics.getLPRewardDistribution(range30d), []).map((r) => ({
        lpId: r.lpId,
        totalFees: r.totalFees,
        settlementCount: r.settlementCount,
        sharePct: r.sharePct,
      })),
      corridorCoverage: safe(() => lpAnalytics.getCorridorCoverage(range30d), []).map((c) => ({
        corridor: c.corridor,
        lpCount: c.lpCount,
        volume: c.volume,
      })),
      healthScores,
    };
  } catch (e) {
    return {
      checkedAt: nowTs(),
      totalLPs: 0,
      activeLPs: 0,
      topLPsByVolume: [],
      topLPsByRevenue: [],
      topLPsBySettlements: [],
      rewardDistribution: [],
      corridorCoverage: [],
      healthScores: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// Developer dashboard
// ---------------------------------------------------------------------------

export interface DeveloperDashboard {
  checkedAt: number;
  api: {
    totalRequests: number;
    errorRate: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  };
  spans: {
    total: number;
    errorCount: number;
    avgDurationMs: number;
    byName: { name: string; count: number; avgDurationMs: number; errorCount: number }[];
  };
  events: {
    totalEmitted: number;
    byTypePrefix: { prefix: string; count: number }[];
  };
  system: {
    uptimeMs: number;
    memoryMb: number;
    eventThroughputPerSec: number;
    spansPerSec: number;
  };
  error?: string;
}

export function developerDashboard(): DeveloperDashboard {
  try {
    const range1h = last1h();
    const connectorComparison = safe(
      () => connectorAnalytics.getConnectorComparison(range1h),
      { connectors: [], totals: { count: 0, totalRequests: 0, avgUptime: 0, avgLatencyMs: 0, avgErrorRate: 0 } },
    );
    const spanNames = [
      SPAN_NAMES.paymentCreate,
      SPAN_NAMES.paymentRoute,
      SPAN_NAMES.paymentSettle,
      SPAN_NAMES.payoutProcess,
      SPAN_NAMES.ledgerPost,
      SPAN_NAMES.connectorQuery,
      SPAN_NAMES.plannerSolve,
      SPAN_NAMES.complianceCheck,
    ];
    const spansByName = spanNames.map((name) => {
      const spans = safe(() => inMemorySpanExporter?.getByName(name) ?? [], []);
      const done = spans.filter((s) => s.endTime !== undefined);
      const errors = spans.filter((s) => s.status === 'error').length;
      const avgDuration =
        done.length > 0
          ? round(
              done.reduce((sum, s) => sum + ((s.endTime as number) - s.startTime), 0) / done.length,
              2,
            )
          : 0;
      return { name, count: spans.length, avgDurationMs: avgDuration, errorCount: errors };
    });
    const allSpans = safe(() => inMemorySpanExporter?.all() ?? [], []);
    const spanErrors = allSpans.filter((s) => s.status === 'error').length;
    const spanDone = allSpans.filter((s) => s.endTime !== undefined);
    const spanAvgDuration =
      spanDone.length > 0
        ? round(
            spanDone.reduce((sum, s) => sum + ((s.endTime as number) - s.startTime), 0) /
              spanDone.length,
            2,
          )
        : 0;
    const events = safe(() => eventEngine.read(), []);
    const byTypePrefix = new Map<string, number>();
    for (const e of events) {
      const prefix = e.type.split('.')[0] ?? 'unknown';
      byTypePrefix.set(prefix, (byTypePrefix.get(prefix) ?? 0) + 1);
    }
    const systemMetrics = safe(() => realTimeDashboard.getSystemMetrics(), null);
    return {
      checkedAt: nowTs(),
      api: {
        totalRequests: connectorComparison.totals.totalRequests,
        errorRate: connectorComparison.totals.avgErrorRate,
        avgLatencyMs: connectorComparison.totals.avgLatencyMs,
        p95LatencyMs:
          connectorComparison.connectors.length > 0
            ? Math.max(...connectorComparison.connectors.map((c) => c.p95LatencyMs))
            : 0,
      },
      spans: {
        total: allSpans.length,
        errorCount: spanErrors,
        avgDurationMs: spanAvgDuration,
        byName: spansByName,
      },
      events: {
        totalEmitted: events.length,
        byTypePrefix: [...byTypePrefix.entries()]
          .map(([prefix, count]) => ({ prefix, count }))
          .sort((a, b) => b.count - a.count),
      },
      system: {
        uptimeMs: systemMetrics?.uptimeMs ?? 0,
        memoryMb: systemMetrics?.memoryMb ?? 0,
        eventThroughputPerSec: systemMetrics?.eventThroughputPerSec ?? 0,
        spansPerSec: systemMetrics?.spansPerSec ?? 0,
      },
    };
  } catch (e) {
    return {
      checkedAt: nowTs(),
      api: { totalRequests: 0, errorRate: 0, avgLatencyMs: 0, p95LatencyMs: 0 },
      spans: { total: 0, errorCount: 0, avgDurationMs: 0, byName: [] },
      events: { totalEmitted: 0, byTypePrefix: [] },
      system: { uptimeMs: 0, memoryMb: 0, eventThroughputPerSec: 0, spansPerSec: 0 },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// All-in-one snapshot (for API routes that need everything at once)
// ---------------------------------------------------------------------------

export interface ObservabilitySnapshot {
  checkedAt: number;
  executive: ExecutiveDashboard;
  operations: OperationsDashboard;
  compliance: ComplianceDashboard;
  treasury: TreasuryDashboard;
  merchant: MerchantDashboard;
  lp: LPDashboard;
  developer: DeveloperDashboard;
  error?: string;
}

export function observabilitySnapshot(): ObservabilitySnapshot {
  try {
    return {
      checkedAt: nowTs(),
      executive: executiveDashboard(),
      operations: operationsDashboard(),
      compliance: complianceDashboard(),
      treasury: treasuryDashboard(),
      merchant: merchantDashboard(),
      lp: lpDashboard(),
      developer: developerDashboard(),
    };
  } catch (e) {
    return {
      checkedAt: nowTs(),
      executive: executiveDashboard(),
      operations: operationsDashboard(),
      compliance: complianceDashboard(),
      treasury: treasuryDashboard(),
      merchant: merchantDashboard(),
      lp: lpDashboard(),
      developer: developerDashboard(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
