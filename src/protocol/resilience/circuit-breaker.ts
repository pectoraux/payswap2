/**
 * PaySwap Protocol — Resilience / Circuit Breakers.
 * -----------------------------------------------------------------------------
 * Wraps connector and service calls in a circuit breaker that:
 *
 *   1. Tracks failures in a SLIDING WINDOW (failureWindowMs). When the number
 *      of failures in the window crosses `failureThreshold`, the circuit trips
 *      to `open`.
 *   2. In `open` state, `execute()` rejects IMMEDIATELY with `CircuitOpenError`
 *      — no upstream call is made. This protects an overloaded upstream from
 *      further load and gives it time to recover (cooldownMs).
 *   3. After `cooldownMs` elapses, the circuit transitions to `half_open` and
 *      allows a LIMITED number of trial requests (`halfOpenMaxRequests`).
 *      If `successThresholdToClose` consecutive successes are observed, the
 *      circuit returns to `closed`. If any trial fails, it trips back to
 *      `open` and the cooldown restarts.
 *
 * The breaker is a pure protocol-layer construct — it has no direct dependency
 * on the kernel. It emits `resilience.circuit_*` events on the kernel event
 * bus so ops/alerts can react.
 *
 * The registry pre-configures one breaker per production connector
 * (`open_banking`, `mpesa`, `ethereum_rpc`, `fx_rate`, `stellar_horizon`)
 * plus `stellar_settlement` (settlement-engine calls) and `db` (database
 * writes). Default policy: 5 failures in 60s → open, 30s cooldown.
 *
 * INVARIANTS:
 *   - A breaker in `open` state NEVER makes an upstream call.
 *   - A breaker in `half_open` allows AT MOST `halfOpenMaxRequests` concurrent
 *     trial calls; a single failure re-trips to `open`.
 *   - State transitions emit a kernel event (`resilience.circuit_open`,
 *     `resilience.circuit_half_open`, `resilience.circuit_closed`).
 */
import { eventEngine } from '@/kernel/event';

/** Tri-state breaker state machine. */
export type CircuitState = 'closed' | 'open' | 'half_open';

/** Error thrown when `execute()` is called against an open circuit. */
export class CircuitOpenError extends Error {
  readonly breakerName: string;
  readonly state: CircuitState;
  constructor(breakerName: string) {
    super(`Circuit '${breakerName}' is OPEN — rejecting call without upstream attempt`);
    this.name = 'CircuitOpenError';
    this.breakerName = breakerName;
    this.state = 'open';
  }
}

/** Constructor options for a CircuitBreaker. */
export interface CircuitBreakerOptions {
  /** Breaker name — used in events, logs, and registry lookups. */
  name: string;
  /** Number of failures within `failureWindowMs` to trip the circuit open. */
  failureThreshold: number;
  /** Sliding window length (ms) for failure counting. */
  failureWindowMs: number;
  /** How long the breaker stays `open` before transitioning to `half_open`. */
  cooldownMs: number;
  /** Max concurrent trial requests allowed in `half_open` state. */
  halfOpenMaxRequests: number;
  /** Consecutive successes in `half_open` required to close the circuit. */
  successThresholdToClose: number;
}

/** Metrics snapshot returned by `metrics()`. */
export interface CircuitBreakerMetrics {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  rejections: number;
  trips: number;
  lastStateChangeTs: number;
  lastFailureTs?: number;
  /** Number of failures currently inside the sliding window. */
  windowFailureCount: number;
  /** In-flight half-open trial requests. */
  halfOpenInFlight: number;
  /** Consecutive successes in the current state (resets to 0 on failure). */
  consecutiveSuccesses: number;
}

interface FailureRecord {
  ts: number;
}

/**
 * Circuit breaker implementation.
 *
 * State transitions:
 *
 *   closed    → open       (failures in window ≥ threshold)
 *   open      → half_open  (cooldownMs elapsed)
 *   half_open → open       (any trial failure)
 *   half_open → closed     (successThresholdToClose consecutive successes)
 *
 * Threading: all state mutation is synchronous; safe for single-threaded
 * Node.js. For concurrent callers in `half_open`, the `halfOpenInFlight`
 * counter enforces the trial-request cap.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures: FailureRecord[] = [];
  private successes = 0;
  private rejections = 0;
  private trips = 0;
  private lastStateChangeTs: number;
  private lastFailureTs?: number;
  private openedAt: number | undefined;
  private halfOpenInFlight = 0;
  private consecutiveSuccesses = 0;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.lastStateChangeTs = Date.now();
  }

  /** Current state of the breaker. */
  getState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  /** Alias for `getState()` — shorter for dashboards. */
  state(): CircuitState {
    return this.getState();
  }

  /** Metrics snapshot. */
  metrics(): CircuitBreakerMetrics {
    this.maybeTransitionToHalfOpen();
    const now = Date.now();
    const windowFailures = this.failures.filter((f) => now - f.ts <= this.opts.failureWindowMs);
    return {
      name: this.opts.name,
      state: this.state,
      failures: this.failures.length,
      successes: this.successes,
      rejections: this.rejections,
      trips: this.trips,
      lastStateChangeTs: this.lastStateChangeTs,
      lastFailureTs: this.lastFailureTs,
      windowFailureCount: windowFailures.length,
      halfOpenInFlight: this.halfOpenInFlight,
      consecutiveSuccesses: this.consecutiveSuccesses,
    };
  }

  /**
   * Execute `fn` through the breaker.
   *
   *   - If `open`, reject immediately with `CircuitOpenError` (no upstream call).
   *   - If `half_open` and `halfOpenInFlight >= halfOpenMaxRequests`, reject
   *     with `CircuitOpenError` (rate-limited trial).
   *   - Otherwise, invoke `fn`. On success, update success counters; on
   *     failure, record + possibly trip.
   *
   * The breaker treats a THROWN error or a REJECTED promise from `fn` as a
   * failure. A resolved value (including `undefined`) is a success.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransitionToHalfOpen();

    if (this.state === 'open') {
      this.rejections++;
      throw new CircuitOpenError(this.opts.name);
    }

    if (this.state === 'half_open') {
      if (this.halfOpenInFlight >= this.opts.halfOpenMaxRequests) {
        this.rejections++;
        throw new CircuitOpenError(this.opts.name);
      }
      this.halfOpenInFlight++;
      try {
        const result = await fn();
        this.recordSuccess();
        return result;
      } catch (err) {
        this.recordFailure();
        throw err;
      } finally {
        this.halfOpenInFlight--;
      }
    }

    // closed
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  /** Reset the breaker to `closed` (clears all counters). Mainly for tests. */
  reset(): void {
    this.setState('closed');
    this.failures = [];
    this.successes = 0;
    this.rejections = 0;
    this.trips = 0;
    this.consecutiveSuccesses = 0;
    this.halfOpenInFlight = 0;
    this.openedAt = undefined;
    this.lastFailureTs = undefined;
  }

  // ─── internal ────────────────────────────────────────────────────────────

  private maybeTransitionToHalfOpen(): void {
    if (this.state !== 'open') return;
    if (this.openedAt == null) return;
    if (Date.now() - this.openedAt >= this.opts.cooldownMs) {
      this.setState('half_open');
      this.consecutiveSuccesses = 0;
      this.halfOpenInFlight = 0;
    }
  }

  private recordSuccess(): void {
    this.successes++;
    this.consecutiveSuccesses++;
    if (this.state === 'half_open') {
      if (this.consecutiveSuccesses >= this.opts.successThresholdToClose) {
        this.setState('closed');
        // Clear the failure window on close — give the upstream a fresh start.
        this.failures = [];
      }
    }
  }

  private recordFailure(): void {
    const now = Date.now();
    this.failures.push({ ts: now });
    this.lastFailureTs = now;
    this.consecutiveSuccesses = 0;
    // Prune the sliding window.
    this.failures = this.failures.filter(
      (f) => now - f.ts <= this.opts.failureWindowMs,
    );

    if (this.state === 'half_open') {
      // A single failure in half-open trips back to open.
      this.tripOpen();
      return;
    }

    if (this.state === 'closed' && this.failures.length >= this.opts.failureThreshold) {
      this.tripOpen();
    }
  }

  private tripOpen(): void {
    this.trips++;
    this.setState('open');
    this.openedAt = Date.now();
  }

  private setState(newState: CircuitState): void {
    if (this.state === newState) return;
    this.state = newState;
    this.lastStateChangeTs = Date.now();
    const eventType =
      newState === 'open'
        ? 'resilience.circuit_open'
        : newState === 'half_open'
          ? 'resilience.circuit_half_open'
          : 'resilience.circuit_closed';
    try {
      eventEngine.emit(
        eventType,
        {
          breaker: this.opts.name,
          state: newState,
          ts: this.lastStateChangeTs,
          metrics: this.metrics(),
        },
        0,
      );
    } catch {
      // Event engine failures must never crash the breaker.
    }
  }
}

/**
 * Registry of named circuit breakers. Provides a single source of truth for
 * "is the X connector currently open?" — used by the outage manager, the
 * health check, and the dashboard.
 */
export class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();

  /** Register a breaker (replaces any existing breaker with the same name). */
  register(breaker: CircuitBreaker): CircuitBreaker {
    this.breakers.set(breaker.metrics().name, breaker);
    return breaker;
  }

  /** Convenience: create + register in one call. */
  create(opts: CircuitBreakerOptions): CircuitBreaker {
    const breaker = new CircuitBreaker(opts);
    return this.register(breaker);
  }

  /** Fetch a breaker by name. Returns undefined if not registered. */
  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  /** All registered breakers. */
  all(): CircuitBreaker[] {
    return [...this.breakers.values()];
  }

  /** All registered breaker names. */
  names(): string[] {
    return [...this.breakers.keys()];
  }

  /** Quick state lookup. Returns `closed` if the breaker isn't registered. */
  stateOf(name: string): CircuitState {
    return this.breakers.get(name)?.getState() ?? 'closed';
  }

  /** Quick "is open?" check. */
  isOpen(name: string): boolean {
    return this.stateOf(name) === 'open';
  }

  /** Metrics for every breaker (for dashboards). */
  metricsAll(): CircuitBreakerMetrics[] {
    return this.all().map((b) => b.metrics());
  }

  /** Reset every breaker (mainly for tests). */
  resetAll(): void {
    for (const b of this.breakers.values()) b.reset();
  }
}

/** Default policy: 5 failures in 60s → open, 30s cooldown, 1 trial request. */
export const DEFAULT_BREAKER_POLICY: Omit<CircuitBreakerOptions, 'name'> = {
  failureThreshold: 5,
  failureWindowMs: 60_000,
  cooldownMs: 30_000,
  halfOpenMaxRequests: 1,
  successThresholdToClose: 2,
};

/** Breaker names for every production connector + the settlement engine + db. */
export const BREAKER_NAMES = [
  'open_banking',
  'mpesa',
  'ethereum_rpc',
  'fx_rate',
  'stellar_horizon',
  'stellar_settlement',
  'db',
] as const;

/** Singleton registry — pre-configured with all 7 breakers. */
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

// Pre-register the 7 breakers with the default policy.
for (const name of BREAKER_NAMES) {
  circuitBreakerRegistry.create({ name, ...DEFAULT_BREAKER_POLICY });
}
