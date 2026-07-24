/**
 * PaySwap Protocol — Production Connectors v2 — Token-Bucket Rate Limiter.
 *
 * Classic token bucket: bucket starts full (`burst` tokens); tokens refill
 * at `rps` per second up to `burst`. `acquire()` returns immediately with
 * `{ allowed: true }` if a token is available, or `{ allowed: false,
 * retryAfterMs }` if the bucket is empty.
 *
 * One instance per connector. The base ProductionConnector consults this
 * BEFORE issuing the upstream call — a denied acquire short-circuits the
 * entire request as RATE_LIMITED, never touching doQuery.
 */
export class TokenBucketRateLimiter {
  private tokens: number;
  private readonly rps: number;
  private readonly burst: number;
  private lastRefillTs: number;

  constructor(rps: number, burst: number) {
    this.rps = Math.max(0.01, rps);
    this.burst = Math.max(1, burst);
    this.tokens = this.burst;
    this.lastRefillTs = Date.now();
  }

  /** Refill the bucket based on elapsed wall-clock time. */
  private refill(): void {
    const now = Date.now();
    const elapsedMs = Math.max(0, now - this.lastRefillTs);
    const refillTokens = (elapsedMs / 1000) * this.rps;
    this.tokens = Math.min(this.burst, this.tokens + refillTokens);
    this.lastRefillTs = now;
  }

  /**
   * Try to acquire one token.
   * Returns `{ allowed: true }` on success (token consumed).
   * Returns `{ allowed: false, retryAfterMs }` on empty bucket — the caller
   * should back off for at least `retryAfterMs` before trying again.
   */
  acquire(): { allowed: boolean; retryAfterMs: number } {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true, retryAfterMs: 0 };
    }
    // Bucket empty. Compute how long until one token refills.
    const retryAfterMs = Math.ceil((1 - this.tokens) / this.rps * 1000);
    return { allowed: false, retryAfterMs: Math.max(1, retryAfterMs) };
  }

  /** Current token count (after refill). */
  availableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /** Reset the bucket to full — e.g. after a manual override. */
  reset(): void {
    this.tokens = this.burst;
    this.lastRefillTs = Date.now();
  }
}
