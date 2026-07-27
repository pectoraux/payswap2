/**
 * PaySwap Protocol — Developer Platform — API Usage Tracking.
 *
 * Records per-API-key request telemetry used for billing, rate limiting,
 * and developer analytics. Each request logged via `recordRequest(...)`
 * becomes a row in a per-key ring buffer; aggregate views are computed
 * on demand from the buffer.
 *
 * Surface:
 *   - `recordRequest(apiKeyId, endpoint, method, statusCode, latencyMs)`
 *   - `getUsage(apiKeyId, range?)`              — raw requests in range
 *   - `getUsageByEndpoint(apiKeyId, range?)`    — grouped by endpoint
 *   - `getUsageStats(apiKeyId, range?)`         — totals + averages
 *   - `getRateLimitStatus(apiKeyId)`            — current window + remaining
 *   - `getTopEndpoints(apiKeyId, limit)`        — highest-volume endpoints
 *
 * Rate-limit policy: token-bucket per key, default 1000 req/min,
 * refill 1000/min. Different keys may have custom limits via
 * `setRateLimit(apiKeyId, ...)`.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs` from
 * `@/kernel/support`. No kernel files are modified.
 */
import { nowTs } from '@/kernel/support';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single recorded API request. */
export interface ApiUsageRecord {
  id: string;
  apiKeyId: string;
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  ts: number;
}

/** Optional time-range filter. */
export interface TimeRange {
  /** Inclusive start (epoch ms). */
  from: number;
  /** Exclusive end (epoch ms). Defaults to `Date.now()`. */
  to?: number;
}

/** Aggregate stats for an API key in a range. */
export interface ApiUsageStats {
  apiKeyId: string;
  range: Required<TimeRange>;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  clientErrorCount: number;
  serverErrorCount: number;
  errorRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  asOf: number;
}

/** Per-endpoint usage breakdown. */
export interface EndpointUsage {
  endpoint: string;
  method: string;
  count: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  lastUsedAt: number;
}

/** Rate-limit policy for an API key. */
export interface RateLimitPolicy {
  /** Maximum tokens the bucket can hold. */
  capacity: number;
  /** Tokens refilled per minute. */
  refillPerMinute: number;
}

/** Current rate-limit status for an API key. */
export interface RateLimitStatus {
  apiKeyId: string;
  policy: RateLimitPolicy;
  /** Tokens currently in the bucket. */
  remaining: number;
  /** Fraction of bucket remaining (0–1). */
  remainingFraction: number;
  /** Whether the next request would be allowed. */
  canMakeRequest: boolean;
  /** Epoch ms when the bucket was last refilled. */
  lastRefillAt: number;
  asOf: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default rate limit: 1000 req/min for any new key. */
export const DEFAULT_RATE_LIMIT: RateLimitPolicy = {
  capacity: 1000,
  refillPerMinute: 1000,
};

/** Max records per key (ring buffer). */
const MAX_RECORDS_PER_KEY = 10_000;

/** Token-bucket refill interval. */
const REFILL_INTERVAL_MS = 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Percentile via nearest-rank on a sorted ascending array. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (p <= 0) return sortedAsc[0];
  if (p >= 1) return sortedAsc[sortedAsc.length - 1];
  const rank = Math.ceil(p * (sortedAsc.length - 1));
  return sortedAsc[rank];
}

/** Average of an array. */
function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

/** Normalise a range to `{ from, to }` with `to` defaulting to now. */
function normaliseRange(range?: TimeRange): Required<TimeRange> {
  const to = range?.to ?? nowTs();
  return { from: range?.from ?? 0, to };
}

/** Random ID for a record. */
function recordId(): string {
  return `usage_${nowTs().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// ApiUsageService
// ---------------------------------------------------------------------------

/**
 * ApiUsageService tracks per-API-key request telemetry. It maintains a
 * per-key ring buffer of recent records and a per-key token bucket for
 * rate limiting.
 */
export class ApiUsageService {
  /** Per-key ring buffer of usage records (most-recent at end). */
  private records = new Map<string, ApiUsageRecord[]>();
  /** Per-key rate-limit policy. */
  private policies = new Map<string, RateLimitPolicy>();
  /** Per-key token-bucket state. */
  private buckets = new Map<string, { tokens: number; lastRefillAt: number }>();

  /** Record a single API request. */
  recordRequest(
    apiKeyId: string,
    endpoint: string,
    method: string,
    statusCode: number,
    latencyMs: number,
  ): ApiUsageRecord {
    if (!apiKeyId) throw new Error('apiKeyId is required');
    const rec: ApiUsageRecord = {
      id: recordId(),
      apiKeyId,
      endpoint,
      method: method.toUpperCase(),
      statusCode,
      latencyMs: Math.max(0, latencyMs),
      ts: nowTs(),
    };
    const buf = this.records.get(apiKeyId) ?? [];
    buf.push(rec);
    if (buf.length > MAX_RECORDS_PER_KEY) buf.splice(0, buf.length - MAX_RECORDS_PER_KEY);
    this.records.set(apiKeyId, buf);
    return rec;
  }

  /** Return all recorded requests for a key in the given range. */
  getUsage(apiKeyId: string, range?: TimeRange): ApiUsageRecord[] {
    const buf = this.records.get(apiKeyId) ?? [];
    if (!range) return [...buf];
    const r = normaliseRange(range);
    return buf.filter((rec) => rec.ts >= r.from && rec.ts < r.to);
  }

  /** Usage broken down by endpoint. */
  getUsageByEndpoint(apiKeyId: string, range?: TimeRange): EndpointUsage[] {
    const records = this.getUsage(apiKeyId, range);
    const map = new Map<string, EndpointUsage>();
    for (const rec of records) {
      const key = `${rec.method} ${rec.endpoint}`;
      const existing = map.get(key) ?? {
        endpoint: rec.endpoint,
        method: rec.method,
        count: 0,
        successCount: 0,
        errorCount: 0,
        avgLatencyMs: 0,
        lastUsedAt: 0,
      };
      existing.count += 1;
      if (rec.statusCode >= 200 && rec.statusCode < 400) existing.successCount += 1;
      else existing.errorCount += 1;
      existing.avgLatencyMs =
        (existing.avgLatencyMs * (existing.count - 1) + rec.latencyMs) / existing.count;
      if (rec.ts > existing.lastUsedAt) existing.lastUsedAt = rec.ts;
      map.set(key, existing);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }

  /** Aggregate stats for a key in a range. */
  getUsageStats(apiKeyId: string, range?: TimeRange): ApiUsageStats {
    const records = this.getUsage(apiKeyId, range);
    const r = normaliseRange(range);
    const latencies = records.map((rec) => rec.latencyMs).sort((a, b) => a - b);
    let success = 0;
    let clientErr = 0;
    let serverErr = 0;
    for (const rec of records) {
      if (rec.statusCode >= 200 && rec.statusCode < 400) success += 1;
      else if (rec.statusCode >= 400 && rec.statusCode < 500) clientErr += 1;
      else if (rec.statusCode >= 500) serverErr += 1;
    }
    const errorCount = clientErr + serverErr;
    const total = records.length;
    return {
      apiKeyId,
      range: r,
      totalRequests: total,
      successCount: success,
      errorCount,
      clientErrorCount: clientErr,
      serverErrorCount: serverErr,
      errorRate: total === 0 ? 0 : errorCount / total,
      avgLatencyMs: avg(latencies),
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      p99LatencyMs: percentile(latencies, 0.99),
      asOf: nowTs(),
    };
  }

  /** Get the top-N endpoints by request volume. */
  getTopEndpoints(apiKeyId: string, limit = 10): EndpointUsage[] {
    const all = this.getUsageByEndpoint(apiKeyId);
    return all.slice(0, Math.max(0, limit));
  }

  /** Configure a custom rate-limit policy for a key. */
  setRateLimit(apiKeyId: string, policy: RateLimitPolicy): void {
    this.policies.set(apiKeyId, { ...policy });
    // Reset the bucket so the new capacity takes effect immediately.
    this.buckets.set(apiKeyId, {
      tokens: policy.capacity,
      lastRefillAt: nowTs(),
    });
  }

  /** Get the current rate-limit policy for a key. */
  getRateLimitPolicy(apiKeyId: string): RateLimitPolicy {
    return this.policies.get(apiKeyId) ?? DEFAULT_RATE_LIMIT;
  }

  /**
   * Refill the token bucket for a key based on elapsed time and return the
   * current status.
   */
  getRateLimitStatus(apiKeyId: string): RateLimitStatus {
    const policy = this.getRateLimitPolicy(apiKeyId);
    const now = nowTs();
    const bucket = this.buckets.get(apiKeyId) ?? {
      tokens: policy.capacity,
      lastRefillAt: now,
    };
    const elapsed = now - bucket.lastRefillAt;
    const refilled =
      (elapsed / (60 * 1000)) * policy.refillPerMinute;
    bucket.tokens = Math.min(policy.capacity, bucket.tokens + refilled);
    bucket.lastRefillAt = now;
    this.buckets.set(apiKeyId, bucket);
    return {
      apiKeyId,
      policy,
      remaining: bucket.tokens,
      remainingFraction: bucket.tokens / policy.capacity,
      canMakeRequest: bucket.tokens >= 1,
      lastRefillAt: bucket.lastRefillAt,
      asOf: now,
    };
  }

  /**
   * Consume one token from the bucket. Returns `true` if the request is
   * allowed, `false` if rate-limited. Side-effects the bucket.
   */
  consumeToken(apiKeyId: string): boolean {
    const status = this.getRateLimitStatus(apiKeyId);
    if (!status.canMakeRequest) return false;
    const bucket = this.buckets.get(apiKeyId)!;
    bucket.tokens -= 1;
    return true;
  }

  /** Total number of records stored for a key. */
  recordCount(apiKeyId: string): number {
    return this.records.get(apiKeyId)?.length ?? 0;
  }

  /** Drop all records for a key (used on rotation / revocation). */
  clear(apiKeyId: string): void {
    this.records.delete(apiKeyId);
    this.buckets.delete(apiKeyId);
  }

  // Reference the unused constant to keep the API surface explicit.
  /** @internal */
  static readonly REFILL_INTERVAL_MS = REFILL_INTERVAL_MS;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _g = globalThis as unknown as { __PAYSWAP_API_USAGE_SERVICE?: ApiUsageService };
export const apiUsageService: ApiUsageService =
  _g.__PAYSWAP_API_USAGE_SERVICE ?? new ApiUsageService();
if (!_g.__PAYSWAP_API_USAGE_SERVICE) _g.__PAYSWAP_API_USAGE_SERVICE = apiUsageService;
