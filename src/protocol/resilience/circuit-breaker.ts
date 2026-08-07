/**
 * PaySwap Protocol — Resilience — Circuit Breaker.
 *
 * Wraps external protocol calls (open banking, M-Pesa, FX rate feeds, Stellar
 * Horizon, Ethereum RPC, DB) in a circuit breaker that:
 *   - rejects calls immediately when OPEN (fail-fast),
 *   - tracks failures within a sliding time window,
 *   - trips to OPEN after `failureThreshold` failures in `failureWindowMs`,
 *   - moves to HALF_OPEN after `cooldownMs`,
 *   - closes again after `successThresholdToClose` consecutive successes.
 *
 * The kernel is FROZEN — this module imports only from `@/kernel/event`,
 * `@/kernel/support`, and `@/kernel/types`. No writes to `src/kernel/`.
 */
import { eventEngine } from '@/kernel/event';
import { nowTs } from '@/kernel/support';

/** Circuit states. `half_open` is the trial period after a cooldown. */
export type CircuitState = 'closed' | 'open' | 'half_open';

/** Tunable construction parameters for a breaker. */
export interface CircuitBreakerOptions {
  name: string;
  /** Number of failures within `failureWindowMs` that trips the breaker. */
  failureThreshold: number;
  /** Sliding window length (ms) used to count recent failures. */
  failureWindowMs: number;
  /** Time the breaker stays OPEN before transitioning to HALF_OPEN. */
  cooldownMs: number;
  /** Consecutive successes required in HALF_OPEN to transition to CLOSED. */
  successThresholdToClose: number;
}

/** Error thrown when an `execute` call is rejected because the breaker is OPEN. */
export class CircuitOpenError extends Error {
  readonly breakerName: string;
  readonly state: CircuitState;

  constructor(breakerName: string) {
    super(`Circuit breaker "${breakerName}" is OPEN — failing fast`);
    this.name = 'CircuitOpenError';
    this.breakerName = breakerName;
    this.state = 'open';
  }
}

/** Per-breaker runtime metrics. */
export interface CircuitBreakerMetrics {
  name: string;
  state: CircuitState;
  /** Failures currently within the sliding window. */
  recentFailures: number;
  /** Total failures observed by this breaker since construction. */
  totalFailures: number;
  /** Total successful executions since construction. */
  totalSuccesses: number;
  /** Total calls rejected because the breaker was OPEN. */
  totalRejected: number;
  /** Total times the breaker tripped CLOSED -> OPEN. */
  totalTrips: number;
  /** Total times the breaker transitioned OPEN -> CLOSED (via HALF_OPEN). */
  totalRecoveries: number;
  /** ts of the most recent failure, or null. */
  lastFailureTs: number | null;
  /** ts the breaker most recently transitioned to OPEN, or null. */
  openedAt: number | null;
  /** Consecutive successes accumulated in HALF_OPEN. */
  consecutiveHalfOpenSuccesses: number;
}

/**
 * A single circuit breaker.
 *
 * Thread-safety / re-entrancy note: this is a single-process in-memory
 * runtime — calls are serialised by the Node.js event loop, so the
 * half-open success counter does not need atomic primitives.
 */
export class CircuitBreaker {
  private _state: CircuitState = 'closed';
  private readonly failureTimestamps: number[] = [];
  private openedAt: number | null = null;
  private lastFailureTs: number | null = null;
  private consecutiveHalfOpenSuccesses = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private totalRejected = 0;
  private totalTrips = 0;
  private totalRecoveries = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  // ----------------------------------------------------------------- execute
  /**
   * Run `fn` under the breaker. Behaviour by state:
   *
   *   closed    — always invoke `fn`; on success reset half-open counter,
   *               on failure record + possibly trip.
   *   open      — reject immediately with `CircuitOpenError` (fail-fast).
   *               If the cooldown has elapsed, transition to HALF_OPEN and
   *               allow a single trial call.
   *   half_open — invoke `fn`; on success increment the success counter
   *               and close after the threshold; on failure re-trip to OPEN.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // If OPEN, either fail fast or transition to HALF_OPEN if cooled down.
    if (this._state === 'open') {
      if (this.cooledDown()) {
        this.transitionTo('half_open');
      } else {
        this.totalRejected += 1;
        throw new CircuitOpenError(this.options.name);
      }
    }

    try {
      const value = await fn();
      this.onSuccess();
      return value;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  // ------------------------------------------------------------------- state
  /** Current breaker state. Transitions to HALF_OPEN if cooldown elapsed. */
  state(): CircuitState {
    if (this._state === 'open' && this.cooledDown()) {
      // Lazy transition so a state read between executes still reflects reality.
      this.transitionTo('half_open');
    }
    return this._state;
  }

  /** Alias for state() (test compatibility). */
  getState(): CircuitState {
    return this.state();
  }

  /** Snapshot of runtime metrics. */
  metrics(): CircuitBreakerMetrics {
    return {
      name: this.options.name,
      state: this.state(),
      recentFailures: this.recentFailuresInWindow(),
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      totalRejected: this.totalRejected,
      totalTrips: this.totalTrips,
      totalRecoveries: this.totalRecoveries,
      lastFailureTs: this.lastFailureTs,
      openedAt: this.openedAt,
      consecutiveHalfOpenSuccesses: this.consecutiveHalfOpenSuccesses,
    };
  }

  /** Force the breaker back to CLOSED (e.g. an admin override). */
  reset(): void {
    this.transitionTo('closed');
    this.failureTimestamps.length = 0;
    this.consecutiveHalfOpenSuccesses = 0;
  }

  // --------------------------------------------------------------- internals
  private onSuccess(): void {
    this.totalSuccesses += 1;
    if (this._state === 'half_open') {
      this.consecutiveHalfOpenSuccesses += 1;
      if (this.consecutiveHalfOpenSuccesses >= this.options.successThresholdToClose) {
        this.transitionTo('closed');
      }
    } else if (this._state === 'closed') {
      // A success in CLOSED clears the half-open counter for the next trip.
      this.consecutiveHalfOpenSuccesses = 0;
    }
  }

  private onFailure(): void {
    const ts = nowTs();
    this.lastFailureTs = ts;
    this.totalFailures += 1;
    this.failureTimestamps.push(ts);
    this.trimFailuresToWindow(ts);

    if (this._state === 'half_open') {
      // A single failure during a trial re-trips the breaker.
      this.consecutiveHalfOpenSuccesses = 0;
      this.transitionTo('open');
      return;
    }

    if (this._state === 'closed' && this.recentFailuresInWindow() >= this.options.failureThreshold) {
      this.transitionTo('open');
    }
  }

  /** True if the cooldown has elapsed since the breaker opened. */
  private cooledDown(): boolean {
    if (this.openedAt === null) return false;
    return nowTs() - this.openedAt >= this.options.cooldownMs;
  }

  /** Number of failures still inside the sliding window. */
  private recentFailuresInWindow(): number {
    this.trimFailuresToWindow(nowTs());
    return this.failureTimestamps.length;
  }

  /** Drop failure timestamps older than the window. */
  private trimFailuresToWindow(now: number): void {
    const cutoff = now - this.options.failureWindowMs;
    while (this.failureTimestamps.length > 0 && this.failureTimestamps[0] < cutoff) {
      this.failureTimestamps.shift();
    }
  }

  private transitionTo(next: CircuitState): void {
    if (this._state === next) return;
    const previous = this._state;
    this._state = next;

    if (next === 'open') {
      this.openedAt = nowTs();
      this.totalTrips += 1;
      this.consecutiveHalfOpenSuccesses = 0;
      eventEngine.emit('resilience.circuit_open', {
        breaker: this.options.name,
        previous,
        openedAt: this.openedAt,
        recentFailures: this.recentFailuresInWindow(),
      });
    } else if (next === 'closed') {
      const wasRecovery = previous === 'half_open' || previous === 'open';
      this.openedAt = null;
      this.consecutiveHalfOpenSuccesses = 0;
      if (wasRecovery) {
        this.totalRecoveries += 1;
        eventEngine.emit('resilience.circuit_closed', {
          breaker: this.options.name,
          previous,
          closedAt: nowTs(),
        });
      }
    } else if (next === 'half_open') {
      // Entering a trial period — keep the openedAt timestamp so callers can
      // see when the original trip happened.
      this.consecutiveHalfOpenSuccesses = 0;
    }
  }
}

// ============================================================================
// Registry
// ============================================================================

/** Construction options for the pre-registered breakers. */
export const DEFAULT_BREAKER_POLICY: Omit<CircuitBreakerOptions, 'name'> = {
  failureThreshold: 5,
  failureWindowMs: 60_000,
  cooldownMs: 30_000,
  successThresholdToClose: 2,
};

/** Breaker names pre-registered for PaySwap protocol rails. */
export const DEFAULT_BREAKER_NAMES = [
  'open_banking',
  'mpesa',
  'fx_rate',
  'stellar_horizon',
  'ethereum_rpc',
  'db',
] as const;

/** A registry of named circuit breakers used across the protocol layer. */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  /** Register a breaker under `name`. Overwrites existing registrations. */
  register(name: string, breaker: CircuitBreaker): CircuitBreaker {
    this.breakers.set(name, breaker);
    return breaker;
  }

  /** Look up a breaker by name. Returns undefined if unregistered. */
  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  /** All registered breakers (insertion order). */
  all(): CircuitBreaker[] {
    return [...this.breakers.values()];
  }

  /** All registered breaker names (test compatibility). */
  names(): string[] {
    return [...this.breakers.keys()];
  }

  /** Snapshot of every breaker's state. */
  states(): { name: string; state: CircuitState }[] {
    return [...this.breakers.entries()].map(([name, b]) => ({ name, state: b.state() }));
  }

  /** State of a single breaker, or undefined if it does not exist. */
  stateOf(name: string): CircuitState | undefined {
    return this.breakers.get(name)?.state();
  }

  /** Run `fn` under the breaker registered under `name`. */
  async execute<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const breaker = this.breakers.get(name);
    if (!breaker) {
      throw new Error(`No circuit breaker registered for "${name}"`);
    }
    return breaker.execute(fn);
  }

  /** Snapshot metrics for every registered breaker. */
  metrics(): CircuitBreakerMetrics[] {
    return [...this.breakers.values()].map((b) => b.metrics());
  }

  /** Number of registered breakers. */
  size(): number {
    return this.breakers.size;
  }

  /** Reset every breaker to closed state (for tests). */
  resetAll(): void {
    for (const b of this.breakers.values()) {
      b.reset();
    }
  }
}

/**
 * Build the default singleton registry with the six pre-registered breakers.
 * Each uses the standard policy: 5 failures / 60s window → OPEN, 30s cooldown,
 * close after 2 consecutive successes.
 */
export function buildDefaultCircuitBreakerRegistry(): CircuitBreakerRegistry {
  const registry = new CircuitBreakerRegistry();
  for (const name of DEFAULT_BREAKER_NAMES) {
    registry.register(
      name,
      new CircuitBreaker({ name, ...DEFAULT_BREAKER_POLICY }),
    );
  }
  return registry;
}

// Global singleton — survives Next.js dev module re-instantiation.
const _globalForBreakers =
  globalThis as unknown as { __PAYSWAP_CIRCUIT_REGISTRY?: CircuitBreakerRegistry };
export const circuitBreakerRegistry: CircuitBreakerRegistry =
  _globalForBreakers.__PAYSWAP_CIRCUIT_REGISTRY ?? buildDefaultCircuitBreakerRegistry();
if (!_globalForBreakers.__PAYSWAP_CIRCUIT_REGISTRY) {
  _globalForBreakers.__PAYSWAP_CIRCUIT_REGISTRY = circuitBreakerRegistry;
}
