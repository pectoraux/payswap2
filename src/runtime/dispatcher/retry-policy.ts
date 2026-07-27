/**
 * Retry Policy — retries commands on transient failures. (M-RT-22.)
 *
 * PROBLEM:
 *   In a concurrent system, two commands may both read the same stream
 *   version, both pass invariant checks, then both try to append. The
 *   EventStore's optimistic concurrency check rejects the second append
 *   (version conflict). The second command should RETRY: re-load the
 *   stream version, re-run the handler, re-verify, re-append.
 *
 * SOLUTION:
 *   The RetryPolicy wraps the dispatch attempt. On OptimisticConcurrencyError,
 *   it retries up to `maxRetries` times with exponential backoff.
 *
 *   retry 0: immediate
 *   retry 1: 10ms delay
 *   retry 2: 20ms delay
 *   retry 3: 40ms delay
 *   (capped at maxDelayMs)
 *
 * The policy is also applied to other transient errors (network timeouts,
 * etc.) but NOT to invariant violations (those are permanent — the command
 * is fundamentally invalid).
 */

import { OptimisticConcurrencyError } from '../events';

/** Configuration for the retry policy. */
export interface RetryPolicyOptions {
  /** Maximum retry attempts (default 3). */
  maxRetries?: number;
  /** Initial delay in ms (default 10). */
  initialDelayMs?: number;
  /** Maximum delay in ms (default 100). */
  maxDelayMs?: number;
  /** Backoff multiplier (default 2). */
  backoffMultiplier?: number;
}

/** The result of a retry attempt. */
export interface RetryOutcome<T> {
  /** The final result (if successful). */
  result?: T;
  /** The error (if all retries failed). */
  error?: Error;
  /** Number of retries attempted. */
  retries: number;
  /** Whether the operation succeeded. */
  succeeded: boolean;
}

/**
 * RetryPolicy — retries a function on transient failures.
 *
 * Retries on:
 *   - OptimisticConcurrencyError (stream version conflict)
 *   - Network-like errors (timeout, connection reset)
 *
 * Does NOT retry on:
 *   - Invariant violations (permanent — the command is invalid)
 *   - Handler errors (permanent — the command is malformed)
 */
export class RetryPolicy {
  private readonly maxRetries: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly backoffMultiplier: number;

  constructor(opts: RetryPolicyOptions = {}) {
    this.maxRetries = opts.maxRetries ?? 3;
    this.initialDelayMs = opts.initialDelayMs ?? 10;
    this.maxDelayMs = opts.maxDelayMs ?? 100;
    this.backoffMultiplier = opts.backoffMultiplier ?? 2;
  }

  /**
   * Execute a function with retry.
   *
   * @param fn The function to execute. Should throw on failure.
   * @param shouldRetry Optional predicate — return false to stop retrying.
   * @returns RetryOutcome with the result or error.
   */
  async execute<T>(
    fn: () => Promise<T>,
    shouldRetry: (error: Error, attempt: number) => boolean = defaultShouldRetry,
  ): Promise<RetryOutcome<T>> {
    let lastError: Error | undefined;
    let attempt = 0;

    for (attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await fn();
        return { result, retries: attempt, succeeded: true };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Check if we should retry.
        if (attempt >= this.maxRetries || !shouldRetry(lastError, attempt)) {
          break;
        }

        // Wait with exponential backoff.
        const delay = Math.min(
          this.initialDelayMs * Math.pow(this.backoffMultiplier, attempt),
          this.maxDelayMs,
        );
        await this.sleep(delay);
      }
    }

    return { error: lastError, retries: attempt, succeeded: false };
  }

  /** Sleep for the given milliseconds. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Default retry predicate: retry on OptimisticConcurrencyError.
 *
 * Invariant violations and handler errors are NOT retried (they're permanent).
 */
export function defaultShouldRetry(error: Error, _attempt: number): boolean {
  // Retry on optimistic concurrency conflicts (transient — another command
  // got there first; retrying will re-load the stream version).
  if (error instanceof OptimisticConcurrencyError) return true;
  if (error.name === 'OptimisticConcurrencyError') return true;

  // Retry on network-like errors (transient).
  if (error.message.includes('ECONNRESET')) return true;
  if (error.message.includes('ETIMEDOUT')) return true;
  if (error.message.includes('fetch failed')) return true;

  // Don't retry on invariant violations (permanent — the command is invalid).
  if (error.message.includes('Invariant violation')) return false;

  // Don't retry on unknown commands (permanent).
  if (error.message.includes('No handler registered')) return false;

  // Don't retry on handler errors (permanent — the command is malformed).
  return false;
}
