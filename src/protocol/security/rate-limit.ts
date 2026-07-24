/**
 * PaySwap Protocol — Security — Rate Limiting (3 strategies).
 *
 * Per-key rate limiting with three interchangeable strategies:
 *   - fixed_window:    count requests in [t, t+windowMs); reset at boundary.
 *   - sliding_window:  rolling window of request timestamps in last windowMs.
 *   - token_bucket:    tokens refill at `limit/windowMs` rate; consume per call.
 *
 * API:
 *   const limiter = new RateLimiter('token_bucket', 100, 60_000);
 *   limiter.check('ip:1.2.3.4');            // does NOT consume
 *   limiter.consume('ip:1.2.3.4');          // consumes 1 token
 *
 *   const registry = rateLimiterRegistry;
 *   registry.get('api:per_ip').consume(ip);
 *
 * Frozen-kernel compliance: no kernel imports (pure module).
 */
import { logger } from '@/protocol/ops/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export type RateLimitStrategy = 'fixed_window' | 'sliding_window' | 'token_bucket';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  /** Strategy that produced this result (for debugging / headers). */
  strategy: RateLimitStrategy;
  /** Limit configured for this limiter. */
  limit: number;
}

export interface RateLimiterOptions {
  strategy: RateLimitStrategy;
  /** Maximum requests (or tokens) per window. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
  /** Cost per consume() call (default 1). */
  cost?: number;
  /** Optional capacity override for token_bucket (defaults to `limit`). */
  capacity?: number;
}

// ─── Internal state shapes ───────────────────────────────────────────────────

interface FixedWindowState {
  count: number;
  windowStart: number;
}

interface SlidingWindowState {
  timestamps: number[];
}

interface TokenBucketState {
  tokens: number;
  lastRefill: number;
}

type State = FixedWindowState | SlidingWindowState | TokenBucketState;

// ─── RateLimiter ─────────────────────────────────────────────────────────────

export class RateLimiter {
  readonly strategy: RateLimitStrategy;
  readonly limit: number;
  readonly windowMs: number;
  readonly cost: number;
  readonly capacity: number;
  private state: Map<string, State> = new Map();

  constructor(opts: RateLimiterOptions) {
    this.strategy = opts.strategy;
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.cost = opts.cost ?? 1;
    this.capacity = opts.capacity ?? opts.limit;
  }

  /** Peek without consuming. Returns what `consume()` WOULD return. */
  check(key: string): RateLimitResult {
    return this.evaluate(key, false);
  }

  /** Consume `cost` units (default 1). Returns the result. */
  consume(key: string, cost: number = this.cost): RateLimitResult {
    return this.evaluate(key, true, cost);
  }

  /** Reset state for a key (or all keys if no key given). */
  reset(key?: string): void {
    if (key === undefined) this.state.clear();
    else this.state.delete(key);
  }

  private evaluate(key: string, consume: boolean, cost: number = this.cost): RateLimitResult {
    const now = Date.now();
    switch (this.strategy) {
      case 'fixed_window':
        return this.evaluateFixed(key, now, consume, cost);
      case 'sliding_window':
        return this.evaluateSliding(key, now, consume, cost);
      case 'token_bucket':
        return this.evaluateToken(key, now, consume, cost);
    }
  }

  private evaluateFixed(key: string, now: number, consume: boolean, cost: number): RateLimitResult {
    let s = this.state.get(key) as FixedWindowState | undefined;
    if (!s || now >= s.windowStart + this.windowMs) {
      s = { count: 0, windowStart: now };
      if (consume) this.state.set(key, s);
    }
    const wouldBe = s.count + cost;
    const allowed = wouldBe <= this.limit;
    if (consume && allowed) s.count = wouldBe;
    if (consume && !allowed) {
      // Still record the attempt for state continuity — but don't increment.
      this.state.set(key, s);
    }
    return {
      allowed,
      remaining: Math.max(0, this.limit - (allowed ? wouldBe : s.count)),
      resetAt: s.windowStart + this.windowMs,
      strategy: this.strategy,
      limit: this.limit,
    };
  }

  private evaluateSliding(key: string, now: number, consume: boolean, cost: number): RateLimitResult {
    let s = this.state.get(key) as SlidingWindowState | undefined;
    if (!s) {
      s = { timestamps: [] };
      if (consume) this.state.set(key, s);
    }
    // Drop timestamps older than windowMs.
    const cutoff = now - this.windowMs;
    s.timestamps = s.timestamps.filter((t) => t > cutoff);
    const wouldBe = s.timestamps.length + cost;
    const allowed = wouldBe <= this.limit;
    if (consume && allowed) {
      for (let i = 0; i < cost; i++) s.timestamps.push(now);
      this.state.set(key, s);
    }
    const oldest = s.timestamps[0] ?? now;
    return {
      allowed,
      remaining: Math.max(0, this.limit - (allowed ? wouldBe : s.timestamps.length)),
      resetAt: oldest + this.windowMs,
      strategy: this.strategy,
      limit: this.limit,
    };
  }

  private evaluateToken(key: string, now: number, consume: boolean, cost: number): RateLimitResult {
    let s = this.state.get(key) as TokenBucketState | undefined;
    if (!s) {
      s = { tokens: this.capacity, lastRefill: now };
      if (consume) this.state.set(key, s);
    }
    // Refill tokens based on elapsed time.
    const elapsed = now - s.lastRefill;
    const refillRate = this.limit / this.windowMs; // tokens per ms
    s.tokens = Math.min(this.capacity, s.tokens + elapsed * refillRate);
    s.lastRefill = now;
    const allowed = s.tokens >= cost;
    if (consume && allowed) {
      s.tokens -= cost;
      this.state.set(key, s);
    } else if (consume) {
      // Record state even on denial so refill accumulates correctly.
      this.state.set(key, s);
    }
    // Time until enough tokens would be available.
    const needed = Math.max(0, cost - s.tokens);
    const resetAt = now + Math.ceil(needed / Math.max(refillRate, 1e-9));
    return {
      allowed,
      remaining: Math.floor(s.tokens),
      resetAt,
      strategy: this.strategy,
      limit: this.limit,
    };
  }
}

// ─── RateLimiterRegistry ─────────────────────────────────────────────────────

/**
 * Registry of named rate limiters. Pre-configured with sensible defaults:
 *   - api:global          — 1000 rps (token_bucket, capacity 1000)
 *   - api:per_key         — 100 rps per API key (token_bucket)
 *   - api:per_ip          — 60 rpm per IP (sliding_window)
 *   - payout:per_merchant — 10/min per merchant (fixed_window)
 *   - webhook:per_endpoint — 5/hour per endpoint (sliding_window)
 */
export class RateLimiterRegistry {
  private limiters: Map<string, RateLimiter> = new Map();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    this.limiters.set('api:global', new RateLimiter({
      strategy: 'token_bucket', limit: 1000, windowMs: 1000, capacity: 1000,
    }));
    this.limiters.set('api:per_key', new RateLimiter({
      strategy: 'token_bucket', limit: 100, windowMs: 1000, capacity: 100,
    }));
    this.limiters.set('api:per_ip', new RateLimiter({
      strategy: 'sliding_window', limit: 60, windowMs: 60_000,
    }));
    this.limiters.set('payout:per_merchant', new RateLimiter({
      strategy: 'fixed_window', limit: 10, windowMs: 60_000,
    }));
    this.limiters.set('webhook:per_endpoint', new RateLimiter({
      strategy: 'sliding_window', limit: 5, windowMs: 3600_000,
    }));
  }

  /** Register a new named limiter (overwrites existing). */
  register(name: string, opts: RateLimiterOptions): RateLimiter {
    const limiter = new RateLimiter(opts);
    this.limiters.set(name, limiter);
    logger.info('Rate limiter registered', { name, strategy: opts.strategy, limit: opts.limit, windowMs: opts.windowMs });
    return limiter;
  }

  /** Get a named limiter (throws if not found). */
  get(name: string): RateLimiter {
    const l = this.limiters.get(name);
    if (!l) throw new Error(`RateLimiterRegistry: limiter "${name}" not found`);
    return l;
  }

  /** Get a named limiter (returns undefined if not found). */
  maybeGet(name: string): RateLimiter | undefined {
    return this.limiters.get(name);
  }

  /** All registered limiter names. */
  names(): string[] {
    return [...this.limiters.keys()];
  }

  /** Convenience: check without consuming. */
  check(name: string, key: string): RateLimitResult {
    return this.get(name).check(key);
  }

  /** Convenience: consume 1 unit. */
  consume(name: string, key: string): RateLimitResult {
    return this.get(name).consume(key);
  }

  /** Reset all limiters (for tests). */
  reset(): void {
    for (const l of this.limiters.values()) l.reset();
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const rateLimiterRegistry = new RateLimiterRegistry();
