/**
 * PaySwap Protocol — Deployment — Autoscaling Policy Service.
 *
 * Owns the autoscaling policies for the three stateless PaySwap
 * workloads (API server, settlement worker, webhook dispatcher) and
 * evaluates live metrics against them to produce a scale decision:
 *   - `scale_up`   — current replicas below target, metric above
 *                    scale-up threshold.
 *   - `scale_down` — current replicas above min, metric below
 *                    scale-down threshold.
 *   - `none`       — within target band, or in cooldown.
 *
 * Cooldown: after a scaling decision, the policy refuses to issue
 * another decision for `cooldownMs`. This prevents flapping under
 * metric noise.
 *
 * Pre-configured policies (matches the task spec exactly):
 *   - `api_server`            — CPU 70%, 2-20 replicas.
 *   - `settlement_worker`     — queue depth 100, 1-10 replicas.
 *   - `webhook_dispatcher`    — consumer lag 5s, 1-5 replicas.
 *
 * The kernel is FROZEN — this module imports only `nowTs` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`. No kernel
 * files are modified.
 */
import { eventEngine } from '@/kernel/event';
import { nowTs } from '@/kernel/support';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The metric a scaling policy watches. Each maps to a field on the
 * `ScalingMetrics` input passed to `evaluate()`.
 */
export type ScalingMetric = 'cpu' | 'memory' | 'queue_depth' | 'consumer_lag' | 'rps';

/**
 * A single autoscaling policy.
 *
 *  - `metric`              — what to watch (cpu, queue_depth, etc.).
 *  - `target`              — the desired steady-state value of the metric.
 *  - `minReplicas`         — floor for scale-down.
 *  - `maxReplicas`         — ceiling for scale-up.
 *  - `scaleUpThreshold`    — metric value above which to scale up (usually
 *                            `target * 1.1` or similar).
 *  - `scaleDownThreshold`  — metric value below which to scale down (usually
 *                            `target * 0.5` or similar).
 *  - `cooldownMs`          — minimum interval between scaling decisions.
 */
export interface ScalingPolicy {
  metric: ScalingMetric;
  target: number;
  minReplicas: number;
  maxReplicas: number;
  scaleUpThreshold: number;
  scaleDownThreshold: number;
  cooldownMs: number;
}

/**
 * Live metrics for a workload, passed to `evaluate()`. Only the field
 * matching the policy's `metric` is consulted; others are ignored.
 */
export interface ScalingMetrics {
  /** CPU usage, 0..100 (percent). */
  cpu?: number;
  /** Memory usage, 0..100 (percent). */
  memory?: number;
  /** Queue depth (number of pending items). */
  queue_depth?: number;
  /** Consumer lag, in seconds. */
  consumer_lag?: number;
  /** Requests per second. */
  rps?: number;
  /** Current replica count for the workload. */
  currentReplicas: number;
}

/**
 * The output of `evaluate()` — a scaling decision (or `none`).
 */
export interface ScalingDecision {
  action: 'scale_up' | 'scale_down' | 'none';
  currentReplicas: number;
  targetReplicas: number;
  reason: string;
}

/**
 * Internal: a policy plus its last-action ts (for cooldown tracking).
 */
interface PolicyEntry {
  policy: ScalingPolicy;
  lastActionTs: number;
}

// ---------------------------------------------------------------------------
// Default policies
// ---------------------------------------------------------------------------

/**
 * Pre-configured autoscaling policies for the three stateless PaySwap
 * workloads. Matches the task spec exactly.
 */
export const DEFAULT_SCALING_POLICIES: Record<string, ScalingPolicy> = {
  /**
   * API server (Next.js) — scale on CPU.
   * Target 70%, scale up above 80%, scale down below 40%.
   * 2-20 replicas, 60s cooldown.
   */
  api_server: {
    metric: 'cpu',
    target: 70,
    minReplicas: 2,
    maxReplicas: 20,
    scaleUpThreshold: 80,
    scaleDownThreshold: 40,
    cooldownMs: 60_000,
  },

  /**
   * Settlement worker — scale on settlement queue depth.
   * Target 100 pending items, scale up above 150, scale down below 50.
   * 1-10 replicas, 90s cooldown.
   */
  settlement_worker: {
    metric: 'queue_depth',
    target: 100,
    minReplicas: 1,
    maxReplicas: 10,
    scaleUpThreshold: 150,
    scaleDownThreshold: 50,
    cooldownMs: 90_000,
  },

  /**
   * Webhook dispatcher — scale on consumer lag (seconds behind the
   * event stream head). Target 5s, scale up above 10s, scale down
   * below 2s. 1-5 replicas, 60s cooldown.
   */
  webhook_dispatcher: {
    metric: 'consumer_lag',
    target: 5,
    minReplicas: 1,
    maxReplicas: 5,
    scaleUpThreshold: 10,
    scaleDownThreshold: 2,
    cooldownMs: 60_000,
  },
};

// ---------------------------------------------------------------------------
// AutoscalingService
// ---------------------------------------------------------------------------

/**
 * Autoscaling service. Owns the policy map and exposes `setPolicy` and
 * `evaluate`. Decisions are logged as `autoscaling.decision` events on
 * the kernel `eventEngine` (excluding `none` decisions during cooldown,
 * which are silent).
 */
export class AutoscalingService {
  private policies = new Map<string, PolicyEntry>();

  constructor() {
    for (const [name, policy] of Object.entries(DEFAULT_SCALING_POLICIES)) {
      this.policies.set(name, { policy: { ...policy }, lastActionTs: 0 });
    }
  }

  /**
   * Set (create or replace) a policy. Emits `autoscaling.policy_set`.
   */
  setPolicy(name: string, policy: ScalingPolicy): ScalingPolicy {
    const existing = this.policies.get(name);
    const entry: PolicyEntry = {
      policy: { ...policy },
      lastActionTs: existing?.lastActionTs ?? 0,
    };
    this.policies.set(name, entry);
    eventEngine.emit('autoscaling.policy_set', { name, policy });
    return { ...policy };
  }

  /**
   * Evaluate the live metrics for a workload against its policy.
   *
   * Decision logic:
   *   1. If no policy → `none` with reason `policy_not_found`.
   *   2. If the metric value is missing → `none` with reason `metric_missing`.
   *   3. If within cooldown since the last action → `none` with
   *      reason `cooldown`.
   *   4. If metric >= scaleUpThreshold AND currentReplicas < maxReplicas
   *      → `scale_up` (target = min(currentReplicas + ceil(delta), maxReplicas)).
   *   5. If metric <= scaleDownThreshold AND currentReplicas > minReplicas
   *      → `scale_down` (target = max(currentReplicas - 1, minReplicas)).
   *   6. Otherwise → `none` with reason `within_target`.
   *
   * Scaling-up is aggressive (doubles or adds ceil(delta) replicas,
   * capped at max); scaling-down is conservative (one replica at a
   * time). This matches Kubernetes HPA default behaviour.
   */
  evaluate(name: string, metrics: ScalingMetrics): ScalingDecision {
    const entry = this.policies.get(name);
    if (!entry) {
      return {
        action: 'none',
        currentReplicas: metrics.currentReplicas,
        targetReplicas: metrics.currentReplicas,
        reason: `policy_not_found: no policy named '${name}'`,
      };
    }

    const { policy, lastActionTs } = entry;
    const current = metrics.currentReplicas;
    const metricValue = metrics[policy.metric];

    if (metricValue === undefined || metricValue === null) {
      return {
        action: 'none',
        currentReplicas: current,
        targetReplicas: current,
        reason: `metric_missing: '${policy.metric}' not provided`,
      };
    }

    // Cooldown check.
    const sinceLast = nowTs() - lastActionTs;
    if (lastActionTs > 0 && sinceLast < policy.cooldownMs) {
      return {
        action: 'none',
        currentReplicas: current,
        targetReplicas: current,
        reason: `cooldown: ${policy.cooldownMs - sinceLast}ms remaining`,
      };
    }

    // Scale up.
    if (metricValue >= policy.scaleUpThreshold && current < policy.maxReplicas) {
      // Aggressive: aim to bring the metric back to target. For CPU,
      // delta = ceil(current * (metric / target) - current). For others,
      // add 1 replica. Capped at maxReplicas.
      const ratio = policy.target > 0 ? metricValue / policy.target : 1;
      const desired = Math.ceil(current * Math.max(ratio, 1.5));
      const target = Math.min(desired, policy.maxReplicas);
      const decision: ScalingDecision = {
        action: 'scale_up',
        currentReplicas: current,
        targetReplicas: target,
        reason: `${policy.metric}=${metricValue} >= ${policy.scaleUpThreshold} (target ${policy.target})`,
      };
      this.recordDecision(name, decision);
      return decision;
    }

    // Scale down.
    if (metricValue <= policy.scaleDownThreshold && current > policy.minReplicas) {
      // Conservative: shed one replica at a time.
      const target = Math.max(current - 1, policy.minReplicas);
      const decision: ScalingDecision = {
        action: 'scale_down',
        currentReplicas: current,
        targetReplicas: target,
        reason: `${policy.metric}=${metricValue} <= ${policy.scaleDownThreshold} (target ${policy.target})`,
      };
      this.recordDecision(name, decision);
      return decision;
    }

    // Within target band.
    return {
      action: 'none',
      currentReplicas: current,
      targetReplicas: current,
      reason: `within_target: ${policy.metric}=${metricValue} in [${policy.scaleDownThreshold}, ${policy.scaleUpThreshold}]`,
    };
  }

  /** Record a non-`none` decision — updates cooldown ts + emits event. */
  private recordDecision(name: string, decision: ScalingDecision): void {
    const entry = this.policies.get(name);
    if (entry) {
      entry.lastActionTs = nowTs();
    }
    eventEngine.emit('autoscaling.decision', { name, ...decision });
  }

  /**
   * Snapshot all policies (defensive copy).
   */
  getPolicies(): Record<string, ScalingPolicy> {
    const out: Record<string, ScalingPolicy> = {};
    for (const [name, entry] of this.policies) {
      out[name] = { ...entry.policy };
    }
    return out;
  }

  /** Get a single policy by name (or null). */
  getPolicy(name: string): ScalingPolicy | null {
    const entry = this.policies.get(name);
    return entry ? { ...entry.policy } : null;
  }

  /** Remove a policy. */
  removePolicy(name: string): boolean {
    return this.policies.delete(name);
  }

  /** Reset to the default policies. */
  reset(): void {
    this.policies.clear();
    for (const [name, policy] of Object.entries(DEFAULT_SCALING_POLICIES)) {
      this.policies.set(name, { policy: { ...policy }, lastActionTs: 0 });
    }
    eventEngine.emit('autoscaling.reset', { count: this.policies.size });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForAutoscaling = globalThis as unknown as {
  __PAYSWAP_AUTOSCALING?: AutoscalingService;
};

export const autoscalingService =
  _globalForAutoscaling.__PAYSWAP_AUTOSCALING ?? new AutoscalingService();

if (!_globalForAutoscaling.__PAYSWAP_AUTOSCALING) {
  _globalForAutoscaling.__PAYSWAP_AUTOSCALING = autoscalingService;
}
