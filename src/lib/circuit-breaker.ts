/**
 * Circuit Breaker — protects external service calls from cascading failures. (L-3.)
 *
 * When an external service (bank API, blockchain, KYC provider, etc.) is
 * failing, the circuit breaker "opens" — subsequent calls fail fast instead
 * of waiting for timeouts. After a cooldown period, it "half-opens" to test
 * if the service has recovered.
 *
 * States:
 *   CLOSED    — normal operation, calls go through
 *   OPEN      — service is failing, calls fail fast immediately
 *   HALF_OPEN — testing if service has recovered (limited calls allowed)
 *
 * Usage:
 *   const breaker = new CircuitBreaker('stellar-api', {
 *     failureThreshold: 5,
 *     cooldownMs: 30_000,
 *     timeoutMs: 10_000,
 *   });
 *
 *   const result = await breaker.call(async () => {
 *     return await fetch('https://horizon.stellar.org/...');
 *   });
 */

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening. Default: 5 */
  failureThreshold: number;
  /** Time to wait before half-opening (ms). Default: 30s */
  cooldownMs: number;
  /** Call timeout (ms). Default: 10s */
  timeoutMs: number;
  /** Successes needed in half-open to close. Default: 3 */
  halfOpenSuccessThreshold: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 30_000,
  timeoutMs: 10_000,
  halfOpenSuccessThreshold: 3,
};

interface CircuitBreakerStats {
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
}

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureAt: number | undefined;
  private lastSuccessAt: number | undefined;
  private totalCalls = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private openedAt: number | undefined;

  constructor(
    public readonly name: string,
    private config: Partial<CircuitBreakerConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a function with circuit breaker protection.
   * Throws immediately if the circuit is open.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    this.checkState();

    if (this.state === 'OPEN') {
      throw new CircuitBreakerOpenError(this.name, this.openedAt!);
    }

    this.totalCalls++;

    try {
      const result = await this.withTimeout(fn);
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /**
   * Check if enough time has passed to transition from OPEN to HALF_OPEN.
   */
  private checkState(): void {
    if (this.state === 'OPEN' && this.openedAt) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= (this.config as CircuitBreakerConfig).cooldownMs) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
      }
    }
  }

  private onSuccess(): void {
    this.totalSuccesses++;
    this.lastSuccessAt = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= (this.config as CircuitBreakerConfig).halfOpenSuccessThreshold) {
        this.state = 'CLOSED';
        this.failureCount = 0;
      }
    } else if (this.state === 'CLOSED') {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.totalFailures++;
    this.lastFailureAt = Date.now();
    this.failureCount++;

    if (this.state === 'HALF_OPEN') {
      // Service hasn't recovered — reopen
      this.state = 'OPEN';
      this.openedAt = Date.now();
    } else if (this.state === 'CLOSED' && this.failureCount >= (this.config as CircuitBreakerConfig).failureThreshold) {
      // Too many failures — open the circuit
      this.state = 'OPEN';
      this.openedAt = Date.now();
    }
  }

  /**
   * Wrap a promise with a timeout.
   */
  private async withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    const timeoutMs = (this.config as CircuitBreakerConfig).timeoutMs;
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new CircuitBreakerTimeoutError(this.name, timeoutMs)), timeoutMs),
      ),
    ]);
  }

  /**
   * Get current stats for monitoring.
   */
  getStats(): CircuitBreakerStats {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /**
   * Manually reset the circuit breaker (for ops).
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.openedAt = undefined;
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(name: string, openedAt: number) {
    super(`Circuit breaker "${name}" is OPEN (opened at ${new Date(openedAt).toISOString()}). Failing fast.`);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class CircuitBreakerTimeoutError extends Error {
  constructor(name: string, timeoutMs: number) {
    super(`Circuit breaker "${name}" call timed out after ${timeoutMs}ms`);
    this.name = 'CircuitBreakerTimeoutError';
  }
}

// ─── Registry — manage circuit breakers for all external services ─────────

class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();

  /**
   * Get or create a circuit breaker for a named service.
   */
  get(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(name, config));
    }
    return this.breakers.get(name)!;
  }

  /**
   * Get all circuit breaker stats (for monitoring dashboard).
   */
  getAllStats(): CircuitBreakerStats[] {
    return Array.from(this.breakers.values()).map(b => b.getStats());
  }

  /**
   * Reset all circuit breakers (for ops).
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}

export const circuitBreakerRegistry = new CircuitBreakerRegistry();

// ─── Pre-configured breakers for known external services ──────────────────

export const breakers = {
  stellar: () => circuitBreakerRegistry.get('stellar-api', { timeoutMs: 15_000, cooldownMs: 60_000 }),
  ethereum: () => circuitBreakerRegistry.get('ethereum-rpc', { timeoutMs: 15_000, cooldownMs: 60_000 }),
  usdc: () => circuitBreakerRegistry.get('usdc-contract', { timeoutMs: 10_000, cooldownMs: 30_000 }),
  stripe: () => circuitBreakerRegistry.get('stripe-api', { timeoutMs: 30_000, cooldownMs: 60_000 }),
  momo: () => circuitBreakerRegistry.get('mobile-money', { timeoutMs: 10_000, cooldownMs: 30_000 }),
  bankApi: () => circuitBreakerRegistry.get('bank-api', { timeoutMs: 30_000, cooldownMs: 120_000 }),
  kyc: () => circuitBreakerRegistry.get('kyc-provider', { timeoutMs: 15_000, cooldownMs: 30_000 }),
  sanctions: () => circuitBreakerRegistry.get('sanctions-api', { timeoutMs: 10_000, cooldownMs: 15_000 }),
  email: () => circuitBreakerRegistry.get('email-service', { timeoutMs: 5_000, cooldownMs: 10_000 }),
  sms: () => circuitBreakerRegistry.get('sms-service', { timeoutMs: 5_000, cooldownMs: 10_000 }),
};
