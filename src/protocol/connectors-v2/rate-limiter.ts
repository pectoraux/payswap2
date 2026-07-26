/**
 * PaySwap Protocol — Production Connectors v2 — Token-Bucket Rate Limiter.
 *
 * Each connector owns a `TokenBucketRateLimiter` initialised with the
 * upstream's stated rate limit (sustained RPS + burst). `acquire()` is
 * called before every attempt — if denied, the connector short-circuits
 * with a RATE_LIMITED error rather than hitting the upstream and burning
 * quota on a doomed request.
 *
 * The bucket refills continuously based on elapsed wall-clock time, which
 * means short bursts are absorbed by the bucket capacity and sustained
 * traffic converges on exactly `rps` tokens per second.
 */

/** Result of `acquire()`. */
export interface AcquireResult {
  allowed: boolean;
  /** Milliseconds until the next token would be available (0 if allowed). */
  retryAfterMs: number;
}

export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefillTs: number;

  /**
   * @param rps   sustained refill rate (tokens per second).
   * @param burst max tokens the bucket can hold (= burst capacity).
   */
  constructor(
    private readonly rps: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
    this.lastRefillTs = Date.now();
  }

  /** Refill the bucket based on elapsed time since the last call. */
  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillTs;
    if (elapsedMs <= 0) return;
    const refill = (elapsedMs / 1000) * this.rps;
    this.tokens = Math.min(this.burst, this.tokens + refill);
    this.lastRefillTs = now;
  }

  /**
   * Attempt to consume one token.
   * Returns `{ allowed: true }` if a token was available, otherwise
   * `{ allowed: false, retryAfterMs }` with the wait until the next token.
   */
  acquire(): AcquireResult {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true, retryAfterMs: 0 };
    }
    // How long until 1 token accrues at `rps` tokens/sec.
    const needed = 1 - this.tokens;
    const retryAfterMs = this.rps > 0 ? Math.ceil((needed / this.rps) * 1000) : 1000;
    return { allowed: false, retryAfterMs };
  }

  /** Current token count (after refilling). Useful for diagnostics. */
  availableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /** Reset the bucket to full capacity (e.g. after a health check). */
  reset(): void {
    this.tokens = this.burst;
    this.lastRefillTs = Date.now();
  }
}
