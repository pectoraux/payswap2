/**
 * PaySwap Protocol — Production Connectors v2 — Retry Policy.
 *
 * Exponential backoff with optional jitter. Respects `isRetryable()` — a
 * non-retryable error short-circuits after the first attempt (no backoff
 * wasted on AUTH_FAILED, INSUFFICIENT_FUNDS, etc.).
 *
 * Contract:
 *   - `maxAttempts` INCLUDES the first attempt. maxAttempts=3 → up to 3 calls.
 *   - On success → returns `{ result, attempts }` (attempts ≥ 1).
 *   - On non-retryable error → returns `{ result: null, error, attempts }`.
 *   - On exhausted retries → returns `{ result: null, error, attempts: maxAttempts }`.
 */
import type { ConnectorError } from './types';
import { isRetryable } from './errors';

export interface RetryPolicy {
  /** Total attempt cap (includes the first attempt). */
  maxAttempts: number;
  /** Backoff for the first retry (ms). */
  initialBackoffMs: number;
  /** Backoff ceiling (ms). */
  maxBackoffMs: number;
  /** Multiplier applied each attempt (e.g. 2.0 = classic exponential). */
  backoffMultiplier: number;
  /** Add ±50% jitter to each backoff to avoid thundering herd. */
  jitter: boolean;
  /** Extra HTTP statuses that should force a retry (in addition to isRetryable). */
  retryableStatuses: number[];
}

/** Sensible default — 3 attempts, exponential 100→1000ms, jittered. */
export function defaultRetryPolicy(retryCount: number, initialBackoffMs: number): RetryPolicy {
  return {
    maxAttempts: Math.max(1, retryCount + 1),
    initialBackoffMs,
    maxBackoffMs: 10_000,
    backoffMultiplier: 2.0,
    jitter: true,
    retryableStatuses: [429, 502, 503, 504],
  };
}

/**
 * Compute the backoff for a given attempt (1-indexed: attempt=1 is the first retry).
 *
 *   backoff = min(initial * mult^(attempt-1), maxBackoff)
 *   with jitter: backoff *= 0.5 + random()  (50%-150% of nominal)
 */
export function computeBackoff(attempt: number, policy: RetryPolicy): number {
  const exponent = Math.max(0, attempt - 1);
  let backoff = policy.initialBackoffMs * Math.pow(policy.backoffMultiplier, exponent);
  backoff = Math.min(backoff, policy.maxBackoffMs);
  if (policy.jitter) {
    // Full jitter variant: 50%–150% of nominal.
    backoff = backoff * (0.5 + Math.random());
  }
  return Math.max(0, Math.floor(backoff));
}

/** Promise-based sleep that doesn't block the event loop. */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute `fn` with retry. `fn` returns `{ result, error? }` — it NEVER throws.
 * (If it does throw, the throw propagates as an UNKNOWN error after wrapping.)
 *
 * The retry layer consults `isRetryable(error)` and `policy.retryableStatuses`.
 */
export async function executeWithRetry<T>(
  fn: () => Promise<{ result: T; error?: ConnectorError }>,
  policy: RetryPolicy,
): Promise<{ result: T | null; error?: ConnectorError; attempts: number }> {
  let attempt = 0;
  let lastError: ConnectorError | undefined;

  while (attempt < policy.maxAttempts) {
    attempt += 1;

    let outcome: { result: T; error?: ConnectorError };
    try {
      outcome = await fn();
    } catch (e) {
      // Defensive: subclass doQuery should never throw, but if it does we
      // synthesize an UNKNOWN error and treat it as non-retryable.
      const msg = e instanceof Error ? e.message : String(e);
      lastError = {
        code: 'UNKNOWN',
        message: `Connector threw: ${msg}`,
        retryable: false,
        raw: e,
      };
      return { result: null, error: lastError, attempts: attempt };
    }

    const { result, error } = outcome;
    if (!error) {
      return { result, attempts: attempt };
    }

    lastError = error;

    // Decide retryability: isRetryable OR status explicitly in retryableStatuses.
    const retryable =
      isRetryable(error) ||
      (error.httpStatus != null && policy.retryableStatuses.includes(error.httpStatus));

    if (!retryable) {
      return { result: null, error, attempts: attempt };
    }
    if (attempt >= policy.maxAttempts) {
      return { result: null, error, attempts: attempt };
    }

    // Respect Retry-After on RATE_LIMITED if larger than computed backoff.
    const computedBackoff = computeBackoff(attempt, policy);
    const backoff =
      error.code === 'RATE_LIMITED' && error.retryAfterMs != null
        ? Math.max(computedBackoff, error.retryAfterMs)
        : computedBackoff;
    await sleep(backoff);
  }

  // Unreachable in practice — loop returns on every path. Defensive default.
  return { result: null, error: lastError, attempts: attempt };
}
