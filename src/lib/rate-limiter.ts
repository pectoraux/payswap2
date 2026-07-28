/**
 * Rate Limiter — in-memory sliding window rate limiter. (H-5 fix.)
 *
 * Used to protect authentication endpoints from brute-force attacks.
 * Limits the number of requests per IP within a time window.
 *
 * For production with multiple instances, this should be backed by Redis.
 * For single-instance deployment, in-memory is sufficient.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface RateLimitConfig {
  windowMs: number;     // time window in milliseconds
  maxRequests: number;  // max requests per window per key
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 10,            // 10 attempts per 15 minutes (auth)
};

const store = new Map<string, RateLimitEntry>();

// Periodic cleanup of expired entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > 60 * 60 * 1000) {  // 1 hour
      store.delete(key);
    }
  }
}, 5 * 60 * 1000).unref?.();

/**
 * Check if a request should be rate limited.
 * Returns { allowed: boolean, remaining: number, retryAfterMs: number }
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart > config.windowMs) {
    // New window
    store.set(key, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      retryAfterMs: 0,
    };
  }

  if (entry.count >= config.maxRequests) {
    // Rate limited
    const retryAfterMs = config.windowMs - (now - entry.windowStart);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs,
    };
  }

  // Allowed — increment count
  entry.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    retryAfterMs: 0,
  };
}

/**
 * Get the client IP from a Next.js request.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}

/**
 * Auth rate limit config: 10 attempts per 15 minutes per IP.
 */
export const AUTH_RATE_LIMIT: RateLimitConfig = {
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
};

/**
 * API rate limit config: 100 requests per minute per IP.
 */
export const API_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60 * 1000,
  maxRequests: 100,
};
