/**
 * PaySwap Protocol — Production Connectors v2 — Idempotency Store.
 *
 * Every connector request carries an `id` that doubles as the idempotency
 * key. When a retry (or a duplicate client request) re-sends the same key,
 * the store returns the cached response instead of hitting the upstream
 * again. This is critical for rails like M-Pesa STK Push where a retry
 * could otherwise double-charge a customer.
 *
 * The store is in-memory and TTL-bounded — entries older than
 * `idempotencyTtlMs` (default 24h) are evicted on access. This is enough
 * for a single-process runtime; a multi-replica deployment would swap this
 * for a Redis-backed implementation behind the same interface.
 */
import type { ConnectorResponse } from './types';

interface CachedEntry {
  response: ConnectorResponse;
  expiresAt: number;
}

export class IdempotencyStore {
  private store = new Map<string, CachedEntry>();

  /** Look up a cached response. Returns undefined if missing or expired. */
  get(key: string): ConnectorResponse | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // Return a shallow copy with the original requestId preserved so callers
    // can see this came from the cache.
    return { ...entry.response };
  }

  /** Cache a response under `key` with the given TTL. */
  set(key: string, response: ConnectorResponse, ttlMs: number): void {
    if (ttlMs <= 0) return;
    this.store.set(key, {
      response,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /** True if a non-expired entry exists for `key`. */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Remove all entries. */
  clear(): void {
    this.store.clear();
  }

  /** Drop expired entries. Called opportunistically; cheap to run often. */
  prune(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (now >= entry.expiresAt) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Number of entries currently cached (including possibly-expired ones). */
  size(): number {
    return this.store.size;
  }
}
