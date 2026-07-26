/**
 * PaySwap Protocol — Ops Module — Dashboard Aggregators.
 *
 * Pure read-only aggregators that pull live state from the protocol layer's
 * singletons (treasury, twin-token engine, ledger, LP lifecycle, connectors,
 * merchant platform, payout service) and the in-process event bus, then shape
 * it for ops dashboards and API routes.
 *
 * Every function is defensive: any thrown error is caught and an empty-shaped
 * result is returned with an `error` field, so a single broken subsystem can
 * never take down the whole ops view.
 *
 * `refreshDerivedMetrics()` syncs the ops metrics registry's derived gauges /
 * counters (twin supply, treasury reserve ratio, connector request totals,
 * ledger posted total, persisted events) from authoritative sources so that
 * alerts and SLOs evaluated against the registry reflect ground truth. It is
 * called automatically at the top of each dashboard function.
 *
 * The kernel is FROZEN. This module imports only from `@/kernel/*` and other
 * `@/protocol/*` modules — it creates no kernel files and modifies none.
 */
import { nowTs, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { treasury } from '@/protocol/treasury';
import { twinTokenEngine } from '@/protocol/twin-token/engine';
import { merchantPlatform } from '@/protocol/merchant/platform';
import { payoutService } from '@/protocol/payouts/payout-service';
import { ledgerEngine } from '@/protocol/ledger/engine';
import { lpLifecycle } from '@/protocol/lp-lifecycle-manager';
import { productionConnectorRegistry } from '@/protocol/connectors-v2/registry';
import { metricsRegistry, METRIC_NAMES } from './metrics';
import type { HistogramSnapshot } from './metrics';
import { alertManager } from './alerts';
import { sloManager } from './slos';

// ---------------------------------------------------------------------------
// Internal sync state (deltas for monotonic counters)
// ---------------------------------------------------------------------------

let lastLedgerPosted = 0;
let lastEventsPersisted = 0;
const lastConnectorTotals: Record<
  string,
  { total: number; success: number; failed: number }
> = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run `fn` and return its result, or `fallback` if it throws. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Count items by a string key. */
function groupBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Best-effort async refresh of the persisted-events counter from the event store. */
async function refreshPersistedEvents(): Promise<void> {
  try {
    const { eventStore } = await import('@/protocol/persistence');
    const n = await eventStore.count();
    if (typeof n === 'number' && Number.isFinite(n)) {
      const delta = Math.max(0, n - lastEventsPersisted);
      if (delta > 0) {
        metricsRegistry.getCounter(METRIC_NAMES.eventsPersistedTotal)?.inc(undefined, delta);
      }
      lastEventsPersisted = n;
    }
  } catch {
    // Persistence layer unavailable (e.g. no DB wired) — leave counter unchanged.
  }
}

/**
 * Sync the ops metrics registry's derived gauges and counters from the
 * protocol layer's authoritative singletons. Idempotent and safe to call
 * repeatedly. Counter deltas are clamped to ≥ 0 so a source reset never
 * decrements the ops counter.
 */
export function refreshDerivedMetrics(): void {
  // Twin token supply gauge (per asset).
  const assets = safe(() => twinTokenEngine.allAssets(), []);
  const supplyGauge = metricsRegistry.getGauge(METRIC_NAMES.twinTokensSupply);
  if (supplyGauge) {
    for (const a of assets) {
      supplyGauge.set({ asset: a.code }, a.totalSupply);
    }
  }

  // Treasury reserve ratio gauge.
  const positions = safe(() => treasury.allPositions(), []);
  const totalReserves = positions.reduce((s, p) => s + p.totalReserves, 0);
  const twinLiability = assets.reduce((s, a) => s + a.totalSupply, 0);
  const ratio = twinLiability > 0 ? totalReserves / twinLiability : Number.MAX_SAFE_INTEGER;
  metricsRegistry.getGauge(METRIC_NAMES.treasuryReserveRatio)?.set(undefined, ratio);

  // Ledger posted counter (delta from ledgerEngine.count()).
  const posted = safe(() => ledgerEngine.count(), 0);
  const ledgerDelta = Math.max(0, posted - lastLedgerPosted);
  if (ledgerDelta > 0) {
    metricsRegistry.getCounter(METRIC_NAMES.ledgerPostedTotal)?.inc(undefined, ledgerDelta);
  }
  lastLedgerPosted = posted;

  // Connector request counter (delta from connectors-v2 MetricsCollector).
  const report = safe(() => productionConnectorRegistry.metricsReport(), []);
  const connectorCounter = metricsRegistry.getCounter(METRIC_NAMES.connectorRequestsTotal);
  if (connectorCounter) {
    for (const m of report) {
      const prev = lastConnectorTotals[m.id] ?? { total: 0, success: 0, failed: 0 };
      const dSuccess = Math.max(0, m.requestsSuccess - prev.success);
      const dFailed = Math.max(0, m.requestsFailed - prev.failed);
      if (dSuccess > 0) connectorCounter.inc({ connector: m.id, status: 'success' }, dSuccess);
      if (dFailed > 0) connectorCounter.inc({ connector: m.id, status: 'error' }, dFailed);
      lastConnectorTotals[m.id] = {
        total: m.requestsTotal,
        success: m.requestsSuccess,
        failed: m.requestsFailed,
      };
    }
  }

  // Persisted events counter (async, best-effort, fire-and-forget).
  void refreshPersistedEvents();
}

// ---------------------------------------------------------------------------
// Dashboard shapes
// ---------------------------------------------------------------------------

/** Top-level KPI snapshot. */
export interface SystemOverview {
  checkedAt: number;
  events: number;
  merchants: number;
  payouts: number;
  twinAssets: number;
  twinSupply: number;
  ledgerPosted: number;
  treasuryReserves: number;
  activeAlerts: number;
  alerts: ReturnType<typeof alertManager.active>;
  sloStatus: ReturnType<typeof sloManager.evaluate>;
  error?: string;
}

/** Per-connector health + metrics view. */
export interface ConnectorDashboard {
  checkedAt: number;
  connectors: Array<{
    id: string;
    requestsTotal: number;
    requestsSuccess: number;
    requestsFailed: number;
    avgLatencyMs: number;
    errorRate: number;
    availability: number;
    lastRequestTs: number;
    healthy: boolean | null;
    consecutiveFailures: number | null;
    latencyMs: number | null;
  }>;
  totals: {
    count: number;
    requestsTotal: number;
    requestsFailed: number;
    errorRate: number;
  };
  error?: string;
}

/** Settlement volume + latency view. */
export interface SettlementDashboard {
  checkedAt: number;
  ledgerEntriesPosted: number;
  observations: number;
  p50: number;
  p95: number;
  p99: number;
  avgMs: number;
  histogram: HistogramSnapshot | null;
  error?: string;
}

/** LP count + capacity view. */
export interface LPDashboard {
  checkedAt: number;
  count: number;
  activeCount: number;
  totalAuthorizedCapacity: number;
  totalCurrentExposure: number;
  utilization: number;
  byState: Record<string, number>;
  error?: string;
}

/** Treasury reserves + backing view. */
export interface TreasuryDashboard {
  checkedAt: number;
  positions: ReturnType<typeof treasury.allPositions>;
  twinAssets: ReturnType<typeof twinTokenEngine.allAssets>;
  twinSupply: number;
  totalReserves: number;
  reserveRatio: number;
  backed: boolean;
  error?: string;
}

/** Combined snapshot returned by `opsSnapshot()`. */
export interface OpsSnapshot {
  checkedAt: number;
  system: SystemOverview;
  connectors: ConnectorDashboard;
  settlement: SettlementDashboard;
  liquidity: LPDashboard;
  treasury: TreasuryDashboard;
  metrics: ReturnType<typeof metricsRegistry.json>;
  error?: string;
}

// ---------------------------------------------------------------------------
// Dashboard functions
// ---------------------------------------------------------------------------

/** Top-level KPIs: events, merchants, payouts, twin supply, alerts, SLO status. */
export function systemOverview(): SystemOverview {
  try {
    refreshDerivedMetrics();
    const events = safe(() => eventEngine.read().length, 0);
    const merchants = safe(() => merchantPlatform.allMerchants().length, 0);
    const payouts = safe(() => payoutService.list().length, 0);
    const assets = safe(() => twinTokenEngine.allAssets(), []);
    const twinSupply = assets.reduce((s, a) => s + a.totalSupply, 0);
    const activeAlerts = alertManager.active();
    const sloStatus = safe(() => sloManager.evaluate(metricsRegistry), []);
    const ledgerPosted = safe(() => ledgerEngine.count(), 0);
    const positions = safe(() => treasury.allPositions(), []);
    const totalReserves = positions.reduce((s, p) => s + p.totalReserves, 0);
    return {
      checkedAt: nowTs(),
      events,
      merchants,
      payouts,
      twinAssets: assets.length,
      twinSupply: round(twinSupply, 6),
      ledgerPosted,
      treasuryReserves: round(totalReserves, 6),
      activeAlerts: activeAlerts.length,
      alerts: activeAlerts,
      sloStatus,
    };
  } catch (e) {
    return {
      checkedAt: nowTs(),
      events: 0,
      merchants: 0,
      payouts: 0,
      twinAssets: 0,
      twinSupply: 0,
      ledgerPosted: 0,
      treasuryReserves: 0,
      activeAlerts: 0,
      alerts: [],
      sloStatus: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Per-connector health + metrics. Pulls from connectors-v2 when available. */
export function connectorDashboard(): ConnectorDashboard {
  try {
    refreshDerivedMetrics();
    const health = safe(() => productionConnectorRegistry.healthSnapshot(), []);
    const metrics = safe(() => productionConnectorRegistry.metricsReport(), []);
    const healthById = new Map(health.map((h) => [h.id, h]));
    const connectors = metrics.map((m) => {
      const h = healthById.get(m.id);
      const total = m.requestsTotal;
      return {
        id: m.id,
        requestsTotal: total,
        requestsSuccess: m.requestsSuccess,
        requestsFailed: m.requestsFailed,
        avgLatencyMs: m.avgLatencyMs,
        errorRate: total > 0 ? round(m.requestsFailed / total, 6) : 0,
        availability: total > 0 ? round(m.requestsSuccess / total, 6) : 1,
        lastRequestTs: m.lastRequestTs,
        healthy: h ? h.healthy : null,
        consecutiveFailures: h ? h.consecutiveFailures : null,
        latencyMs: h ? h.latencyMs : null,
      };
    });
    const totalRequests = connectors.reduce((s, c) => s + c.requestsTotal, 0);
    const totalFailed = connectors.reduce((s, c) => s + c.requestsFailed, 0);
    return {
      checkedAt: nowTs(),
      connectors,
      totals: {
        count: connectors.length,
        requestsTotal: totalRequests,
        requestsFailed: totalFailed,
        errorRate: totalRequests > 0 ? round(totalFailed / totalRequests, 6) : 0,
      },
    };
  } catch (e) {
    return {
      checkedAt: nowTs(),
      connectors: [],
      totals: { count: 0, requestsTotal: 0, requestsFailed: 0, errorRate: 0 },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Settlement volume + latency. Reads the settlement-duration histogram. */
export function settlementDashboard(): SettlementDashboard {
  try {
    refreshDerivedMetrics();
    const h = metricsRegistry.getHistogram(METRIC_NAMES.settlementDurationMs);
    const hist = h ? h.globalSnapshot() : null;
    const entries = safe(() => ledgerEngine.count(), 0);
    return {
      checkedAt: nowTs(),
      ledgerEntriesPosted: entries,
      observations: h ? h.count() : 0,
      p50: h ? h.percentile(0.5) : 0,
      p95: h ? h.percentile(0.95) : 0,
      p99: h ? h.percentile(0.99) : 0,
      avgMs: h ? h.avg() : 0,
      histogram: hist,
    };
  } catch (e) {
    return {
      checkedAt: nowTs(),
      ledgerEntriesPosted: 0,
      observations: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      avgMs: 0,
      histogram: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** LP count + capacity. Reads the LP lifecycle manager. */
export function lpDashboard(): LPDashboard {
  try {
    const lps = safe(() => lpLifecycle.all(), []);
    const active = lps.filter((lp) => lp.state === 'active');
    const totalCapacity = active.reduce((s, lp) => s + lp.authorizedExposure, 0);
    const totalExposure = active.reduce((s, lp) => s + lp.currentExposure, 0);
    return {
      checkedAt: nowTs(),
      count: lps.length,
      activeCount: active.length,
      totalAuthorizedCapacity: round(totalCapacity, 6),
      totalCurrentExposure: round(totalExposure, 6),
      utilization: totalCapacity > 0 ? round(totalExposure / totalCapacity, 6) : 0,
      byState: groupBy(lps, (lp) => lp.state),
    };
  } catch (e) {
    return {
      checkedAt: nowTs(),
      count: 0,
      activeCount: 0,
      totalAuthorizedCapacity: 0,
      totalCurrentExposure: 0,
      utilization: 0,
      byState: {},
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Treasury reserves + Twin Token backing. */
export function treasuryDashboard(): TreasuryDashboard {
  try {
    refreshDerivedMetrics();
    const positions = safe(() => treasury.allPositions(), []);
    const assets = safe(() => twinTokenEngine.allAssets(), []);
    const twinSupply = assets.reduce((s, a) => s + a.totalSupply, 0);
    const totalReserves = positions.reduce((s, p) => s + p.totalReserves, 0);
    const ratio = twinSupply > 0 ? totalReserves / twinSupply : Number.MAX_SAFE_INTEGER;
    return {
      checkedAt: nowTs(),
      positions,
      twinAssets: assets,
      twinSupply: round(twinSupply, 6),
      totalReserves: round(totalReserves, 6),
      reserveRatio: twinSupply > 0 ? round(ratio, 6) : Number.MAX_SAFE_INTEGER,
      backed: twinSupply > 0 ? totalReserves >= twinSupply : true,
    };
  } catch (e) {
    return {
      checkedAt: nowTs(),
      positions: [],
      twinAssets: [],
      twinSupply: 0,
      totalReserves: 0,
      reserveRatio: 0,
      backed: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Convenience: every dashboard + raw metrics snapshot in one call. */
export function opsSnapshot(): OpsSnapshot {
  try {
    return {
      checkedAt: nowTs(),
      system: systemOverview(),
      connectors: connectorDashboard(),
      settlement: settlementDashboard(),
      liquidity: lpDashboard(),
      treasury: treasuryDashboard(),
      metrics: metricsRegistry.json(),
    };
  } catch (e) {
    return {
      checkedAt: nowTs(),
      system: systemOverview(),
      connectors: connectorDashboard(),
      settlement: settlementDashboard(),
      liquidity: lpDashboard(),
      treasury: treasuryDashboard(),
      metrics: metricsRegistry.json(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
