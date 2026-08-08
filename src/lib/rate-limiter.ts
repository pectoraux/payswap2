/**
 * SEC-5: Rate limiting per key and per IP.
 *
 * A simple in-memory sliding-window rate limiter. Production would use
 * Redis or a dedicated rate-limit service for multi-instance consistency,
 * but this is the correct first step — it stops enumeration and abuse
 * on a single instance, and the interface is designed to swap in a
 * distributed backend without changing callers.
 *
 * Usage:
 *   const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 5 });
 *   if (!limiter.check('ip:1.2.3.4')) {
 *     return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
 *   }
 *
 * Or via the middleware helper:
 *   import { checkRateLimit } from '@/lib/rate-limiter';
 *   if (!checkRateLimit('recovery', identifier, 5, 60_000)) {
 *     return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
 *   }
 */

interface RateLimitEntry {
  requests: number[];
  blocked: boolean;
  blockedUntil: number;
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  blockDurationMs?: number; // if set, exceed → block for this long
}

class RateLimiter {
  private entries = new Map<string, RateLimitEntry>();
  private cleanupCounter = 0;

  constructor(private config: RateLimitConfig) {}

  /**
   * Check if a request is allowed. Returns true if allowed, false if rate-limited.
   * Side effect: records the request timestamp if allowed.
   */
  check(key: string): boolean {
    const now = Date.now();
    const entry = this.entries.get(key) ?? { requests: [], blocked: false, blockedUntil: 0 };

    // Check if currently blocked.
    if (entry.blocked && now < entry.blockedUntil) {
      return false;
    }
    if (entry.blocked && now >= entry.blockedUntil) {
      // Block expired — reset.
      entry.blocked = false;
      entry.blockedUntil = 0;
      entry.requests = [];
    }

    // Prune old requests outside the window.
    entry.requests = entry.requests.filter(ts => now - ts < this.config.windowMs);

    // Check if the limit is exceeded.
    if (entry.requests.length >= this.config.maxRequests) {
      if (this.config.blockDurationMs) {
        entry.blocked = true;
        entry.blockedUntil = now + this.config.blockDurationMs;
      }
      this.entries.set(key, entry);
      return false;
    }

    // Allow — record the request.
    entry.requests.push(now);
    this.entries.set(key, entry);

    // Periodic cleanup (every 100 checks, remove expired entries).
    if (++this.cleanupCounter >= 100) {
      this.cleanupCounter = 0;
      this.cleanup(now);
    }

    return true;
  }

  /** Get the number of remaining requests in the current window. */
  remaining(key: string): number {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry) return this.config.maxRequests;
    if (entry.blocked && now < entry.blockedUntil) return 0;
    const recent = entry.requests.filter(ts => now - ts < this.config.windowMs);
    return Math.max(0, this.config.maxRequests - recent.length);
  }

  /** Get the time until the rate limit resets (ms). Returns 0 if not limited. */
  resetIn(key: string): number {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry) return 0;
    if (entry.blocked && now < entry.blockedUntil) {
      return entry.blockedUntil - now;
    }
    if (entry.requests.length === 0) return 0;
    const oldest = Math.min(...entry.requests);
    const resetAt = oldest + this.config.windowMs;
    return Math.max(0, resetAt - now);
  }

  /** Remove expired entries to bound memory. */
  private cleanup(now: number): void {
    for (const [key, entry] of this.entries) {
      const hasRecent = entry.requests.some(ts => now - ts < this.config.windowMs);
      const isBlocked = entry.blocked && now < entry.blockedUntil;
      if (!hasRecent && !isBlocked) {
        this.entries.delete(key);
      }
    }
  }

  /** Reset a specific key (e.g., after successful auth). */
  reset(key: string): void {
    this.entries.delete(key);
  }
}

// ── Pre-configured limiters for common use cases ─────────────────────────

const limiters = new Map<string, RateLimiter>();

function getLimiter(name: string, config: RateLimitConfig): RateLimiter {
  let limiter = limiters.get(name);
  if (!limiter) {
    limiter = new RateLimiter(config);
    limiters.set(name, limiter);
  }
  return limiter;
}

/**
 * Check a rate limit. Returns true if allowed, false if rate-limited.
 *
 * @param name — the limiter name (e.g., 'recovery', 'login', 'api')
 * @param identifier — the key to limit by (e.g., IP address, email, API key)
 * @param maxRequests — max requests in the window
 * @param windowMs — the window size in milliseconds
 * @param blockDurationMs — if set, exceeding the limit blocks for this long
 */
export function checkRateLimit(
  name: string,
  identifier: string,
  maxRequests: number,
  windowMs: number,
  blockDurationMs?: number,
): boolean {
  const limiter = getLimiter(name, { windowMs, maxRequests, blockDurationMs });
  return limiter.check(`${name}:${identifier}`);
}

/** Get remaining requests for a limiter + identifier. */
export function rateLimitRemaining(name: string, identifier: string, maxRequests: number, windowMs: number): number {
  const limiter = getLimiter(name, { windowMs, maxRequests });
  return limiter.remaining(`${name}:${identifier}`);
}

/** Get the time until the rate limit resets (ms). */
export function rateLimitResetIn(name: string, identifier: string, maxRequests: number, windowMs: number): number {
  const limiter = getLimiter(name, { windowMs, maxRequests });
  return limiter.resetIn(`${name}:${identifier}`);
}

/** Reset a rate limit for a specific identifier (e.g., after successful auth). */
export function resetRateLimit(name: string, identifier: string): void {
  const limiter = limiters.get(name);
  if (limiter) limiter.reset(`${name}:${identifier}`);
}

// ── Standard rate limit configurations ───────────────────────────────────

export const RATE_LIMITS = {
  // SEC-5: account recovery is public — limit per identifier + per IP.
  // 5 attempts per 15 minutes, then block for 15 minutes.
  recovery: { maxRequests: 5, windowMs: 15 * 60 * 1000, blockDurationMs: 15 * 60 * 1000 },

  // Login: 10 attempts per 15 minutes, then block for 30 minutes.
  login: { maxRequests: 10, windowMs: 15 * 60 * 1000, blockDurationMs: 30 * 60 * 1000 },

  // API key creation: 5 per hour.
  apiKeyCreate: { maxRequests: 5, windowMs: 60 * 60 * 1000 },

  // General API rate limit (per IP): 100 requests per minute.
  apiPerIp: { maxRequests: 100, windowMs: 60 * 1000 },

  // Webhook delivery retries: 5 per minute per endpoint.
  webhookRetry: { maxRequests: 5, windowMs: 60 * 1000 },
} as const;

export { RateLimiter };
