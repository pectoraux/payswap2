/**
 * PaySwap Protocol — Production Connectors v2 — Idempotency Store.
 *
 * In-memory Map keyed by idempotency key → cached response. Each entry has
 * a TTL; expired entries are lazily evicted on read.
 *
 * Contract:
 *   - A request with the same key within the TTL window returns the cached
 *     response WITHOUT calling doQuery.
 *   - Cache hits report `attempts: 0` (the upstream was never touched).
 *   - On cache hit, the requestId is re-stamped by the caller (see base.ts).
 *
 * In production this would be Redis with a TTL index. The Map shape is the
 * same — drop-in replaceable.
 */
import type { ConnectorResponse } from './types';

interface CacheEntry {
  response: ConnectorResponse;
  expiresAt: number;
}

export class IdempotencyStore {
  private cache: Map<string, CacheEntry> = new Map();

  /** Get a cached response. Returns undefined if absent or expired. */
  get(key: string): ConnectorResponse | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      // Lazy eviction.
      this.cache.delete(key);
      return undefined;
    }
    return entry.response;
  }

  /** Cache a response with the given TTL. */
  set(key: string, response: ConnectorResponse, ttlMs: number): void {
    // Don't cache error responses — only successes. A failed request can be
    // retried by the caller with the same key (e.g. transient NETWORK).
    if (!response.success) return;
    this.cache.set(key, {
      response,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /** Whether the key is present and unexpired. */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Drop a single key. */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /** Clear all cached entries. */
  clear(): void {
    this.cache.clear();
  }

  /** Sweep all expired entries. Returns the count evicted. */
  sweep(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.cache) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
        evicted += 1;
      }
    }
    return evicted;
  }

  /** Current entry count (including expired-but-not-yet-evicted). */
  size(): number {
    return this.cache.size;
  }
}
