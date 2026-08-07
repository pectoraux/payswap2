/**
 * PaySwap Protocol — Ops Module — Alerting.
 *
 * Rule-driven alerting on top of the metrics registry. Each `AlertRule`
 * derives a numeric value from the registry, compares it against a threshold
 * using a condition operator, and fires an `Alert` when violated. Alerts
 * auto-resolve when their rule stops triggering; manual `resolve()` is also
 * supported.
 *
 * Cooldowns prevent alert flapping: a rule will not re-fire within its
 * `cooldownMs` window even if it keeps triggering.
 *
 * The kernel is FROZEN. This module imports `uid` / `nowTs` from
 * `@/kernel/support` and the metrics registry from `./metrics`.
 */
import { uid, nowTs } from '@/kernel/support';
import type { MetricsRegistry, AnyMetric, Counter, Gauge, Histogram } from './metrics';
import { METRIC_NAMES } from './metrics';

/** Comparison operators supported by alert rules. */
export type AlertCondition = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';

/** Check a condition between a value and a threshold. */
export function checkCondition(op: AlertCondition, value: number, threshold: number): boolean {
  switch (op) {
    case 'gt': return value > threshold;
    case 'lt': return value < threshold;
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
    case 'eq': return value === threshold;
    default: return false;
  }
}

/** Standard built-in alert rules. */
export const STANDARD_ALERT_RULES: AlertRule[] = [
  { id: 'std:error_rate_high', name: 'Error rate > 5%', metric: 'error_count', condition: 'gt', threshold: 5, severity: 'critical', cooldownMs: 60_000 },
  { id: 'std:latency_p95_high', name: 'P95 latency > 500ms', metric: 'latency_p95', condition: 'gt', threshold: 500, severity: 'warning', cooldownMs: 60_000 },
];

/** Alert severity tiers. */
export type AlertSeverity = 'info' | 'warning' | 'critical';

/** A user-defined alert rule. */
export interface AlertRule {
  /** Stable rule id (used as the dedup key). */
  id: string;
  /** Human-readable rule name. */
  name: string;
  /** Metric name the rule observes (documentary; the evaluator reads it). */
  metric: string;
  /** Comparison operator applied to `evaluate(registry)` vs `threshold`. */
  condition: AlertCondition;
  /** Threshold the evaluated value is compared against. */
  threshold: number;
  /** Severity assigned to alerts fired by this rule. */
  severity: AlertSeverity;
  /** Minimum time between consecutive firings of this rule, in ms. */
  cooldownMs: number;
  /**
   * Derive the numeric value to compare. Optional — when omitted the manager
   * falls back to a sensible default per metric type (counter/gauge total,
   * histogram p99).
   */
  evaluate?: (registry: MetricsRegistry) => number;
}

/** A fired alert instance. */
export interface Alert {
  id: string;
  ruleId: string;
  name: string;
  severity: AlertSeverity;
  message: string;
  value: number;
  firedAt: number;
  resolvedAt?: number;
}

/** Optional time range filter for `all()`. */
export interface AlertTimeRange {
  from?: number;
  to?: number;
}

/**
 * Returns true when `value <op> threshold` holds.
 */
function matches(condition: AlertCondition, value: number, threshold: number): boolean {
  switch (condition) {
    case 'gt':
      return value > threshold;
    case 'lt':
      return value < threshold;
    case 'gte':
      return value >= threshold;
    case 'lte':
      return value <= threshold;
    default:
      return false;
  }
}

/** Default evaluator used when a rule omits `evaluate`. */
function defaultValue(registry: MetricsRegistry, rule: AlertRule): number {
  const m: AnyMetric | undefined = registry.get(rule.metric);
  if (!m) return 0;
  if ((m as Counter).total) return (m as Counter).total();
  if ((m as Histogram).percentile) return (m as Histogram).percentile(0.99);
  if ((m as Gauge).get) return (m as Gauge).get();
  return 0;
}

/** Format the human-readable alert message. */
function formatMessage(rule: AlertRule, value: number): string {
  const op: Record<AlertCondition, string> = {
    gt: '>',
    lt: '<',
    gte: '>=',
    lte: '<=',
    eq: '==',
  };
  return `${rule.name}: ${rule.metric}=${round6(value)} ${op[rule.condition]} ${rule.threshold}`;
}

function round6(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}

/**
 * AlertManager owns alert rules and the alert history. `evaluate()` runs every
 * rule against the registry, fires new alerts (respecting cooldowns), and
 * auto-resolves alerts whose rule has stopped triggering.
 */
export class AlertManager {
  private rules = new Map<string, AlertRule>();
  private alerts = new Map<string, Alert>();
  private lastFired = new Map<string, number>();

  /** Register a rule. Overwrites a rule with the same id. */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
  }

  /** Remove a rule by id. */
  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  /** All registered rules. */
  rules_(): AlertRule[] {
    return [...this.rules.values()];
  }

  /** Look up a rule by id. */
  rule(id: string): AlertRule | undefined {
    return this.rules.get(id);
  }

  /**
   * Evaluate every rule against the registry. Returns the list of alerts fired
   * during this pass. Previously-fired alerts whose rule is no longer
   * triggering are auto-resolved.
   */
  evaluate(registry: MetricsRegistry): Alert[] {
    const now = nowTs();
    const fired: Alert[] = [];
    for (const rule of this.rules.values()) {
      const value = rule.evaluate ? rule.evaluate(registry) : defaultValue(registry, rule);
      const triggering = matches(rule.condition, value, rule.threshold);
      const active = this.activeAlertForRule(rule.id);

      if (triggering) {
        if (active) continue; // already firing — no duplicate
        const last = this.lastFired.get(rule.id) ?? 0;
        if (now - last < rule.cooldownMs) continue;
        this.lastFired.set(rule.id, now);
        const alert: Alert = {
          id: uid('alert'),
          ruleId: rule.id,
          name: rule.name,
          severity: rule.severity,
          message: formatMessage(rule, value),
          value: round6(value),
          firedAt: now,
        };
        this.alerts.set(alert.id, alert);
        fired.push(alert);
      } else if (active) {
        // Rule recovered — auto-resolve its active alert.
        active.resolvedAt = now;
      }
    }
    return fired;
  }

  /** Currently active (unresolved) alerts, most severe first. */
  active(): Alert[] {
    const sevRank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
    return [...this.alerts.values()]
      .filter((a) => a.resolvedAt === undefined)
      .sort((a, b) => {
        const s = sevRank[a.severity] - sevRank[b.severity];
        return s !== 0 ? s : b.firedAt - a.firedAt;
      });
  }

  /** All alerts (active + resolved), optionally filtered to a time range. */
  all(range?: AlertTimeRange): Alert[] {
    const from = range?.from ?? -Infinity;
    const to = range?.to ?? Infinity;
    return [...this.alerts.values()]
      .filter((a) => a.firedAt >= from && a.firedAt <= to)
      .sort((a, b) => b.firedAt - a.firedAt);
  }

  /** Manually resolve an alert. Returns true on success. */
  resolve(alertId: string): boolean {
    const a = this.alerts.get(alertId);
    if (!a || a.resolvedAt !== undefined) return false;
    a.resolvedAt = nowTs();
    return true;
  }

  /** Look up a single alert. */
  get(alertId: string): Alert | undefined {
    return this.alerts.get(alertId);
  }

  /** Clear all alerts and cooldown state (testing only). */
  reset(): void {
    this.alerts.clear();
    this.lastFired.clear();
  }

  /** Find the currently-active alert for a rule, if any. */
  private activeAlertForRule(ruleId: string): Alert | undefined {
    for (const a of this.alerts.values()) {
      if (a.ruleId === ruleId && a.resolvedAt === undefined) return a;
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Pre-registered rules + singleton
// ---------------------------------------------------------------------------

/** Build an AlertManager pre-loaded with PaySwap's default rules. */
function createDefaultAlertManager(): AlertManager {
  const mgr = new AlertManager();

  // Settlement p99 latency above 10s → warning.
  mgr.addRule({
    id: 'settlement_p99_high',
    name: 'Settlement p99 latency above 10s',
    metric: METRIC_NAMES.settlementDurationMs,
    condition: 'gt',
    threshold: 10_000,
    severity: 'warning',
    cooldownMs: 60_000,
    evaluate: (r) => r.getHistogram(METRIC_NAMES.settlementDurationMs)?.percentile(0.99) ?? 0,
  });

  // Connector error rate above 5% → critical.
  mgr.addRule({
    id: 'connector_error_rate_high',
    name: 'Connector error rate above 5%',
    metric: METRIC_NAMES.connectorRequestsTotal,
    condition: 'gt',
    threshold: 0.05,
    severity: 'critical',
    cooldownMs: 30_000,
    evaluate: (r) => {
      const c = r.getCounter(METRIC_NAMES.connectorRequestsTotal);
      if (!c) return 0;
      const total = c.total();
      if (total <= 0) return 0;
      const failed = c.get({ status: 'error' });
      return failed / total;
    },
  });

  // Treasury reserve ratio below 1.1 → critical.
  // The gauge is populated by the dashboards refresh step; before it has been
  // set we return a safe high value so the alert does not fire on cold start.
  mgr.addRule({
    id: 'treasury_reserve_ratio_low',
    name: 'Treasury reserve ratio below 1.1',
    metric: METRIC_NAMES.treasuryReserveRatio,
    condition: 'lt',
    threshold: 1.1,
    severity: 'critical',
    cooldownMs: 60_000,
    evaluate: (r) => {
      const g = r.getGauge(METRIC_NAMES.treasuryReserveRatio);
      if (!g || !g.has()) return Number.MAX_SAFE_INTEGER;
      return g.get();
    },
  });

  return mgr;
}

/**
 * Singleton alert manager with the default rules pre-registered. Stashed on
 * `globalThis` to survive Next.js dev module re-instantiation.
 */
const _globalForAlerts = globalThis as unknown as { __PAYSWAP_ALERT_MANAGER?: AlertManager };
export const alertManager: AlertManager =
  _globalForAlerts.__PAYSWAP_ALERT_MANAGER ?? createDefaultAlertManager();
if (!_globalForAlerts.__PAYSWAP_ALERT_MANAGER) {
  _globalForAlerts.__PAYSWAP_ALERT_MANAGER = alertManager;
}
