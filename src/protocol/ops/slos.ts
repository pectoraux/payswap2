/**
 * PaySwap Protocol — Operational Readiness — Service Level Objectives.
 *
 * Defines SLOs as `{ good, total }` ratios over a rolling window, tracks
 * error-budget consumption, and reports on-track status. SLOs are
 * evaluated against the live metrics registry — so calling
 * `sloManager.evaluate(metricsRegistry)` returns the current status of
 * every registered SLO.
 *
 * Error budget model:
 *   - `errorBudget`         = 1 - target (e.g. target=0.999 → budget=0.001)
 *   - `errorRate`           = (total - good) / total
 *   - `errorBudgetRemaining`= errorBudget - errorRate
 *   - `onTrack`             = errorBudgetRemaining >= 0
 *
 * If `errorBudgetRemaining < 0`, the SLO is being violated — the budget
 * has been exhausted and a feature freeze / capacity review may be
 * warranted.
 *
 * Pre-registered SLOs cover the four critical PaySwap user-facing
 * surfaces: payment settlement success, settlement latency, connector
 * availability, payout completion, and webhook delivery.
 */
import {
  counterSum,
  parseLabelKey,
  type HistogramValue,
  type MetricsRegistry,
} from './metrics';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SLO {
  /** Unique SLO ID. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Target success ratio in [0, 1] — e.g. 0.999 = 99.9%. */
  target: number;
  /** Evaluation window (informational — actual evaluation is point-in-time over all history). */
  windowMs: number;
  /** Metric name the SLO is computed from (informational). */
  metric: string;
  /** Returns the count of "good" events in the window. */
  goodCondition: (registry: MetricsRegistry) => number;
  /** Returns the count of "total" events in the window. */
  totalCondition: (registry: MetricsRegistry) => number;
  /** Human-readable description. */
  description?: string;
}

export interface SLOStatus {
  /** The SLO definition. */
  slo: SLO;
  /** Count of "good" events. */
  goodCount: number;
  /** Count of "total" events. */
  totalCount: number;
  /** Current success ratio (good/total, or 1 if no data). */
  successRate: number;
  /** Error budget = 1 - target. */
  errorBudget: number;
  /** Current error rate = (total - good) / total. */
  errorRate: number;
  /** Remaining error budget = errorBudget - errorRate. May be negative. */
  errorBudgetRemaining: number;
  /** Fraction of error budget consumed (errorRate / errorBudget). >1 means over. */
  errorBudgetConsumed: number;
  /** True iff errorBudgetRemaining >= 0. */
  onTrack: boolean;
}

export interface ErrorBudgetReport {
  /** The SLO id. */
  sloId: string;
  /** Total budget = 1 - target. */
  budget: number;
  /** Error rate = errors / total. */
  consumed: number;
  /** Budget remaining = budget - consumed. Negative if over. */
  remaining: number;
  /** Fraction of budget consumed (1 = exactly exhausted, >1 = over). */
  consumedFraction: number;
}

// ─── SLOManager ──────────────────────────────────────────────────────────────

/**
 * Owns SLO definitions. `evaluate(registry)` returns the current status
 * of every SLO; `errorBudget(sloId, registry)` returns a focused
 * error-budget report for one SLO.
 */
export class SLOManager {
  private slos: Map<string, SLO> = new Map();

  /** Register an SLO. Overwrites an existing SLO with the same id. */
  addSlo(slo: SLO): void {
    this.slos.set(slo.id, slo);
  }

  /** Remove an SLO by id. */
  removeSlo(id: string): void {
    this.slos.delete(id);
  }

  /** Get an SLO by id. */
  getSlo(id: string): SLO | undefined {
    return this.slos.get(id);
  }

  /** All registered SLOs. */
  all(): SLO[] {
    return [...this.slos.values()];
  }

  /** Evaluate every SLO against the current metrics. */
  evaluate(registry: MetricsRegistry): SLOStatus[] {
    return this.all().map((slo) => this.evaluateOne(slo, registry));
  }

  /** Evaluate one SLO. */
  evaluateOne(slo: SLO, registry: MetricsRegistry): SLOStatus {
    const goodCount = safeCall(() => slo.goodCondition(registry), 0);
    const totalCount = safeCall(() => slo.totalCondition(registry), 0);
    const successRate = totalCount > 0 ? goodCount / totalCount : 1;
    const errorRate = totalCount > 0 ? (totalCount - goodCount) / totalCount : 0;
    const errorBudget = 1 - slo.target;
    const errorBudgetRemaining = errorBudget - errorRate;
    const errorBudgetConsumed = errorBudget > 0 ? errorRate / errorBudget : errorRate > 0 ? Infinity : 0;
    return {
      slo,
      goodCount,
      totalCount,
      successRate,
      errorBudget,
      errorRate,
      errorBudgetRemaining,
      errorBudgetConsumed,
      onTrack: errorBudgetRemaining >= 0,
    };
  }

  /** Focused error-budget report for one SLO. Returns undefined if no such SLO. */
  errorBudget(sloId: string, registry: MetricsRegistry): ErrorBudgetReport | undefined {
    const slo = this.slos.get(sloId);
    if (!slo) return undefined;
    const status = this.evaluateOne(slo, registry);
    return {
      sloId,
      budget: status.errorBudget,
      consumed: status.errorRate,
      remaining: status.errorBudgetRemaining,
      consumedFraction: status.errorBudgetConsumed,
    };
  }
}

/** Safe-call helper — returns fallback if fn throws. */
function safeCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// ─── Helpers for SLO conditions ────────────────────────────────────────────────

/**
 * Sum a counter's values where the `status` label matches one of
 * `statuses`. Used for success/failure-rate SLOs.
 */
export function counterSumByStatus(
  registry: MetricsRegistry,
  metricName: string,
  statuses: string[],
): number {
  return counterSum(registry, metricName, (labels) =>
    statuses.includes(String(labels.status)),
  );
}

/**
 * Sum the cumulative count at the bucket boundary `<= le` across all
 * label sets of a histogram. Used for latency SLOs ("p99 < 5s" means
 * 99% of observations are ≤ 5000ms).
 */
export function histogramCountBelow(
  registry: MetricsRegistry,
  metricName: string,
  le: number,
): number {
  const m = registry.getHistogram(metricName);
  if (!m) return 0;
  let sum = 0;
  for (const v of m.values.values()) {
    const hv = v as HistogramValue;
    let count = 0;
    for (const b of hv.buckets) {
      if (b.le <= le) count = b.count; // buckets are cumulative
    }
    sum += count;
  }
  return sum;
}

/** Sum the total observation count of a histogram across all label sets. */
export function histogramTotalCount(
  registry: MetricsRegistry,
  metricName: string,
): number {
  const m = registry.getHistogram(metricName);
  if (!m) return 0;
  let sum = 0;
  for (const v of m.values.values()) {
    sum += (v as HistogramValue).count;
  }
  return sum;
}

/** Re-export parseLabelKey so SLO condition authors can build custom predicates. */
export { parseLabelKey };

// ─── Pre-registered SLOs ──────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pre-registered PaySwap SLOs. */
export const STANDARD_SLOS: SLO[] = [
  {
    id: 'settlement_success',
    name: 'Payment settlement success',
    target: 0.999,
    windowMs: 30 * DAY_MS,
    metric: 'payswap_payments_total',
    goodCondition: (r) =>
      counterSumByStatus(r, 'payswap_payments_total', ['success', 'settled', 'completed']),
    totalCondition: (r) => counterSum(r, 'payswap_payments_total'),
    description: '99.9% of payments must settle successfully over a 30-day window.',
  },
  {
    id: 'settlement_latency',
    name: 'Settlement latency p99 < 5s',
    target: 0.99,
    windowMs: 30 * DAY_MS,
    metric: 'payswap_settlement_duration_ms',
    goodCondition: (r) => histogramCountBelow(r, 'payswap_settlement_duration_ms', 5000),
    totalCondition: (r) => histogramTotalCount(r, 'payswap_settlement_duration_ms'),
    description: '99% of settlements must complete within 5 seconds (p99 ≤ 5s).',
  },
  {
    id: 'connector_availability',
    name: 'Connector availability',
    target: 0.9995,
    windowMs: 30 * DAY_MS,
    metric: 'payswap_connector_requests_total',
    goodCondition: (r) =>
      counterSumByStatus(r, 'payswap_connector_requests_total', ['success']),
    totalCondition: (r) => counterSum(r, 'payswap_connector_requests_total'),
    description: '99.95% of connector requests must succeed (≈ 4.3m downtime / 30d).',
  },
  {
    id: 'payout_completion',
    name: 'Payout completion',
    target: 0.995,
    windowMs: 30 * DAY_MS,
    metric: 'payswap_payouts_total',
    goodCondition: (r) =>
      counterSumByStatus(r, 'payswap_payouts_total', ['success', 'completed']),
    totalCondition: (r) => counterSum(r, 'payswap_payouts_total'),
    description: '99.5% of payouts must complete successfully.',
  },
  {
    id: 'webhook_delivery',
    name: 'Webhook delivery',
    target: 0.99,
    windowMs: 7 * DAY_MS,
    metric: 'payswap_webhook_deliveries_total',
    goodCondition: (r) =>
      counterSumByStatus(r, 'payswap_webhook_deliveries_total', ['success', 'delivered']),
    totalCondition: (r) => counterSum(r, 'payswap_webhook_deliveries_total'),
    description: '99% of webhook deliveries must succeed over a 7-day window.',
  },
];

// ─── Singleton ─────────────────────────────────────────────────────────────────

/** Singleton SLO manager — pre-registered with the standard SLOs. */
export const sloManager = new SLOManager();

for (const slo of STANDARD_SLOS) {
  sloManager.addSlo(slo);
}
