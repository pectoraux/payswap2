/**
 * Scheduling Engine — time-based execution. (M-RT-15.)
 *
 * Responsibilities:
 *   - Schedule deferred/recurring jobs
 *   - Deterministic scheduling (clock-driven)
 *   - Retry policies with exponential backoff
 *   - Dead-letter handling
 *   - Dispatch through the same runtime entry point as API requests
 *
 * It does NOT duplicate the Runtime Clock or introduce a second execution model.
 * It simply creates work and hands it to the same runtime path.
 *
 * Dependency:
 *   Runtime Clock → Scheduling Engine → Runtime (same path as API requests)
 */

import type { RuntimeClock } from '../../clock';

// ─── Types ──────────────────────────────────────────────────────────────────

/** A scheduled job — what to do + when. */
export interface ScheduledJob {
  id: string;
  /** The operation to perform (dispatched through the runtime). */
  operation: string;
  /** The request body for the operation. */
  body: Record<string, unknown>;
  /** When the job should execute (Runtime Clock ms). */
  scheduledFor: number;
  /** Recurrence: if set, the job repeats at this interval. */
  intervalMs?: number;
  /** Retry policy. */
  retryPolicy: RetryPolicy;
  /** Current state. */
  state: JobState;
  /** Attempt count. */
  attempts: number;
  /** Last error (if any). */
  lastError?: string;
  /** Created at. */
  createdAt: number;
  /** Last executed at. */
  lastExecutedAt?: number;
  /** Result of the last execution. */
  lastResult?: { success: boolean; data?: unknown; error?: string };
}

/** Job state. */
export type JobState = 'pending' | 'running' | 'completed' | 'failed' | 'dead-lettered';

/** Retry policy. */
export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;          // initial backoff
  backoffMultiplier: number;  // exponential multiplier
  maxBackoffMs: number;       // cap
}

/** Default retry policy. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
  maxBackoffMs: 30_000,
};

/** A dead-letter entry (job that exhausted retries). */
export interface DeadLetterEntry {
  jobId: string;
  operation: string;
  body: Record<string, unknown>;
  error: string;
  attempts: number;
  deadLetteredAt: number;
}

// ─── Scheduling Engine ──────────────────────────────────────────────────────

/** The dispatch handler for scheduled jobs (same as API Gateway's). */
export type ScheduledDispatchHandler = (operation: string, body: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }>;

/**
 * SchedulingEngine — time-based execution.
 * Uses the Runtime Clock (not Date.now()). Dispatches through the same runtime path.
 */
export class SchedulingEngine {
  private jobs: Map<string, ScheduledJob> = new Map();
  private deadLetters: DeadLetterEntry[] = [];
  private clock: RuntimeClock;

  constructor(clock: RuntimeClock) {
    this.clock = clock;
  }

  /** Schedule a one-shot job. */
  schedule(params: {
    operation: string;
    body: Record<string, unknown>;
    scheduledFor: number;
    retryPolicy?: RetryPolicy;
  }): string {
    const id = `job_${this.clock.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const job: ScheduledJob = {
      id,
      operation: params.operation,
      body: params.body,
      scheduledFor: params.scheduledFor,
      retryPolicy: params.retryPolicy ?? DEFAULT_RETRY_POLICY,
      state: 'pending',
      attempts: 0,
      createdAt: this.clock.now(),
    };
    this.jobs.set(id, job);
    return id;
  }

  /** Schedule a recurring job. */
  scheduleRecurring(params: {
    operation: string;
    body: Record<string, unknown>;
    intervalMs: number;
    retryPolicy?: RetryPolicy;
  }): string {
    const id = this.schedule({
      operation: params.operation,
      body: params.body,
      scheduledFor: this.clock.now() + params.intervalMs,
      retryPolicy: params.retryPolicy,
    });
    const job = this.jobs.get(id)!;
    job.intervalMs = params.intervalMs;
    return id;
  }

  /** Cancel a scheduled job. */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.state = 'completed'; // mark as done so it won't execute
    return true;
  }

  /**
   * Process due jobs. Called on each clock tick.
   * Dispatches through the same runtime path as API requests.
   */
  async processDue(dispatch: ScheduledDispatchHandler): Promise<{ processed: number; succeeded: number; failed: number; deadLettered: number }> {
    const now = this.clock.now();
    let processed = 0, succeeded = 0, failed = 0, deadLettered = 0;

    for (const job of this.jobs.values()) {
      if (job.state !== 'pending') continue;
      if (job.scheduledFor > now) continue;

      // Execute the job.
      job.state = 'running';
      job.attempts++;
      processed++;

      try {
        const result = await dispatch(job.operation, job.body);
        job.lastExecutedAt = now;
        job.lastResult = result;

        if (result.success) {
          job.state = 'completed';
          succeeded++;

          // If recurring, schedule the next execution.
          if (job.intervalMs) {
            job.state = 'pending';
            job.scheduledFor = now + job.intervalMs;
          }
        } else {
          throw new Error(result.error ?? 'Job failed');
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        job.lastError = error;
        failed++;

        // Check if we should retry.
        if (job.attempts < job.retryPolicy.maxAttempts) {
          // Exponential backoff.
          const backoff = Math.min(
            job.retryPolicy.backoffMs * Math.pow(job.retryPolicy.backoffMultiplier, job.attempts - 1),
            job.retryPolicy.maxBackoffMs,
          );
          job.state = 'pending';
          job.scheduledFor = now + backoff;
        } else {
          // Dead-letter.
          job.state = 'dead-lettered';
          deadLettered++;
          this.deadLetters.push({
            jobId: job.id,
            operation: job.operation,
            body: job.body,
            error,
            attempts: job.attempts,
            deadLetteredAt: now,
          });
        }
      }
    }

    return { processed, succeeded, failed, deadLettered };
  }

  /** Get all jobs. */
  listJobs(): ScheduledJob[] {
    return [...this.jobs.values()];
  }

  /** Get a specific job. */
  getJob(jobId: string): ScheduledJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  /** Get dead-lettered jobs. */
  getDeadLetters(): DeadLetterEntry[] {
    return [...this.deadLetters];
  }

  /** Replay a dead-lettered job (resets attempts + state). */
  replayDeadLetter(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.state !== 'dead-lettered') return false;
    job.state = 'pending';
    job.attempts = 0;
    job.scheduledFor = this.clock.now();
    job.lastError = undefined;
    // Remove from dead letters.
    this.deadLetters = this.deadLetters.filter((d) => d.jobId !== jobId);
    return true;
  }
}
