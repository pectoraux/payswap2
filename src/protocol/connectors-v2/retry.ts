/**
 * PaySwap Protocol — Production Connectors v2 — Retry Policy.
 *
 * `executeWithRetry` runs an async function with exponential backoff and
 * jitter. It stops immediately on non-retryable errors (AUTH_FAILED,
 * INSUFFICIENT_FUNDS, …) and only backs off when `isRetryable(error)`
 * returns true.
 *
 * The function is generic over `T` and returns either the successful value
 * or the last `ConnectorError` — never throws. This is the contract the
 * base connector relies on: every retryable attempt either yields data or
 * yields an error, and the orchestrator decides what to do with it.
 */
import type { ConnectorError } from './types';
import { isRetryable } from './errors';

/** Tunable retry behaviour. */
export interface RetryPolicy {
  /** Total attempts including the first (so 3 = 1 initial + 2 retries). */
  maxAttempts: number;
  /** First backoff in ms. */
  initialBackoffMs: number;
  /** Ceiling on a single backoff. */
  maxBackoffMs: number;
  /** Multiplier applied between attempts (e.g. 2 = doubling). */
  backoffMultiplier: number;
  /** 0..1 — fraction of backoff to randomise (avoids thundering herd). */
  jitter: number;
}

/** Sensible defaults for external HTTP rails. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialBackoffMs: 200,
  maxBackoffMs: 5_000,
  backoffMultiplier: 2,
  jitter: 0.25,
};

/** Outcome of a retried execution — discriminated union, never throws. */
export type RetryOutcome<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: ConnectorError; attempts: number };

/** Compute the backoff (in ms) for attempt `n` (0-indexed). */
function backoffFor(policy: RetryPolicy, n: number): number {
  const raw = policy.initialBackoffMs * Math.pow(policy.backoffMultiplier, n);
  const capped = Math.min(raw, policy.maxBackoffMs);
  const jitterAmount = capped * policy.jitter;
  // Jitter centred on the nominal value, in [-jitter/2, +jitter/2].
  const offset = (Math.random() - 0.5) * jitterAmount;
  return Math.max(0, Math.round(capped + offset));
}

/** Promise-based sleep. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` with retry. `fn` must not throw — it returns either
 * `{ ok: true, value }` or `{ ok: false, error }`. The orchestrator
 * keeps calling `fn` until it succeeds, exhausts attempts, or hits a
 * non-retryable error.
 */
export async function executeWithRetry<T>(
  fn: () => Promise<{ ok: true; value: T } | { ok: false; error: ConnectorError }>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<RetryOutcome<T>> {
  let lastError: ConnectorError | null = null;
  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    const result = await fn();
    if (result.ok) {
      return { ok: true, value: result.value, attempts: attempt + 1 };
    }
    lastError = result.error;
    if (!isRetryable(result.error)) {
      return { ok: false, error: result.error, attempts: attempt + 1 };
    }
    if (attempt < policy.maxAttempts - 1) {
      await sleep(backoffFor(policy, attempt));
    }
  }
  return { ok: false, error: lastError!, attempts: policy.maxAttempts };
}
