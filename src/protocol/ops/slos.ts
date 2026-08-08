/**
 * PaySwap Protocol — Ops Module — Service Level Objectives.
 *
 * An SLO couples a measurable signal (derived from the metrics registry) to a
 * target and an error budget. `SLOManager.evaluate()` produces a per-SLO
 * status snapshot; `errorBudget()` reports how much of the budget is consumed.
 *
 * Two directions are supported:
 *   - `at_least` (availability-style): currentValue ≥ target is on track.
 *     Error budget = (1 − target). Used = (1 − currentValue) / (1 − target).
 *     Example: payment success rate target 0.999.
 *   - `at_most` (latency-style): currentValue ≤ target is on track.
 *     Error budget = target. Used = currentValue / target.
 *     Example: settlement p99 target 5_000 ms.
 *
 * `used ≤ 1.0` ⇒ on track. `used > 1.0` ⇒ budget exhausted, SLO breached.
 *
 * The kernel is FROZEN. This module imports only from `@/kernel/support` and
 * `./metrics`.
 */
import type { MetricsRegistry } from './metrics';
import { METRIC_NAMES } from './metrics';

/** SLO direction — whether higher or lower values are better. */
export type SLODirection = 'at_least' | 'at_most';

/** A service-level objective definition. */
export interface SLO {
  /** Stable id. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Target value. For `at_least` this is a minimum; for `at_most` a maximum. */
  target: number;
  /** Rolling window the SLO is measured over (ms). Documentary. */
  windowMs: number;
  /** Metric name the SLO is derived from (documentary). */
  metric: string;
  /** Free-form description. */
  description: string;
  /** Comparison direction (default `at_least`). */
  direction?: SLODirection;
  /** Derive the current numeric value from the registry. */
  evaluate?: (registry: MetricsRegistry) => number;
  /**
   * Optional: derive good/total counts from the registry. Used to populate
   * `SLOStatus.goodCount` + `SLOStatus.totalCount` (and the derived
   * `errorRate` / `errorBudgetConsumed` fields) for availability-style SLOs.
   */
  counts?: (registry: MetricsRegistry) => { good: number; total: number };
}

/** Per-SLO evaluation result. */
export interface SLOStatus {
  slo: SLO;
  /** Most recent measured value. */
  currentValue: number;
  /** Target (mirrored from the SLO for convenience). */
  target: number;
  /** True when the value satisfies the SLO direction. */
  onTrack: boolean;
  /** Fraction of the error budget consumed (1.0 = at the limit, >1 = breached). */
  errorBudgetUsed: number;
  /** Good-outcome count (availability-style SLOs only; 0 otherwise). */
  goodCount: number;
  /** Total-outcome count (availability-style SLOs only; 0 otherwise). */
  totalCount: number;
  /** Error budget fraction = 1 - target (at_least) or target (at_most). */
  errorBudget: number;
  /** Observed error rate = 1 - currentValue (at_least) or currentValue / target (at_most). */
  errorRate: number;
  /** Fraction of the error budget consumed (alias for `errorBudgetUsed`). >1 means breached. */
  errorBudgetConsumed: number;
}

/** Error-budget report for a single SLO. */
export interface ErrorBudget {
  sloId: string;
  /** Fraction of the error budget consumed (1.0 = at the limit). */
  used: number;
  /** Fraction of the budget remaining, clamped to [0, 1]. */
  remaining: number;
  /** True when the SLO is currently satisfied. */
  onTrack: boolean;
  /** Total budget fraction (1 - target for at_least, target for at_most). */
  budget: number;
  /** Fraction of the budget consumed (alias for `used`). */
  consumed: number;
}

/** Clamp a number to [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Compute the error-budget fraction consumed for a measured value.
 * Returns 0 when the budget is undefined (e.g. target === 1 for at_least).
 */
function computeBudgetUsed(direction: SLODirection, value: number, target: number): number {
  if (direction === 'at_least') {
    const budget = 1 - target;
    if (budget <= 0) {
      // Target is perfection — any imperfection exhausts the budget.
      return value >= 1 ? 0 : Infinity;
    }
    const actualError = Math.max(0, 1 - value);
    return actualError / budget;
  }
  // at_most
  if (target <= 0) {
    return value <= 0 ? 0 : Infinity;
  }
  return value / target;
}

/**
 * SLOManager owns the SLO registry and produces status snapshots. It is
 * stateless beyond the rule set — every `evaluate()` reads live metrics.
 */
export class SLOManager {
  private slos = new Map<string, SLO>();

  /** Register an SLO. Overwrites an SLO with the same id. */
  addSlo(slo: SLO): void {
    this.slos.set(slo.id, slo);
  }

  /** Remove an SLO by id. */
  removeSlo(sloId: string): void {
    this.slos.delete(sloId);
  }

  /** All registered SLOs. */
  all(): SLO[] {
    return [...this.slos.values()];
  }

  /** Look up an SLO by id. */
  get(sloId: string): SLO | undefined {
    return this.slos.get(sloId);
  }

  /** Evaluate every SLO against the registry. */
  evaluate(registry: MetricsRegistry): SLOStatus[] {
    const out: SLOStatus[] = [];
    for (const slo of this.slos.values()) {
      const direction: SLODirection = slo.direction ?? 'at_least';
      const value = slo.evaluate ? slo.evaluate(registry) : 0;
      const used = computeBudgetUsed(direction, value, slo.target);
      const onTrack = used <= 1;
      const counts = slo.counts ? slo.counts(registry) : { good: 0, total: 0 };
      const errorBudget = direction === 'at_least' ? 1 - slo.target : slo.target;
      const errorRate = direction === 'at_least'
        ? Math.max(0, 1 - value)
        : (slo.target > 0 ? value / slo.target : 0);
      out.push({
        slo,
        currentValue: value,
        target: slo.target,
        onTrack,
        errorBudgetUsed: used,
        goodCount: counts.good,
        totalCount: counts.total,
        errorBudget,
        errorRate,
        errorBudgetConsumed: used,
      });
    }
    return out;
  }

  /** Error-budget report for a single SLO. Returns null if the SLO is unknown. */
  errorBudget(sloId: string, registry: MetricsRegistry): ErrorBudget | null {
    const slo = this.slos.get(sloId);
    if (!slo) return null;
    const direction: SLODirection = slo.direction ?? 'at_least';
    const value = slo.evaluate ? slo.evaluate(registry) : 0;
    const used = computeBudgetUsed(direction, value, slo.target);
    const budget = direction === 'at_least' ? 1 - slo.target : slo.target;
    return {
      sloId,
      used,
      remaining: clamp(1 - used, 0, 1),
      onTrack: used <= 1,
      budget,
      consumed: used,
    };
  }
}

// ---------------------------------------------------------------------------
// Pre-registered SLOs + singleton
// ---------------------------------------------------------------------------

/** Build an SLOManager pre-loaded with PaySwap's default SLOs. */
function createDefaultSloManager(): SLOManager {
  const mgr = new SLOManager();

  // Payment success rate ≥ 99.9%.
  mgr.addSlo({
    id: 'payment_success',
    name: 'Payment Success Rate',
    target: 0.999,
    windowMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    metric: METRIC_NAMES.paymentsTotal,
    description: 'Share of payments that complete successfully (target 99.9%).',
    direction: 'at_least',
    evaluate: (r) => {
      const c = r.getCounter(METRIC_NAMES.paymentsTotal);
      if (!c) return 1;
      const total = c.total();
      if (total <= 0) return 1; // no data ⇒ trivially on track
      const success = c.get({ status: 'success' });
      return success / total;
    },
    counts: (r) => {
      const c = r.getCounter(METRIC_NAMES.paymentsTotal);
      if (!c) return { good: 0, total: 0 };
      const total = c.total();
      const success = c.get({ status: 'success' });
      return { good: success, total };
    },
  });

  // Settlement success rate ≥ 99.9% — availability-style SLO backed by the
  // same payments counter. Exposed under a distinct id so dashboards can
  // track "settlement success" separately from "payment success" even though
  // they share the underlying metric.
  mgr.addSlo({
    id: 'settlement_success',
    name: 'Settlement Success Rate',
    target: 0.999,
    windowMs: 30 * 24 * 60 * 60 * 1000,
    metric: METRIC_NAMES.paymentsTotal,
    description: 'Share of settlements that complete successfully (target 99.9%).',
    direction: 'at_least',
    evaluate: (r) => {
      const c = r.getCounter(METRIC_NAMES.paymentsTotal);
      if (!c) return 1;
      const total = c.total();
      if (total <= 0) return 1;
      const success = c.get({ status: 'success' });
      return success / total;
    },
    counts: (r) => {
      const c = r.getCounter(METRIC_NAMES.paymentsTotal);
      if (!c) return { good: 0, total: 0 };
      const total = c.total();
      const success = c.get({ status: 'success' });
      return { good: success, total };
    },
  });

  // Payout completion rate ≥ 99.5%.
  mgr.addSlo({
    id: 'payout_completion',
    name: 'Payout Completion Rate',
    target: 0.995,
    windowMs: 30 * 24 * 60 * 60 * 1000,
    metric: METRIC_NAMES.payoutsTotal,
    description: 'Share of payouts that complete successfully (target 99.5%).',
    direction: 'at_least',
    evaluate: (r) => {
      const c = r.getCounter(METRIC_NAMES.payoutsTotal);
      if (!c) return 1;
      const total = c.total();
      if (total <= 0) return 1;
      const success = c.get({ status: 'success' });
      return success / total;
    },
    counts: (r) => {
      const c = r.getCounter(METRIC_NAMES.payoutsTotal);
      if (!c) return { good: 0, total: 0 };
      const total = c.total();
      const success = c.get({ status: 'success' });
      return { good: success, total };
    },
  });

  // Settlement p99 latency ≤ 5s.
  mgr.addSlo({
    id: 'settlement_p99',
    name: 'Settlement p99 Latency',
    target: 5_000,
    windowMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    metric: METRIC_NAMES.settlementDurationMs,
    description: '99th-percentile settlement duration in ms (target ≤ 5s).',
    direction: 'at_most',
    evaluate: (r) => r.getHistogram(METRIC_NAMES.settlementDurationMs)?.percentile(0.99) ?? 0,
  });

  // Connector availability ≥ 99.95%.
  mgr.addSlo({
    id: 'connector_availability',
    name: 'Connector Availability',
    target: 0.9995,
    windowMs: 30 * 24 * 60 * 60 * 1000,
    metric: METRIC_NAMES.connectorRequestsTotal,
    description: 'Share of connector requests that succeed (target 99.95%).',
    direction: 'at_least',
    evaluate: (r) => {
      const c = r.getCounter(METRIC_NAMES.connectorRequestsTotal);
      if (!c) return 1;
      const total = c.total();
      if (total <= 0) return 1;
      const success = c.get({ status: 'success' });
      return success / total;
    },
  });

  return mgr;
}

/**
 * Singleton SLO manager with the default SLOs pre-registered. Stashed on
 * `globalThis` to survive Next.js dev module re-instantiation.
 */
const _globalForSlos = globalThis as unknown as { __PAYSWAP_SLO_MANAGER?: SLOManager };
export const sloManager: SLOManager =
  _globalForSlos.__PAYSWAP_SLO_MANAGER ?? createDefaultSloManager();
if (!_globalForSlos.__PAYSWAP_SLO_MANAGER) {
  _globalForSlos.__PAYSWAP_SLO_MANAGER = sloManager;
}
