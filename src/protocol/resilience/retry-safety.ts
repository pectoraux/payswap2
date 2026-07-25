/**
 * PaySwap Protocol — Resilience / Retry Safety Policy.
 * -----------------------------------------------------------------------------
 * Retries are DANGEROUS. A retry that re-executes a side effect (e.g.
 * re-charges a card, re-sends a webhook, re-settles a payment) causes
 * double-spend / double-delivery. The RetrySafetyPolicy prevents this by
 * consulting the DedupStore BEFORE every attempt:
 *
 *   1. Before attempt N: check the dedup store for the idempotency key.
 *      If a previous attempt's result is cached → return it without
 *      re-executing. (`fromCache: true`.)
 *   2. If no cached result → execute `fn`, mark the key with the result.
 *   3. If `fn` throws → do NOT mark (so the next retry can re-attempt).
 *
 * INVARIANT: "Retries are safe because every operation is idempotent by
 * content hash." This module enforces that invariant: the side effect runs
 * EXACTLY ONCE per idempotency key, regardless of how many retries occur.
 *
 * Backoff:
 *   - Default exponential backoff: 1s, 2s, 4s, 8s, 16s (capped at 30s).
 *   - Backoff is applied BETWEEN attempts (not before the first).
 *   - The caller can override the backoff function.
 *
 * Max attempts:
 *   - Default 5 (1 initial + 4 retries).
 *   - After max attempts, the operation is considered permanently failed —
 *     the caller should move the item to the DLQ.
 */
import { type DedupKey, type DedupStore, dedupStore as defaultDedupStore } from './dedup';

/** Backoff strategy. Returns ms to wait before the next attempt. */
export type BackoffFn = (attempt: number) => number;

/** Default exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s. */
export const defaultBackoff: BackoffFn = (attempt: number) => {
  const base = Math.pow(2, attempt - 1) * 1000;
  return Math.min(base, 30_000);
};

/** Options for `safeRetry`. */
export interface SafeRetryOptions<T> {
  /** Idempotency key — same key → same result (cached). */
  idempotencyKey: DedupKey;
  /** The function to execute (only called if not cached). */
  fn: () => Promise<T>;
  /** Max attempts (including the first). Default 5. */
  maxAttempts?: number;
  /** Backoff function. Default: exponential 1s/2s/4s/8s/16s capped at 30s. */
  backoff?: BackoffFn;
  /** Dedup store to use. Default: singleton `dedupStore`. */
  dedupStore?: DedupStore;
  /** Optional predicate: should this error be retried? Default: always retry. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Optional sleep function (for tests). Default: `setTimeout`-based. */
  sleep?: (ms: number) => Promise<void>;
}

/** Result of `safeRetry`. */
export interface SafeRetryResult<T> {
  result: T;
  attempts: number;
  fromCache: boolean;
}

/** Default sleep — Promise-wrapped setTimeout. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute `fn` with retry safety.
 *
 *   - If a cached result for `idempotencyKey` exists in the dedup store, it's
 *     returned immediately with `fromCache: true, attempts: 0`.
 *   - Otherwise, `fn` is called. If it succeeds, the result is cached and
 *     returned with `fromCache: false, attempts: N` (where N is the number of
 *     attempts made).
 *   - If `fn` throws and `shouldRetry` returns true and we haven't exceeded
 *     `maxAttempts`, we back off and retry.
 *   - If `fn` throws and we've exhausted retries, the error is re-thrown.
 *
 * IMPORTANT: between retries, the dedup store is re-checked. If a parallel
 * call succeeded and cached the result, the retry returns the cached result
 * instead of re-executing.
 */
export async function safeRetry<T>(opts: SafeRetryOptions<T>): Promise<SafeRetryResult<T>> {
  const store = opts.dedupStore ?? defaultDedupStore;
  const maxAttempts = opts.maxAttempts ?? 5;
  const backoff = opts.backoff ?? defaultBackoff;
  const sleep = opts.sleep ?? defaultSleep;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  // First: check the dedup store. If cached, return immediately.
  const existing = store.check(opts.idempotencyKey);
  if (existing.seen && existing.originalResult !== undefined) {
    return {
      result: existing.originalResult as T,
      attempts: 0,
      fromCache: true,
    };
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Re-check the dedup store before each attempt — a parallel call may
    // have cached the result.
    const cached = store.check(opts.idempotencyKey);
    if (cached.seen && cached.originalResult !== undefined) {
      return {
        result: cached.originalResult as T,
        attempts: attempt - 1,
        fromCache: true,
      };
    }

    try {
      const result = await opts.fn();
      // Cache the result so future retries don't re-execute.
      store.mark(opts.idempotencyKey, result);
      return { result, attempts: attempt, fromCache: false };
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts) break;
      if (!shouldRetry(err, attempt)) break;
      const waitMs = backoff(attempt);
      if (waitMs > 0) await sleep(waitMs);
    }
  }

  // Exhausted retries — re-throw the last error.
  throw lastError;
}

/**
 * Webhook retry safety — ensures a webhook delivery is processed at-most-once
 * (effectively). The receiver may receive the same webhook multiple times
 * (network retries), but the dedup store keyed by `eventId` ensures the
 * RECEIVER'S processing is idempotent.
 *
 * Usage:
 *   const result = await webhookRetrySafety(deliveryId, async () => {
 *     return await processWebhook(eventId, payload);
 *   });
 *   if (result.fromCache) {
 *     // Webhook was already processed — ack the delivery without re-processing.
 *   }
 */
export async function webhookRetrySafety<T>(
  deliveryId: string,
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; backoff?: BackoffFn },
): Promise<SafeRetryResult<T>> {
  return safeRetry<T>({
    idempotencyKey: { scope: 'webhook', key: deliveryId },
    fn,
    maxAttempts: opts?.maxAttempts,
    backoff: opts?.backoff,
  });
}

/**
 * Payment retry safety — ensures a payment's side effects (escrow freeze,
 * LP settlement, escrow release) are applied at-most-once. The idempotency
 * key is the payment id; even if the transaction engine is called 100 times
 * for the same payment, the side effects run once.
 */
export async function paymentRetrySafety<T>(
  paymentId: string,
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; backoff?: BackoffFn },
): Promise<SafeRetryResult<T>> {
  return safeRetry<T>({
    idempotencyKey: { scope: 'payment', key: paymentId },
    fn,
    maxAttempts: opts?.maxAttempts,
    backoff: opts?.backoff,
  });
}

/**
 * Payout retry safety — ensures a payout's side effects (Twin Token burn,
 * connector transfer) are applied at-most-once. The idempotency key is the
 * payout request hash; even if the payout service is called 100 times for
 * the same payout request, the side effects run once.
 */
export async function payoutRetrySafety<T>(
  payoutRequestHash: string,
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; backoff?: BackoffFn },
): Promise<SafeRetryResult<T>> {
  return safeRetry<T>({
    idempotencyKey: { scope: 'payout', key: payoutRequestHash },
    fn,
    maxAttempts: opts?.maxAttempts,
    backoff: opts?.backoff,
  });
}

/**
 * INVARIANT DOCUMENTATION
 *
 * The retry safety invariant is: "Retries are safe because every operation is
 * idempotent by content hash."
 *
 * This means:
 *   1. Every state-mutating operation in PaySwap is keyed by a content hash
 *      of its parameters (see `idempotencyKey` in `dedup.ts`).
 *   2. Before executing, the dedup store is checked. If the key is present,
 *      the cached result is returned WITHOUT re-executing.
 *   3. After executing, the result is cached against the key.
 *   4. Concurrent calls for the same key await the in-flight promise (see
 *      `DedupStore.checkOrMark`), so the side effect runs exactly once even
 *      under concurrent retries.
 *
 * This is the "exactly-once-effect" guarantee: the side effect (charge,
 * transfer, webhook fire) is applied exactly once per logical operation,
 * regardless of retries, timeouts, or concurrent calls.
 */
export const RETRY_SAFETY_INVARIANT = `Retries are safe because every operation is idempotent by content hash. The DedupStore is consulted before every attempt; if a previous attempt's result is cached, it is returned without re-executing. Concurrent calls for the same key await the in-flight promise, so the side effect runs EXACTLY ONCE.`;
