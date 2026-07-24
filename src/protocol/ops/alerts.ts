/**
 * PaySwap Protocol — Operational Readiness — Alerting.
 *
 * Evaluates `AlertRule`s against the current metrics registry and fires
 * `Alert`s when conditions are violated. Respects per-rule cooldowns so
 * flapping metrics don't spam the alert log. Each fired alert emits an
 * `ops.alert_fired` event into the kernel event stream (so the audit
 * trail and any downstream notification systems see it).
 *
 * Rule evaluation model:
 *   - For counters/gauges: aggregates all label values (sum by default;
 *     min for 'lt'/'lte' rules; max for 'gt'/'gte' rules). This means a
 *     rule like "treasury_reserve_ratio < 1.1" fires if ANY currency's
 *     ratio drops below 1.1.
 *   - For histograms: takes the configured percentile (default p99) and
 *     aggregates as max across label sets — so "settlement p99 > 10s"
 *     fires if ANY corridor's p99 exceeds 10s.
 *   - For derived metrics (e.g. error rate = failed/total): use the
 *     `compute` callback — it receives the registry and returns a number.
 *
 * Pre-registered rules cover the four critical PaySwap failure modes:
 *   1. Settlement p99 latency > 10s  (warning)
 *   2. Connector error rate > 5%     (critical)
 *   3. Treasury reserve ratio < 1.1  (critical)
 *   4. LP active count < 3           (warning)
 *   5. Webhook failure rate > 10%    (critical)
 */
import { eventEngine } from '@/kernel/event';
import {
  histogramPercentile,
  parseLabelKey,
  type HistogramValue,
  type MetricsRegistry,
} from './metrics';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AlertCondition = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
export type AlertSeverity = 'info' | 'warning' | 'critical';

/**
 * Which aspect of a histogram to evaluate. Ignored for counter/gauge.
 * Defaults to 'p99'.
 */
export type HistogramAspect = 'p50' | 'p95' | 'p99' | 'count' | 'sum';

export interface AlertRule {
  /** Unique rule ID (used as dedup key for cooldown). */
  id: string;
  /** Human-readable name (shown in alerts + dashboards). */
  name: string;
  /** Metric name to evaluate (or '_derived' if `compute` is set). */
  metric: string;
  /** Comparison operator. */
  condition: AlertCondition;
  /** Threshold value (rule fires when metric value crosses this). */
  threshold: number;
  /** Evaluation window (informational — current implementation is point-in-time). */
  windowMs: number;
  /** Alert severity — drives routing + paging. */
  severity: AlertSeverity;
  /** Static labels attached to every fired alert (for routing). */
  labels?: Record<string, string>;
  /** Minimum time between consecutive fires of the same rule. */
  cooldownMs: number;
  /** For histograms: which aspect to evaluate (default 'p99'). */
  evaluate?: HistogramAspect;
  /**
   * Optional derived-value computation. Takes precedence over `metric`
   * lookup. Use this for ratios (error rate, success rate) that don't
   * correspond to a single registered metric.
   */
  compute?: (registry: MetricsRegistry) => number | null;
  /** Optional human-readable description (shown in alerts). */
  description?: string;
}

export interface Alert {
  /** Unique alert ID. */
  id: string;
  /** Rule that fired. */
  ruleId: string;
  /** Human-readable name. */
  name: string;
  /** Severity. */
  severity: AlertSeverity;
  /** Human-readable message (includes value + threshold). */
  message: string;
  /** Observed metric value when the alert fired. */
  value: number;
  /** Threshold the rule was checking. */
  threshold: number;
  /** Epoch ms when the alert fired. */
  firedAt: number;
  /** Epoch ms when the alert was resolved (undefined if still active). */
  resolvedAt?: number;
  /** Labels (from the rule + any rule-specific labels). */
  labels: Record<string, string>;
  /** Optional description from the rule. */
  description?: string;
}

// ─── AlertManager ──────────────────────────────────────────────────────────────

/**
 * Owns alert rules and active alert history. `evaluate()` checks all
 * rules against the current metrics registry and fires alerts (respecting
 * per-rule cooldowns). Active alerts remain until `resolve()` is called
 * (manually or by an external resolver).
 */
export class AlertManager {
  private rules: Map<string, AlertRule> = new Map();
  private alerts: Alert[] = [];
  private lastFiredAt: Map<string, number> = new Map();
  private seq = 0;

  /** Register a rule. Overwrites an existing rule with the same id. */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
  }

  /** Remove a rule by id. Does NOT resolve already-fired alerts. */
  removeRule(id: string): void {
    this.rules.delete(id);
  }

  /** Get a rule by id. */
  getRule(id: string): AlertRule | undefined {
    return this.rules.get(id);
  }

  /** All registered rules. */
  rules_(): AlertRule[] {
    return [...this.rules.values()];
  }

  /**
   * Evaluate all rules against the current metrics. Returns the list of
   * newly-fired alerts (empty if none). Idempotent: same metric state →
   * same alerts (modulo cooldown). Fired alerts are appended to the
   * internal history and emit `ops.alert_fired` events.
   */
  evaluate(registry: MetricsRegistry): Alert[] {
    const fired: Alert[] = [];
    const now = Date.now();
    for (const rule of this.rules.values()) {
      const value = this.evaluateRule(rule, registry);
      if (value === null) continue;
      if (!checkCondition(rule.condition, value, rule.threshold)) continue;

      // Cooldown — skip if we fired this rule recently.
      const last = this.lastFiredAt.get(rule.id) ?? 0;
      if (now - last < rule.cooldownMs) continue;

      this.seq += 1;
      const alert: Alert = {
        id: `alert_${rule.id}_${now}_${this.seq}`,
        ruleId: rule.id,
        name: rule.name,
        severity: rule.severity,
        message: `${rule.name}: ${rule.metric} ${rule.condition} ${rule.threshold} (current: ${formatValue(value)})`,
        value,
        threshold: rule.threshold,
        firedAt: now,
        labels: { ...(rule.labels ?? {}) },
        description: rule.description,
      };
      this.alerts.push(alert);
      this.lastFiredAt.set(rule.id, now);
      fired.push(alert);

      // Emit into the kernel event stream — audit trail + downstream
      // notification systems can subscribe.
      eventEngine.emit('ops.alert_fired', {
        alertId: alert.id,
        ruleId: rule.id,
        name: alert.name,
        severity: alert.severity,
        message: alert.message,
        value: alert.value,
        threshold: alert.threshold,
        labels: alert.labels,
      });
    }
    return fired;
  }

  /** Compute the current value of a rule against the registry. */
  private evaluateRule(rule: AlertRule, registry: MetricsRegistry): number | null {
    if (rule.compute) {
      try {
        return rule.compute(registry);
      } catch {
        return null;
      }
    }
    const m = registry.get(rule.metric);
    if (!m) return null;

    if (m.type === 'histogram') {
      // Aggregate as max across label sets — fires if ANY label set
      // breaches the threshold.
      let max = 0;
      let seen = false;
      for (const v of m.values.values()) {
        const hv = v as HistogramValue;
        const aspect = rule.evaluate ?? 'p99';
        let val: number;
        switch (aspect) {
          case 'p50': val = histogramPercentile(hv, 0.5); break;
          case 'p95': val = histogramPercentile(hv, 0.95); break;
          case 'p99': val = histogramPercentile(hv, 0.99); break;
          case 'count': val = hv.count; break;
          case 'sum': val = hv.sum; break;
          default: val = histogramPercentile(hv, 0.99);
        }
        if (val > max) max = val;
        seen = true;
      }
      return seen ? max : null;
    }

    // Counter/Gauge — aggregate label values.
    const values: number[] = [];
    for (const v of m.values.values()) {
      if (typeof v === 'number') values.push(v);
    }
    if (values.length === 0) return null;
    // For 'lt'/'lte' rules, alert if ANY value is below threshold → take min.
    // For 'gt'/'gte' rules, alert if ANY value is above threshold → take max.
    // For 'eq' rules, alert if the sum equals threshold.
    if (rule.condition === 'lt' || rule.condition === 'lte') {
      return Math.min(...values);
    }
    if (rule.condition === 'eq') {
      return values.reduce((s, v) => s + v, 0);
    }
    return Math.max(...values);
  }

  /** Currently-active (unresolved) alerts. */
  active(): Alert[] {
    return this.alerts.filter((a) => a.resolvedAt === undefined);
  }

  /** Alerts within a time range (default: all history). */
  all(range?: { since?: number; until?: number }): Alert[] {
    if (!range) return [...this.alerts];
    return this.alerts.filter(
      (a) =>
        (range.since === undefined || a.firedAt >= range.since) &&
        (range.until === undefined || a.firedAt <= range.until),
    );
  }

  /** Resolve an alert by id. Returns true if the alert was active. */
  resolve(alertId: string): boolean {
    const a = this.alerts.find((x) => x.id === alertId);
    if (!a || a.resolvedAt !== undefined) return false;
    a.resolvedAt = Date.now();
    eventEngine.emit('ops.alert_resolved', {
      alertId: a.id,
      ruleId: a.ruleId,
      name: a.name,
      resolvedAt: a.resolvedAt,
    });
    return true;
  }

  /** Resolve all active alerts for a rule (e.g. when the rule condition clears). */
  resolveRule(ruleId: string): number {
    let n = 0;
    for (const a of this.alerts) {
      if (a.ruleId === ruleId && a.resolvedAt === undefined) {
        a.resolvedAt = Date.now();
        n += 1;
        eventEngine.emit('ops.alert_resolved', {
          alertId: a.id,
          ruleId: a.ruleId,
          name: a.name,
          resolvedAt: a.resolvedAt,
        });
      }
    }
    return n;
  }

  /** Clear all alert history (test helper). */
  reset(): void {
    this.alerts = [];
    this.lastFiredAt.clear();
    this.seq = 0;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Check whether `value` triggers `condition` against `threshold`. */
export function checkCondition(
  condition: AlertCondition,
  value: number,
  threshold: number,
): boolean {
  switch (condition) {
    case 'gt': return value > threshold;
    case 'lt': return value < threshold;
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
    case 'eq': return value === threshold;
    default: return false;
  }
}

/** Format a value for human-readable alert messages. */
function formatValue(v: number): string {
  if (Number.isInteger(v)) return v.toString();
  if (Math.abs(v) < 1) return v.toFixed(4);
  return v.toFixed(2);
}

// ─── Pre-registered rules ─────────────────────────────────────────────────────

/**
 * Compute the failure rate for a counter metric that has a `status` label.
 * Returns failed/total as a fraction in [0, 1], or null if no data.
 */
export function failureRate(
  registry: MetricsRegistry,
  metricName: string,
  failureStatuses: string[] = ['failed', 'error'],
): number | null {
  const m = registry.get(metricName);
  if (!m || m.type !== 'counter') return null;
  let total = 0;
  let failed = 0;
  for (const [key, v] of m.values.entries()) {
    if (typeof v !== 'number') continue;
    total += v;
    const labels = parseLabelKey(key);
    if (failureStatuses.includes(String(labels.status))) failed += v;
  }
  if (total === 0) return null;
  return failed / total;
}

/** Sum a counter's values, optionally filtered by a label predicate. Re-exported from ./metrics. */
export { counterSum } from './metrics';

/** Pre-registered PaySwap alert rules. */
export const STANDARD_ALERT_RULES: AlertRule[] = [
  {
    id: 'settlement_p99_high',
    name: 'Settlement p99 latency > 10s',
    metric: 'payswap_settlement_duration_ms',
    condition: 'gt',
    threshold: 10000,
    windowMs: 5 * 60_000,
    severity: 'warning',
    cooldownMs: 5 * 60_000,
    evaluate: 'p99',
    description:
      'Settlement p99 latency exceeds 10s. Indicates corridor congestion or treasury rebalancing delays.',
    labels: { team: 'settlement', runbook: 'r/settlement-p99' },
  },
  {
    id: 'connector_error_rate_high',
    name: 'Connector error rate > 5%',
    metric: '_derived',
    compute: (reg) => failureRate(reg, 'payswap_connector_requests_total', ['failed', 'error']),
    condition: 'gt',
    threshold: 0.05,
    windowMs: 5 * 60_000,
    severity: 'critical',
    cooldownMs: 5 * 60_000,
    description:
      'Connector failure rate exceeds 5%. Indicates upstream outages or auth issues.',
    labels: { team: 'connectors', runbook: 'r/connector-errors' },
  },
  {
    id: 'treasury_reserve_ratio_low',
    name: 'Treasury reserve ratio < 1.1',
    metric: 'payswap_treasury_reserve_ratio',
    condition: 'lt',
    threshold: 1.1,
    windowMs: 60_000,
    severity: 'critical',
    cooldownMs: 5 * 60_000,
    description:
      'Treasury reserve ratio below 1.1 for at least one currency. Backing at risk — investigate immediately.',
    labels: { team: 'treasury', runbook: 'r/reserve-ratio' },
  },
  {
    id: 'lp_active_count_low',
    name: 'LP active count < 3',
    metric: 'payswap_lp_active_count',
    condition: 'lt',
    threshold: 3,
    windowMs: 60_000,
    severity: 'warning',
    cooldownMs: 5 * 60_000,
    description:
      'Fewer than 3 active liquidity providers. Settlement diversity at risk.',
    labels: { team: 'liquidity', runbook: 'r/lp-count' },
  },
  {
    id: 'webhook_failure_rate_high',
    name: 'Webhook failure rate > 10%',
    metric: '_derived',
    compute: (reg) => failureRate(reg, 'payswap_webhook_deliveries_total', ['failed', 'error']),
    condition: 'gt',
    threshold: 0.1,
    windowMs: 5 * 60_000,
    severity: 'critical',
    cooldownMs: 5 * 60_000,
    description:
      'Webhook delivery failure rate exceeds 10%. Merchants are missing event notifications.',
    labels: { team: 'webhooks', runbook: 'r/webhook-failures' },
  },
];

// ─── Singleton ─────────────────────────────────────────────────────────────────

/** Singleton alert manager — pre-registered with the standard rules. */
export const alertManager = new AlertManager();

for (const rule of STANDARD_ALERT_RULES) {
  alertManager.addRule(rule);
}
