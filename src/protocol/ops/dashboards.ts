/**
 * PaySwap Protocol — Operational Readiness — Dashboard Data Aggregators.
 *
 * Pure functions that pull from the metrics registry, span buffer, log
 * buffer, alert manager, SLO manager, and (optionally) from the
 * connectors-v2 / liquidity-network / treasury-v2 modules to assemble
 * dashboard payloads. Every external call is defensive (try/catch) so
 * the dashboard still renders if a subsystem isn't initialized.
 *
 * Dashboards exposed:
 *   - `systemOverview()`         : top-level KPIs + active alerts + SLO status.
 *   - `connectorDashboard()`     : per-connector request counts, latency, health, recent errors.
 *   - `settlementDashboard()`    : settlement volume by corridor/currency, p99, success rate.
 *   - `lpDashboard()`            : active LP count, capacity by corridor, top/bottom LPs.
 *   - `merchantDashboard(merchantId?)`: payment/payout volume, error rates, top merchants.
 *   - `treasuryDashboard()`      : reserves, backing ratios, alerts, frozen assets.
 *
 * Every payload is a plain JSON-serializable object — suitable for direct
 * return from a Next.js route handler.
 */
import { metricsRegistry, parseLabelKey, histogramPercentile } from './metrics';
import { inMemorySpanExporter } from './tracing';
import { sharedLogBuffer } from './logger';
import { alertManager } from './alerts';
import { sloManager } from './slos';

// Defensive imports — these subsystems might not be initialized.
import { sharedMetricsCollector, sharedHealthMonitor } from '@/protocol/connectors-v2';
import { liquidityNetwork } from '@/protocol/liquidity-network';
import { treasuryEngine } from '@/protocol/treasury-v2';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Safe-call helper — returns fallback if fn throws. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Round to N decimals. */
function round(n: number, decimals = 2): number {
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, decimals);
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Returns now as epoch ms. */
const now = (): number => Date.now();

// ─── System Overview ──────────────────────────────────────────────────────────

export interface SystemOverview {
  ts: number;
  kpis: {
    paymentsTotal: number;
    payoutsTotal: number;
    ledgerPosts: number;
    webhookDeliveries: number;
    lpActiveCount: number;
    twinTokenAssets: number;
  };
  sloStatus: {
    id: string;
    name: string;
    target: number;
    successRate: number;
    errorBudgetRemaining: number;
    onTrack: boolean;
  }[];
  activeAlerts: number;
  criticalAlerts: number;
  recentErrors: number;  // last 1h
  recentSpans: number;
}

/** Top-level KPIs + active alerts + SLO status — the main dashboard card. */
export function systemOverview(): SystemOverview {
  const sloStatus = sloManager.evaluate(metricsRegistry);
  const activeAlerts = safe(() => alertManager.active(), []);
  const logCounts = safe(() => sharedLogBuffer.counts(), {
    debug: 0, info: 0, warn: 0, error: 0, fatal: 0,
  });
  const since = now() - 60 * 60 * 1000;  // last 1h
  const recentErrors = safe(
    () =>
      sharedLogBuffer.query({ since, level: ['error', 'fatal'] }).length,
    0,
  );

  const paymentsTotal = safe(
    () => paymentsCounterSum(),
    0,
  );
  const payoutsTotal = safe(
    () => counterSumMetric('payswap_payouts_total'),
    0,
  );
  const ledgerPosts = safe(
    () => counterSumMetric('payswap_ledger_posted_total'),
    0,
  );
  const webhookDeliveries = safe(
    () => counterSumMetric('payswap_webhook_deliveries_total'),
    0,
  );
  const lpActiveCount = safe(
    () => metricsRegistry.getGauge('payswap_lp_active_count')?.get() ?? 0,
    0,
  );
  const twinTokenAssets = safe(
    () => metricsRegistry.getGauge('payswap_twin_tokens_supply')?.values.size ?? 0,
    0,
  );

  return {
    ts: now(),
    kpis: {
      paymentsTotal,
      payoutsTotal,
      ledgerPosts,
      webhookDeliveries,
      lpActiveCount,
      twinTokenAssets,
    },
    sloStatus: sloStatus.map((s) => ({
      id: s.slo.id,
      name: s.slo.name,
      target: s.slo.target,
      successRate: round(s.successRate, 4),
      errorBudgetRemaining: round(s.errorBudgetRemaining, 6),
      onTrack: s.onTrack,
    })),
    activeAlerts: activeAlerts.length,
    criticalAlerts: activeAlerts.filter((a) => a.severity === 'critical').length,
    recentErrors,
    recentSpans: safe(() => inMemorySpanExporter.size(), 0),
    _logCounts: logCounts,
  } as SystemOverview;
}

/** Sum all label values of the payments counter. */
function paymentsCounterSum(): number {
  return counterSumMetric('payswap_payments_total');
}

/** Sum all label values of a counter by name. */
function counterSumMetric(name: string): number {
  const m = metricsRegistry.getCounter(name);
  if (!m) return 0;
  let sum = 0;
  for (const v of m.values.values()) {
    if (typeof v === 'number') sum += v;
  }
  return sum;
}

// ─── Connector Dashboard ──────────────────────────────────────────────────────

export interface ConnectorDashboardRow {
  id: string;
  requestsTotal: number;
  requestsSuccess: number;
  requestsFailed: number;
  successRate: number;
  p50LatencyMs: number;
  p99LatencyMs: number;
  healthy: boolean;
  consecutiveFailures: number;
  lastError?: string;
  recentErrorLogs: { ts: number; msg: string; level: string }[];
}

export interface ConnectorDashboard {
  ts: number;
  connectors: ConnectorDashboardRow[];
  totalRequests: number;
  avgSuccessRate: number;
}

/** Per-connector request counts, success rate, latency, health, recent errors. */
export function connectorDashboard(): ConnectorDashboard {
  const rows: ConnectorDashboardRow[] = [];
  // Source 1: ops metrics registry (per-connector counters + histograms).
  const reqCounter = metricsRegistry.getCounter('payswap_connector_requests_total');
  const latencyHist = metricsRegistry.getHistogram('payswap_connector_latency_ms');
  const connectorIds = new Set<string>();
  if (reqCounter) {
    for (const key of reqCounter.values.keys()) {
      const labels = parseLabelKey(key);
      if (labels.connector) connectorIds.add(String(labels.connector));
    }
  }
  // Source 2: connectors-v2 health monitor (may have more if not yet reflected in ops metrics).
  const healths = safe(() => sharedHealthMonitor.all(), []);
  for (const h of healths) connectorIds.add(h.id);

  let totalRequests = 0;
  let totalSuccess = 0;
  for (const id of connectorIds) {
    let requestsTotal = 0;
    let requestsSuccess = 0;
    let requestsFailed = 0;
    if (reqCounter) {
      for (const [key, v] of reqCounter.values.entries()) {
        if (typeof v !== 'number') continue;
        const labels = parseLabelKey(key);
        if (String(labels.connector) !== id) continue;
        requestsTotal += v;
        const status = String(labels.status);
        if (status === 'success') requestsSuccess += v;
        else if (status === 'failed' || status === 'error') requestsFailed += v;
      }
    }
    const successRate = requestsTotal > 0 ? requestsSuccess / requestsTotal : 1;
    const hv = latencyHist?.values.get(`connector="${id}"`);
    const p50 = hv ? round(histogramPercentile(hv, 0.5), 1) : 0;
    const p99 = hv ? round(histogramPercentile(hv, 0.99), 1) : 0;

    const health = safe(() => sharedHealthMonitor.getHealth(id as any), undefined);
    const recentErrorLogs = safe(
      () =>
        sharedLogBuffer
          .query({ msgIncludes: id, level: ['error', 'warn', 'fatal'], limit: 5 })
          .map((e) => ({ ts: e.ts, msg: e.msg, level: e.level })),
      [],
    );

    rows.push({
      id,
      requestsTotal,
      requestsSuccess,
      requestsFailed,
      successRate: round(successRate, 4),
      p50LatencyMs: p50,
      p99LatencyMs: p99,
      healthy: health?.healthy ?? true,
      consecutiveFailures: health?.consecutiveFailures ?? 0,
      lastError: health?.lastError,
      recentErrorLogs,
    });
    totalRequests += requestsTotal;
    totalSuccess += requestsSuccess;
  }
  return {
    ts: now(),
    connectors: rows,
    totalRequests,
    avgSuccessRate: totalRequests > 0 ? round(totalSuccess / totalRequests, 4) : 1,
  };
}

// ─── Settlement Dashboard ─────────────────────────────────────────────────────

export interface SettlementCorridorRow {
  corridor: string;
  count: number;
  p50Ms: number;
  p99Ms: number;
}

export interface SettlementDashboard {
  ts: number;
  totalSettlements: number;
  byCorridor: SettlementCorridorRow[];
  byCurrency: { currency: string; count: number }[];
  byStatus: { status: string; count: number }[];
  p99Ms: number;  // worst across corridors
  successRate: number;
  recentSettlementSpans: {
    traceId: string;
    spanId: string;
    durationMs: number;
    status: string;
    ts: number;
  }[];
}

/** Settlement volume by corridor/currency, p99 latency, success rate. */
export function settlementDashboard(): SettlementDashboard {
  const hist = metricsRegistry.getHistogram('payswap_settlement_duration_ms');
  const corridors: SettlementCorridorRow[] = [];
  let p99Overall = 0;
  let totalCount = 0;
  if (hist) {
    for (const [key, hv] of hist.values.entries()) {
      const labels = parseLabelKey(key);
      const corridor = String(labels.corridor ?? 'unknown');
      const p50 = round(histogramPercentile(hv, 0.5), 1);
      const p99 = round(histogramPercentile(hv, 0.99), 1);
      corridors.push({ corridor, count: hv.count, p50Ms: p50, p99Ms: p99 });
      p99Overall = Math.max(p99Overall, p99);
      totalCount += hv.count;
    }
  }
  corridors.sort((a, b) => b.count - a.count);

  // By currency (from payments counter).
  const paymentsCounter = metricsRegistry.getCounter('payswap_payments_total');
  const byCurrency = new Map<string, number>();
  const byStatus = new Map<string, number>();
  let paymentSuccess = 0;
  let paymentTotal = 0;
  if (paymentsCounter) {
    for (const [key, v] of paymentsCounter.values.entries()) {
      if (typeof v !== 'number') continue;
      const labels = parseLabelKey(key);
      const cur = String(labels.currency ?? 'unknown');
      byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + v);
      const status = String(labels.status ?? 'unknown');
      byStatus.set(status, (byStatus.get(status) ?? 0) + v);
      paymentTotal += v;
      if (status === 'success' || status === 'settled' || status === 'completed') {
        paymentSuccess += v;
      }
    }
  }

  const recentSpans = safe(
    () =>
      inMemorySpanExporter
        .query({ name: 'payment.settle', limit: 20 })
        .map((s) => ({
          traceId: s.traceId,
          spanId: s.spanId,
          durationMs: s.durationMs ?? 0,
          status: s.status,
          ts: s.startTime,
        })),
    [],
  );

  return {
    ts: now(),
    totalSettlements: totalCount,
    byCorridor: corridors,
    byCurrency: [...byCurrency.entries()]
      .map(([currency, count]) => ({ currency, count }))
      .sort((a, b) => b.count - a.count),
    byStatus: [...byStatus.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    p99Ms: round(p99Overall, 1),
    successRate: paymentTotal > 0 ? round(paymentSuccess / paymentTotal, 4) : 1,
    recentSettlementSpans: recentSpans,
  };
}

// ─── LP Dashboard ──────────────────────────────────────────────────────────────

export interface LPRow {
  id: string;
  name: string;
  country: string;
  state: string;
  reputation: number;
  tier: string;
  feeBps: number;
  totalVolume: number;
  totalSettlements: number;
  successRate: number;
  active: boolean;
}

export interface LPCorridorCapacity {
  corridor: string;
  available: number;
  reserved: number;
  total: number;
  utilization: number;
}

export interface LPDashboard {
  ts: number;
  activeCount: number;
  totalCount: number;
  avgReputation: number;
  capacityByCorridor: LPCorridorCapacity[];
  topLPs: LPRow[];
  bottomLPs: LPRow[];
  shortfalls: { corridor: string; horizonMs: number }[];
  networkStatus: Record<string, unknown> | null;
}

/** Active LP count, total capacity by corridor, avg score, top/bottom LPs, shortfalls. */
export function lpDashboard(): LPDashboard {
  const lps = safe(() => liquidityNetwork.allLPs(), []);
  const active = lps.filter((lp) => lp.state === 'active');
  const avgReputation = lps.length > 0
    ? round(lps.reduce((s, lp) => s + lp.reputation, 0) / lps.length, 2)
    : 0;

  // Aggregate capacity by corridor across all LPs.
  const corridorMap = new Map<string, { available: number; reserved: number; total: number }>();
  for (const lp of lps) {
    for (const [corridor, cap] of Object.entries(lp.capacity ?? {})) {
      const e = corridorMap.get(corridor) ?? { available: 0, reserved: 0, total: 0 };
      const avail = lp.availableCapacity?.[corridor] ?? 0;
      const resv = lp.reservedCapacity?.[corridor] ?? 0;
      e.available += avail;
      e.reserved += resv;
      e.total += cap;
      corridorMap.set(corridor, e);
    }
  }
  const capacityByCorridor: LPCorridorCapacity[] = [...corridorMap.entries()]
    .map(([corridor, e]) => ({
      corridor,
      available: round(e.available, 2),
      reserved: round(e.reserved, 2),
      total: round(e.total, 2),
      utilization: e.total > 0 ? round((e.total - e.available) / e.total, 4) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const rows: LPRow[] = lps.map((lp) => ({
    id: lp.id,
    name: lp.name,
    country: lp.country,
    state: lp.state,
    reputation: lp.reputation,
    tier: lp.tier,
    feeBps: lp.feeBps,
    totalVolume: lp.totalVolume,
    totalSettlements: lp.totalSettlements,
    successRate: round(lp.historicalSuccessRate, 4),
    active: lp.state === 'active',
  }));
  const sorted = [...rows].sort((a, b) => b.reputation - a.reputation);
  const topLPs = sorted.slice(0, 5);
  const bottomLPs = sorted.slice(-5).reverse();

  const shortfalls = safe(
    () =>
      liquidityNetwork
        .shortfallAlerts()
        .map((c) => ({ corridor: `${c.fromCurrency}→${c.toCurrency}`, horizonMs: 0 })),
    [],
  );

  const networkStatus = safe(() => liquidityNetwork.networkStatus() as any, null);

  // Sync the ops metric so the alert rule sees the current value.
  const lpGauge = metricsRegistry.getGauge('payswap_lp_active_count');
  if (lpGauge) lpGauge.set(active.length);
  for (const cap of capacityByCorridor) {
    metricsRegistry
      .getGauge('payswap_lp_capacity_available')
      ?.set({ corridor: cap.corridor }, cap.available);
  }

  return {
    ts: now(),
    activeCount: active.length,
    totalCount: lps.length,
    avgReputation,
    capacityByCorridor,
    topLPs,
    bottomLPs,
    shortfalls,
    networkStatus,
  };
}

// ─── Merchant Dashboard ───────────────────────────────────────────────────────

export interface MerchantRow {
  merchantId: string;
  paymentCount: number;
  payoutCount: number;
  errorRate: number;
}

export interface MerchantDashboard {
  ts: number;
  merchantId?: string;
  totalPayments: number;
  totalPayouts: number;
  paymentErrorRate: number;
  payoutErrorRate: number;
  topMerchants: MerchantRow[];
  recentMerchantLogs: { ts: number; level: string; msg: string; merchantId?: string }[];
}

/** Payment/payout volume, top merchants, error rates — optionally scoped to one merchant. */
export function merchantDashboard(merchantId?: string): MerchantDashboard {
  // The metrics registry doesn't yet carry merchant labels (would require
  // a metric like payswap_payments_total{... merchant=...}). We aggregate
  // from logs (which DO carry merchantId via the correlation context).
  const since = now() - 24 * 60 * 60 * 1000;  // last 24h
  const logs = sharedLogBuffer.query({ since });
  const merchantMap = new Map<string, { payments: number; payouts: number; errors: number }>();
  let totalPayments = 0;
  let totalPayouts = 0;
  let paymentErrors = 0;
  let payoutErrors = 0;

  for (const e of logs) {
    const mid = (e.fields?.merchantId as string) ?? (e.correlation?.merchantId as string) ?? '';
    const kind = e.fields?.kind as string | undefined;
    const isError = e.level === 'error' || e.level === 'fatal';
    if (kind === 'payment') {
      totalPayments += 1;
      if (isError) paymentErrors += 1;
      if (mid) {
        const m = merchantMap.get(mid) ?? { payments: 0, payouts: 0, errors: 0 };
        m.payments += 1;
        if (isError) m.errors += 1;
        merchantMap.set(mid, m);
      }
    } else if (kind === 'payout') {
      totalPayouts += 1;
      if (isError) payoutErrors += 1;
      if (mid) {
        const m = merchantMap.get(mid) ?? { payments: 0, payouts: 0, errors: 0 };
        m.payouts += 1;
        if (isError) m.errors += 1;
        merchantMap.set(mid, m);
      }
    }
  }

  const topMerchants: MerchantRow[] = [...merchantMap.entries()]
    .map(([mid, m]) => ({
      merchantId: mid,
      paymentCount: m.payments,
      payoutCount: m.payouts,
      errorRate:
        m.payments + m.payouts > 0 ? round(m.errors / (m.payments + m.payouts), 4) : 0,
    }))
    .sort((a, b) => b.paymentCount + b.payoutCount - (a.paymentCount + a.payoutCount))
    .slice(0, 20);

  // If merchantId provided, filter logs to that merchant.
  const filter = merchantId
    ? logs.filter(
        (e) =>
          (e.fields?.merchantId as string) === merchantId ||
          e.correlation?.merchantId === merchantId,
      )
    : logs;
  const recentMerchantLogs = filter
    .filter((e) => e.level === 'error' || e.level === 'warn' || e.level === 'fatal')
    .slice(-20)
    .map((e) => ({
      ts: e.ts,
      level: e.level,
      msg: e.msg,
      merchantId: (e.fields?.merchantId as string) ?? e.correlation?.merchantId,
    }));

  return {
    ts: now(),
    merchantId,
    totalPayments,
    totalPayouts,
    paymentErrorRate: totalPayments > 0 ? round(paymentErrors / totalPayments, 4) : 0,
    payoutErrorRate: totalPayouts > 0 ? round(payoutErrors / totalPayouts, 4) : 0,
    topMerchants,
    recentMerchantLogs,
  };
}

// ─── Treasury Dashboard ───────────────────────────────────────────────────────

export interface TreasuryDashboard {
  ts: number;
  report: Record<string, unknown> | null;
  reserveRatios: { currency: string; ratio: number }[];
  backingVerified: boolean;
  frozenAssets: string[];
  activeTreasuryAlerts: number;
  efficiency: { assetCode: string; efficiency: number; reserveRatio: number; utilization: number }[];
}

/** Reserves, backing ratios, alerts, frozen assets, efficiency. */
export function treasuryDashboard(): TreasuryDashboard {
  const report = safe(() => treasuryEngine.dailyReport() as any, null);

  // Pull reserve ratios from the ops metrics gauge.
  const reserveGauge = metricsRegistry.getGauge('payswap_treasury_reserve_ratio');
  const reserveRatios: { currency: string; ratio: number }[] = [];
  if (reserveGauge) {
    for (const [key, v] of reserveGauge.values.entries()) {
      if (typeof v !== 'number') continue;
      const labels = parseLabelKey(key);
      reserveRatios.push({ currency: String(labels.currency ?? 'unknown'), ratio: round(v, 4) });
    }
  }

  const efficiency: TreasuryDashboard['efficiency'] =
    (report?.capitalEfficiency as any[] | undefined)?.map((c) => ({
      assetCode: c.assetCode,
      efficiency: round(c.efficiency, 4),
      reserveRatio: round(c.reserveRatio, 4),
      utilization: round(c.utilization, 4),
    })) ?? [];

  // Active treasury alerts from treasury-v2's alert engine (defensive).
  const activeTreasuryAlerts = safe(
    () => (report?.alerts as any[] | undefined)?.length ?? 0,
    0,
  );

  return {
    ts: now(),
    report,
    reserveRatios,
    backingVerified: report?.backingVerified ?? true,
    frozenAssets: (report?.frozenAssets as string[] | undefined) ?? [],
    activeTreasuryAlerts,
    efficiency,
  };
}

// ─── All-in-one ────────────────────────────────────────────────────────────────

/** Every dashboard in one payload — for the unified ops console. */
export function allDashboards(): Record<string, unknown> {
  return {
    ts: now(),
    system: safe(() => systemOverview(), null),
    connectors: safe(() => connectorDashboard(), null),
    settlement: safe(() => settlementDashboard(), null),
    lp: safe(() => lpDashboard(), null),
    treasury: safe(() => treasuryDashboard(), null),
    metricsText: safe(() => metricsRegistry.expose(), ''),
    metricsJson: safe(() => metricsRegistry.json(), {}),
    activeAlerts: safe(() => alertManager.active(), []),
    sloStatus: safe(() => sloManager.evaluate(metricsRegistry), []),
    recentLogs: safe(
      () => sharedLogBuffer.query({ limit: 100 }),
      [],
    ),
  };
}
