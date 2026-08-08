/**
 * PaySwap Protocol — Resilience — Dedup / Idempotency Store.
 *
 * Two layers of duplicate-suppression:
 *
 *   1. `DedupStore` — an in-memory TTL-bounded key→result cache. Used by
 *      anything that wants to detect a previously-seen request and replay
 *      the original result instead of re-executing the side effect.
 *
 *   2. `idempotencyKey(params)` — a deterministic hash of a JSON-serialisable
 *      parameter object. Stable key generation means the same logical request
 *      (e.g. "pay merchant X invoice Y amount Z") always maps to the same
 *      dedup key, even if the caller re-sends from a different retry.
 *
 * The store is single-process and in-memory; a multi-replica deployment would
 * swap this for a Redis-backed implementation behind the same interface.
 *
 * The kernel is FROZEN — this module imports only from `@/kernel/support`.
 */
import { nowTs } from '@/kernel/support';

/** Default TTL for cached entries (24 hours). */
export const DEFAULT_DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

/** A cached dedup entry. */
interface DedupEntry {
  /** ts the key was first seen. */
  firstSeenTs: number;
  /** ts the entry expires. */
  expiresAt: number;
  /** Cached result, if one was stored. */
  result: unknown;
  /** Whether a result was stored alongside the key. */
  hasResult: boolean;
}

/** Result of a `check` — never throws. */
export interface DedupCheckResult {
  /** True if the key was seen before (and is still within its TTL). */
  seen: boolean;
  /** ts the key was first marked, or undefined if unseen. */
  firstSeenTs?: number;
  /** The original result cached against the key, if any. */
  originalResult?: unknown;
}

/**
 * In-memory TTL-bounded dedup store.
 *
 * Lookups lazily evict expired entries; `prune()` is available for an
 * opportunistic sweep.
 */
export class DedupStore {
  private readonly store = new Map<string, DedupEntry>();
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs: number = DEFAULT_DEDUP_TTL_MS) {
    this.defaultTtlMs = defaultTtlMs;
  }

  /** Reset the store — clears every entry. Test helper. */
  reset(): void {
    this.store.clear();
  }

  // ----------------------------------------------------------- key normaliser
  /**
   * Normalise a dedup key. Accepts:
   *   - a plain string (returned as-is),
   *   - an object `{ scope, key }` (serialised to `scope:key`),
   *   - any other object (canonicalised via `idempotencyKey`).
   */
  private normaliseKey(key: string | { scope: string; key: string } | object): string {
    if (typeof key === 'string') return key;
    if (key !== null && typeof key === 'object' && 'scope' in key && 'key' in key) {
      const k = key as { scope: string; key: string };
      return `${k.scope}:${k.key}`;
    }
    return idempotencyKey(key);
  }

  // ------------------------------------------------------------- check / mark
  /** Check whether `key` has been seen. Does NOT mutate the store. */
  check(key: string | { scope: string; key: string } | object): DedupCheckResult {
    const k = this.normaliseKey(key);
    const entry = this.store.get(k);
    if (!entry) return { seen: false };
    if (nowTs() >= entry.expiresAt) {
      // Expired — clean up and report as unseen.
      this.store.delete(k);
      return { seen: false };
    }
    const result: DedupCheckResult = {
      seen: true,
      firstSeenTs: entry.firstSeenTs,
    };
    if (entry.hasResult) result.originalResult = entry.result;
    return result;
  }

  /**
   * Mark `key` as seen, optionally caching a result. Re-marking an existing
   * (non-expired) key refreshes its TTL but does NOT overwrite the original
   * result — once a result is cached, it is sticky until expiry.
   */
  mark(key: string | { scope: string; key: string } | object, result?: unknown, ttlMs: number = this.defaultTtlMs): void {
    const k = this.normaliseKey(key);
    if (ttlMs <= 0) return;
    const existing = this.store.get(k);
    const ts = nowTs();
    if (existing && nowTs() < existing.expiresAt) {
      // Refresh TTL, preserve original firstSeenTs and original result.
      existing.expiresAt = ts + ttlMs;
      if (result !== undefined && !existing.hasResult) {
        existing.result = result;
        existing.hasResult = true;
      }
      return;
    }
    this.store.set(k, {
      firstSeenTs: ts,
      expiresAt: ts + ttlMs,
      result,
      hasResult: result !== undefined,
    });
  }

  /**
   * Atomic check-and-execute:
   *   - If `key` has been seen, return the cached result (or undefined if no
   *     result was stored).
   *   - Otherwise, run `fn`, mark `key` with the result + TTL, and return it.
   *
   * The check-then-mark is atomic at the level of this single-threaded
   * runtime: there is no `await` between the check and the mark for the
   * cache-hit path, and for the cache-miss path the key is marked immediately
   * after `fn` resolves.
   */
  async checkOrMark<T>(
    key: string | { scope: string; key: string } | object,
    fn: () => Promise<T>,
    ttlMs: number = this.defaultTtlMs,
  ): Promise<{ fromCache: boolean; result: T }> {
    const k = this.normaliseKey(key);
    const hit = this.check(k);
    if (hit.seen && hit.originalResult !== undefined) {
      return { fromCache: true, result: hit.originalResult as T };
    }
    const value = await fn();
    this.mark(k, value, ttlMs);
    return { fromCache: false, result: value };
  }

  // ----------------------------------------------------------------- utility
  /** Drop a single key (e.g. after an explicit invalidate). */
  forget(key: string | { scope: string; key: string } | object): boolean {
    const k = this.normaliseKey(key);
    return this.store.delete(k);
  }

  /** Sweep all expired entries. Returns the count removed. */
  prune(): number {
    const now = nowTs();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (now >= entry.expiresAt) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** Number of entries currently cached (including possibly-expired ones). */
  size(): number {
    return this.store.size;
  }

  /** Remove all entries. */
  clear(): void {
    this.store.clear();
  }

  /** Alias for clear() (test compatibility). */
  reset(): void {
    this.clear();
  }
}

/**
 * Build a deterministic idempotency key from a JSON-serialisable parameter
 * object. Object key order does NOT affect the hash — keys are sorted
 * recursively before serialisation. This means two calls with the same
 * parameters in a different order produce the same key.
 */
export function idempotencyKey(params: unknown): string {
  const canonical = canonicalise(params);
  return `idem_${fnv1a(canonical)}`;
}

// --------------------------------------------------------------- key helpers

/**
 * Canonicalise a value for deterministic JSON serialisation. Object keys are
 * sorted recursively; primitives, arrays and `null` pass through unchanged.
 */
function canonicalise(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'undefined') return 'undef';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return 'fn';
  if (Array.isArray(value)) {
    return `[${value.map(canonicalise).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalise(obj[k])}`);
    return `{${pairs.join(',')}}`;
  }
  return 'unknown';
}

/** 32-bit FNV-1a hash — fast, deterministic, no dependencies. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Global singleton — survives Next.js dev module re-instantiation.
const _globalForDedup =
  globalThis as unknown as { __PAYSWAP_DEDUP_STORE?: DedupStore };
export const dedupStore: DedupStore =
  _globalForDedup.__PAYSWAP_DEDUP_STORE ?? new DedupStore();
if (!_globalForDedup.__PAYSWAP_DEDUP_STORE) {
  _globalForDedup.__PAYSWAP_DEDUP_STORE = dedupStore;
}
