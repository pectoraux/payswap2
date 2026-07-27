/**
 * Idempotency Store — prevents duplicate command processing. (M-RT-22.)
 *
 * PROBLEM:
 *   If a client retries a command (network timeout, double-click, etc.),
 *   the dispatcher must NOT process it twice. A payment of $100 retried
 *   3 times must result in ONE payment, not three.
 *
 * SOLUTION:
 *   Every command carries a unique `commandId` (or `idempotencyKey`).
 *   Before processing, the dispatcher checks the IdempotencyStore:
 *     - If the key exists → return the cached result (no re-processing).
 *     - If not → process the command, store the result, return it.
 *
 * The store is in-memory (M-RT-22). A future milestone can persist it
 * to Prisma for durability across restarts.
 *
 * CONCURRENCY:
 *   The store uses a per-key lock to prevent two concurrent dispatches
 *   of the same key from both processing the command. The second dispatch
 *   waits for the first to complete, then returns the cached result.
 */

/** A cached dispatch result (what the dispatcher returns). */
export interface CachedResult {
  /** The command ID that produced this result. */
  commandId: string;
  /** The idempotency key (if different from commandId). */
  idempotencyKey?: string;
  /** The cached result. */
  result: unknown;
  /** When the result was cached (epoch ms). */
  cachedAt: number;
}

/** Entry in the idempotency store. */
interface StoreEntry {
  result: CachedResult;
  /** In-flight promise (if the command is currently being processed). */
  inFlight?: Promise<unknown>;
}

/**
 * IdempotencyStore — prevents duplicate command processing.
 *
 * USAGE:
 *   const store = new IdempotencyStore();
 *
 *   // Check if already processed:
 *   const cached = store.get(commandId);
 *   if (cached) return cached;
 *
 *   // Or use the execute-with-idempotency pattern:
 *   const result = await store.execute(commandId, async () => {
 *     return await dispatcher.dispatch(command);
 *   });
 */
export class IdempotencyStore {
  private readonly entries = new Map<string, StoreEntry>();
  /** Default TTL: 24 hours (in ms). Entries older than this are evicted. */
  private readonly defaultTtlMs: number;

  constructor(opts: { defaultTtlMs?: number } = {}) {
    this.defaultTtlMs = opts.defaultTtlMs ?? 24 * 60 * 60 * 1000;
  }

  /**
   * Get a cached result by key (commandId or idempotencyKey).
   * Returns null if not found or expired.
   */
  get(key: string): CachedResult | null {
    this.evictExpired();
    const entry = this.entries.get(key);
    if (!entry) return null;
    return entry.result;
  }

  /**
   * Store a result. Called after a command has been processed.
   */
  put(result: CachedResult): void {
    this.entries.set(result.commandId, { result });
    if (result.idempotencyKey && result.idempotencyKey !== result.commandId) {
      this.entries.set(result.idempotencyKey, { result });
    }
  }

  /**
   * Execute a function with idempotency protection.
   *
   * If the key already exists, returns the cached result immediately.
   * If another dispatch with the same key is in-flight, waits for it
   * and returns its result.
   * Otherwise, executes the function, caches the result, and returns it.
   *
   * This is the primary method the dispatcher calls.
   */
  async execute<T>(
    key: string,
    fn: () => Promise<T>,
    opts: { ttlMs?: number } = {},
  ): Promise<{ cached: boolean; result: T }> {
    this.evictExpired();

    // Check if already cached.
    const existing = this.entries.get(key);
    if (existing && !existing.inFlight) {
      return { cached: true, result: existing.result.result as T };
    }

    // Check if in-flight (another dispatch is processing this key).
    if (existing?.inFlight) {
      const result = await existing.inFlight as T;
      return { cached: true, result };
    }

    // Not cached — execute the function.
    const inFlight = fn().then((result) => {
      // Cache the result.
      const cached: CachedResult = {
        commandId: key,
        result,
        cachedAt: Date.now(),
      };
      const entry = this.entries.get(key);
      this.entries.set(key, { result: cached });
      return result;
    }).catch((err) => {
      // On failure, remove the in-flight marker so the command can be retried.
      const entry = this.entries.get(key);
      if (entry?.inFlight === inFlight) {
        this.entries.delete(key);
      }
      throw err;
    });

    // Mark as in-flight.
    this.entries.set(key, { result: { commandId: key, result: null, cachedAt: Date.now() }, inFlight });

    const result = await inFlight;
    return { cached: false, result };
  }

  /** Remove expired entries (older than defaultTtlMs). */
  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.result.cachedAt > this.defaultTtlMs) {
        this.entries.delete(key);
      }
    }
  }

  /** Clear all entries (for testing). */
  clear(): void {
    this.entries.clear();
  }

  /** Number of entries in the store. */
  size(): number {
    return this.entries.size;
  }

  /** Check if a key is in-flight (being processed). */
  isInFlight(key: string): boolean {
    return this.entries.get(key)?.inFlight !== undefined;
  }
}
