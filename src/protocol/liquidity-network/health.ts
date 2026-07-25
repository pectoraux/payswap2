/**
 * LP Health Monitoring — rolling-window per-LP health tracking.
 *
 * Healthy definition (invariant): consecutiveFailures < 3 AND windowed success
 * rate > 0.8. Routing avoids unhealthy LPs (the routing layer checks
 * `getHealth().healthy` before including an LP in a route).
 *
 * Health is fed by `recordSettlement` / `recordFailure` / `recordRecovery`
 * calls — these come from the network's `settleRoute` method, which is in turn
 * called by the settlement orchestrator with REAL settlement outcomes (events
 * from the kernel's eventEngine). So health is derived from real settlement
 * outcomes, not static numbers.
 */
import { eventEngine } from '@/kernel/event';
import {
  DEFAULT_HEALTH_WINDOW,
  UNHEALTHY_CONSECUTIVE_FAILURES,
  UNHEALTHY_SUCCESS_RATE_THRESHOLD,
  type LPHealth,
  type LPId,
} from './types';

interface HealthState {
  /** Ring buffer of last N settlement outcomes (true = success). */
  window: boolean[];
  /** Sum of window (for O(1) success rate). */
  successes: number;
  consecutiveFailures: number;
  lastFailureTs: number | null;
  /** Rolling average latency (ms) — weighted by recency. */
  latencyMs: number;
  lastUpdated: number;
}

export class LPHealthMonitor {
  private states: Map<LPId, HealthState> = new Map();
  private windowSize: number;

  constructor(windowSize: number = DEFAULT_HEALTH_WINDOW) {
    this.windowSize = windowSize;
  }

  private ensure(lpId: LPId): HealthState {
    let s = this.states.get(lpId);
    if (!s) {
      s = {
        window: [],
        successes: 0,
        consecutiveFailures: 0,
        lastFailureTs: null,
        latencyMs: 0,
        lastUpdated: Date.now(),
      };
      this.states.set(lpId, s);
    }
    return s;
  }

  /**
   * Record a settlement outcome — pushes into the rolling window and updates
   * consecutive failures / latency.
   */
  recordSettlement(lpId: LPId, success: boolean, latencyMs: number): void {
    const s = this.ensure(lpId);
    // Push into window (drop oldest if at capacity).
    if (s.window.length >= this.windowSize) {
      const dropped = s.window.shift();
      if (dropped) s.successes -= 1;
    }
    s.window.push(success);
    if (success) s.successes += 1;

    if (success) {
      s.consecutiveFailures = 0;
    } else {
      s.consecutiveFailures += 1;
      s.lastFailureTs = Date.now();
    }

    // Exponentially-weighted moving average latency (so recent settlements
    // weigh more). α = 0.2.
    const alpha = 0.2;
    s.latencyMs = s.latencyMs === 0
      ? latencyMs
      : Math.round(s.latencyMs * (1 - alpha) + latencyMs * alpha);

    s.lastUpdated = Date.now();

    eventEngine.emit('liquidity.lp_health_updated', {
      lpId,
      success,
      latencyMs,
      successRateWindowed: this.windowedSuccessRate(s),
      consecutiveFailures: s.consecutiveFailures,
    }, 0);
  }

  /** Increment consecutive failures (without a settlement outcome). */
  recordFailure(lpId: LPId): void {
    const s = this.ensure(lpId);
    s.consecutiveFailures += 1;
    s.lastFailureTs = Date.now();
    s.lastUpdated = Date.now();
    // Also push a failure into the window so the success rate drops.
    if (s.window.length >= this.windowSize) {
      const dropped = s.window.shift();
      if (dropped) s.successes -= 1;
    }
    s.window.push(false);

    eventEngine.emit('liquidity.lp_health_updated', {
      lpId,
      success: false,
      successRateWindowed: this.windowedSuccessRate(s),
      consecutiveFailures: s.consecutiveFailures,
    }, 0);
  }

  /** Reset consecutive failures (without an explicit success outcome). */
  recordRecovery(lpId: LPId): void {
    const s = this.ensure(lpId);
    s.consecutiveFailures = 0;
    s.lastUpdated = Date.now();
  }

  private windowedSuccessRate(s: HealthState): number {
    if (s.window.length === 0) return 1.0; // no data → assume healthy
    return s.successes / s.window.length;
  }

  /** Get a health snapshot for an LP. */
  getHealth(lpId: LPId): LPHealth {
    const s = this.ensure(lpId);
    const successRate = this.windowedSuccessRate(s);
    const healthy = s.consecutiveFailures < UNHEALTHY_CONSECUTIVE_FAILURES
      && successRate > UNHEALTHY_SUCCESS_RATE_THRESHOLD;
    // Composite 0..1 score: successRate × (1 − consecutiveFailurePenalty).
    const failurePenalty = Math.min(1, s.consecutiveFailures / UNHEALTHY_CONSECUTIVE_FAILURES);
    const score = successRate * (1 - failurePenalty);
    return {
      lpId,
      healthy,
      latencyMs: s.latencyMs,
      successRateWindowed: successRate,
      consecutiveFailures: s.consecutiveFailures,
      lastFailureTs: s.lastFailureTs,
      score: Math.max(0, Math.min(1, score)),
    };
  }

  /** All health snapshots. */
  all(): LPHealth[] {
    return [...this.states.keys()].map((id) => this.getHealth(id));
  }

  /**
   * Start a periodic health probe. `checkFn` is called for each known LP at
   * the given interval — the caller can use this to actively probe LPs (e.g.
   * ping their settlement endpoint) and call `recordSettlement` /
   * `recordFailure` based on the probe result. Returns a stop function.
   */
  startPeriodic(checkFn: (lpId: LPId) => void, intervalMs: number): () => void {
    const handle = setInterval(() => {
      for (const lpId of this.states.keys()) {
        try {
          checkFn(lpId);
        } catch {
          // Probe failure — record as a failure.
          this.recordFailure(lpId);
        }
      }
    }, intervalMs);
    return () => clearInterval(handle);
  }

  /** Clear all health state (test helper). */
  reset(): void {
    this.states.clear();
  }
}

/** Singleton health monitor. */
export const lpHealthMonitor = new LPHealthMonitor();
