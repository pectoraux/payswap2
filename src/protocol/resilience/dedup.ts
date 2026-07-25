/**
 * PaySwap Protocol — Resilience / Duplicate Detection + Idempotency.
 * -----------------------------------------------------------------------------
 * The DedupStore is the cornerstone of retry safety. Every state-mutating
 * operation in PaySwap is keyed by a content-hash idempotency key. Before
 * executing a side-effecting operation, the caller calls `checkOrMark`:
 *
 *   - If the key is NOT in the store: run the function, mark the key with the
 *     result, return `{ fromCache: false, result }`.
 *   - If the key IS in the store: return the cached result WITHOUT re-running
 *     the function: `{ fromCache: true, result }`.
 *
 * This guarantees INVARIANT #1: "A retried operation NEVER executes its side
 * effect twice." Even if the caller retries 100 times with the same key, the
 * side effect runs EXACTLY ONCE. Subsequent retries receive the cached result.
 *
 * TTLs:
 *   - Default 24h for payments, 7d for webhooks. TTL-based eviction prevents
 *     unbounded memory growth in production.
 *   - TTL is checked lazily on read; an expired entry is treated as "not seen"
 *     (so a re-run IS allowed after TTL expiry — this is intentional: a
 *     7-day-old webhook retry is treated as a new event).
 *
 * Key derivation:
 *   - For payments: hash of (intentHash, sourceAmount, sourceCurrency,
 *     destinationCurrency, senderId, receiverId).
 *   - For payouts: hash of (merchantId, sourceAmount, method, destination).
 *   - For webhooks: the eventId (already globally unique).
 *   - For arbitrary API requests: hash of (route, method, body).
 *
 * The store is in-memory. In production this would be Redis (with the same
 * `checkOrMark` API) so dedup works across multiple instances.
 */
import { createHash } from 'crypto';

/** Scope of a dedup key. */
export type DedupScope = 'payment' | 'payout' | 'webhook' | 'api_request';

/** A dedup key — scope + content hash. */
export interface DedupKey {
  scope: DedupScope;
  /** Content hash or unique id. */
  key: string;
}

/** Result of a `check()` call. */
export interface DedupCheckResult {
  seen: boolean;
  firstSeenTs?: number;
  /** The original result cached against this key (if any). */
  originalResult?: unknown;
  /** TTL expiry timestamp (ms). */
  expiresAt?: number;
}

/** Default TTLs per scope. */
export const DEFAULT_TTL_MS: Record<DedupScope, number> = {
  payment: 24 * 60 * 60 * 1000, // 24h
  payout: 24 * 60 * 60 * 1000, // 24h
  webhook: 7 * 24 * 60 * 60 * 1000, // 7d
  api_request: 60 * 60 * 1000, // 1h
};

interface DedupEntry {
  scope: DedupScope;
  key: string;
  firstSeenTs: number;
  expiresAt: number;
  result?: unknown;
  hasResult: boolean;
}

/** Composite key for the internal map. */
function compositeKey(scope: DedupScope, key: string): string {
  return `${scope}:${key}`;
}

/**
 * Derive a deterministic idempotency key from request parameters.
 *
 * Stable across calls with the same parameters — required for idempotency.
 * The hash is SHA-256 hex of a canonical JSON encoding of the input.
 */
export function idempotencyKey(params: Record<string, unknown>): string {
  // Canonicalise: sort keys recursively for deterministic encoding.
  const canonical = canonicalize(params);
  return 'idem_' + createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/** Canonical JSON encoding (sorted keys, no whitespace). */
function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  if (typeof value === 'object' && value !== undefined) {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const pairs = keys.map((k) => JSON.stringify(k) + ':' + canonicalize((value as Record<string, unknown>)[k]));
    return '{' + pairs.join(',') + '}';
  }
  return 'null';
}

/**
 * In-memory dedup store with TTL-based eviction.
 *
 * API:
 *   - `check(key)`      → `{ seen, firstSeenTs?, originalResult? }`
 *   - `mark(key, result?, ttlMs?)` → records the key
 *   - `checkOrMark(key, fn, ttlMs?)` → atomic check-and-mark
 *
 * All operations are synchronous (in-memory). A Redis-backed implementation
 * would use `SET ... NX` for `checkOrMark`.
 */
export class DedupStore {
  private entries: Map<string, DedupEntry> = new Map();
  /** Pending in-flight checkOrMark calls — prevents duplicate execution. */
  private pending: Map<string, Promise<unknown>> = new Map();

  /** Check whether a key has been seen (and not expired). */
  check(key: DedupKey): DedupCheckResult {
    const entry = this.entries.get(compositeKey(key.scope, key.key));
    if (!entry) return { seen: false };
    if (Date.now() >= entry.expiresAt) {
      // Expired — treat as not seen.
      this.entries.delete(compositeKey(key.scope, key.key));
      return { seen: false };
    }
    return {
      seen: true,
      firstSeenTs: entry.firstSeenTs,
      originalResult: entry.hasResult ? entry.result : undefined,
      expiresAt: entry.expiresAt,
    };
  }

  /** Mark a key as seen, optionally caching the result. */
  mark(key: DedupKey, result?: unknown, ttlMs?: number): void {
    const ttl = ttlMs ?? DEFAULT_TTL_MS[key.scope];
    const now = Date.now();
    this.entries.set(compositeKey(key.scope, key.key), {
      scope: key.scope,
      key: key.key,
      firstSeenTs: now,
      expiresAt: now + ttl,
      result,
      hasResult: result !== undefined,
    });
  }

  /**
   * Atomic check-and-mark.
   *
   * If the key has been seen, returns the cached result with `fromCache: true`.
   * If the key has NOT been seen, runs `fn`, marks the key with the result,
   * and returns `{ fromCache: false, result }`.
   *
   * If `fn` throws, the key is NOT marked — so a future retry will re-run `fn`.
   * This is the correct behaviour: a failure leaves no cached result.
   *
   * CONCURRENCY: if two `checkOrMark` calls for the same key arrive before the
   * first completes, the second awaits the first's promise and returns the
   * same result with `fromCache: true`. This guarantees the side effect runs
   * EXACTLY ONCE even under concurrent retries.
   */
  async checkOrMark<T>(
    key: DedupKey,
    fn: () => Promise<T>,
    ttlMs?: number,
  ): Promise<{ result: T; fromCache: boolean }> {
    const ck = compositeKey(key.scope, key.key);
    const existing = this.check(key);
    if (existing.seen) {
      return { result: existing.originalResult as T, fromCache: true };
    }
    // If a call for this key is already in flight, await it.
    const pendingPromise = this.pending.get(ck);
    if (pendingPromise) {
      const result = (await pendingPromise) as T;
      return { result, fromCache: true };
    }
    // Claim the key synchronously by recording the in-flight promise.
    const promise = (async () => {
      const result = await fn();
      this.mark(key, result, ttlMs);
      return result as unknown;
    })();
    this.pending.set(ck, promise);
    try {
      const result = (await promise) as T;
      return { result, fromCache: false };
    } finally {
      this.pending.delete(ck);
    }
  }

  /** Synchronous variant — for non-async functions. */
  checkOrMarkSync<T>(
    key: DedupKey,
    fn: () => T,
    ttlMs?: number,
  ): { result: T; fromCache: boolean } {
    const existing = this.check(key);
    if (existing.seen) {
      return { result: existing.originalResult as T, fromCache: true };
    }
    const result = fn();
    this.mark(key, result, ttlMs);
    return { result, fromCache: false };
  }

  /** Remove a key (e.g. on explicit cancellation). */
  remove(key: DedupKey): boolean {
    return this.entries.delete(compositeKey(key.scope, key.key));
  }

  /** Number of entries currently in the store. */
  size(): number {
    return this.entries.size;
  }

  /** Evict all expired entries. Returns the count evicted. */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [k, entry] of this.entries) {
      if (now >= entry.expiresAt) {
        this.entries.delete(k);
        evicted++;
      }
    }
    return evicted;
  }

  /** Clear all entries (mainly for tests). */
  reset(): void {
    this.entries.clear();
    this.pending.clear();
  }
}

/** Singleton dedup store. */
export const dedupStore = new DedupStore();

// ─── Convenience helpers ─────────────────────────────────────────────────────

/**
 * Build a DedupKey for a payment, scoped by the payment's intent hash.
 *
 * The intentHash should already encode (sourceAmount, sourceCurrency,
 * destinationAmount, destinationCurrency, senderId, receiverId). Callers can
 * use `idempotencyKey(...)` to derive it.
 */
export function dedupPayment(intentHash: string): DedupKey {
  return { scope: 'payment', key: intentHash };
}

/** Build a DedupKey for a webhook delivery, scoped by the event id. */
export function dedupWebhook(eventId: string): DedupKey {
  return { scope: 'webhook', key: eventId };
}

/** Build a DedupKey for a payout request, scoped by the request content hash. */
export function dedupPayout(requestHash: string): DedupKey {
  return { scope: 'payout', key: requestHash };
}

/** Build a DedupKey for an arbitrary API request, scoped by the content hash. */
export function dedupApiRequest(contentHash: string): DedupKey {
  return { scope: 'api_request', key: contentHash };
}
