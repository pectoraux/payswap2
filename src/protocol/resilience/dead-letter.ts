/**
 * PaySwap Protocol — Resilience / Dead-Letter Queue.
 * -----------------------------------------------------------------------------
 * When a queue item (webhook delivery, payment, payout, settlement, connector
 * call) has been retried up to its max-attempts limit and STILL fails, it is
 * moved to the Dead-Letter Queue (DLQ). The DLQ is a persistent, auditable
 * store of last-resort items that require either:
 *
 *   - manual review (a human investigates + decides what to do)
 *   - replay (re-submit to the original queue, e.g. after the upstream recovers)
 *   - discard (permanently give up; audit-logged with a reason)
 *
 * Every DLQ entry has:
 *   - id, originalQueue, originalId, payload
 *   - error: { code, message, attempts, lastAttemptTs }
 *   - firstAttemptTs, lastAttemptTs, dlqAt
 *   - replayable: boolean (true if the operation can be safely retried)
 *   - status: 'pending_review' | 'replayed' | 'discarded'
 *
 * Emits `resilience.dlq_entry` on push, `resilience.dlq_replayed` on replay,
 * `resilience.dlq_discarded` on discard.
 *
 * The DLQ is in-memory; production would back this with a persistent table.
 *
 * INVARIANT: DLQ entries are auditable and replayable. Once `discarded`, an
 * entry can NEVER be replayed (the status is terminal). Once `replayed`, the
 * entry's status is updated but the entry is retained for audit.
 */
import { eventEngine } from '@/kernel/event';
import { uid } from '@/kernel/support';

/** Which queue the entry came from. */
export type DLQQueue =
  | 'webhook'
  | 'payment'
  | 'payout'
  | 'settlement'
  | 'connector';

/** Status of a DLQ entry. */
export type DLQStatus = 'pending_review' | 'replayed' | 'discarded';

/** Error info attached to a DLQ entry. */
export interface DLQError {
  code: string;
  message: string;
  attempts: number;
  lastAttemptTs: number;
}

/** A DLQ entry. */
export interface DeadLetterEntry {
  id: string;
  originalQueue: DLQQueue;
  originalId: string;
  payload: Record<string, unknown>;
  error: DLQError;
  firstAttemptTs: number;
  lastAttemptTs: number;
  dlqAt: number;
  replayable: boolean;
  status: DLQStatus;
  /** Free-form notes (e.g. discard reason, replay result). */
  notes?: string;
}

/** Filter for `list()`. */
export interface DLQFilter {
  queue?: DLQQueue;
  status?: DLQStatus;
  replayable?: boolean;
  since?: number;
  until?: number;
}

/**
 * In-memory dead-letter queue.
 */
export class DeadLetterQueue {
  private entries: Map<string, DeadLetterEntry> = new Map();

  /**
   * Push a failed-after-max-retries item into the DLQ.
   *
   * Emits `resilience.dlq_entry`.
   */
  push(entry: {
    originalQueue: DLQQueue;
    originalId: string;
    payload: Record<string, unknown>;
    error: DLQError;
    firstAttemptTs?: number;
    replayable?: boolean;
  }): DeadLetterEntry {
    const now = Date.now();
    const dlqEntry: DeadLetterEntry = {
      id: uid('dlq'),
      originalQueue: entry.originalQueue,
      originalId: entry.originalId,
      payload: entry.payload,
      error: entry.error,
      firstAttemptTs: entry.firstAttemptTs ?? entry.error.lastAttemptTs,
      lastAttemptTs: entry.error.lastAttemptTs,
      dlqAt: now,
      replayable: entry.replayable ?? true,
      status: 'pending_review',
    };
    this.entries.set(dlqEntry.id, dlqEntry);
    try {
      eventEngine.emit(
        'resilience.dlq_entry',
        {
          dlqId: dlqEntry.id,
          originalQueue: dlqEntry.originalQueue,
          originalId: dlqEntry.originalId,
          errorCode: dlqEntry.error.code,
          attempts: dlqEntry.error.attempts,
          replayable: dlqEntry.replayable,
          ts: now,
        },
        0,
      );
    } catch {
      // Best-effort.
    }
    return dlqEntry;
  }

  /** Get a DLQ entry by id. */
  get(id: string): DeadLetterEntry | undefined {
    return this.entries.get(id);
  }

  /** List DLQ entries (optionally filtered). */
  list(filter?: DLQFilter): DeadLetterEntry[] {
    let list = [...this.entries.values()];
    if (filter?.queue) list = list.filter((e) => e.originalQueue === filter.queue);
    if (filter?.status) list = list.filter((e) => e.status === filter.status);
    if (filter?.replayable != null) list = list.filter((e) => e.replayable === filter.replayable);
    if (filter?.since != null) list = list.filter((e) => e.dlqAt >= filter.since!);
    if (filter?.until != null) list = list.filter((e) => e.dlqAt <= filter.until!);
    return list.sort((a, b) => b.dlqAt - a.dlqAt);
  }

  /** Count of entries (optionally filtered by status). */
  depth(status?: DLQStatus): number {
    if (!status) return this.entries.size;
    return this.list({ status }).length;
  }

  /**
   * Replay a DLQ entry — re-submit to the original queue.
   *
   * `replayFn` is the caller-supplied re-submission function. It receives the
   * entry's payload and should re-enqueue it (e.g. call `webhookEngine.emit`,
   * `payoutService.request`, etc.). Return true on success, false on failure.
   *
   * On success, the entry's status becomes `replayed`.
   * On failure, the entry's status is unchanged (`pending_review`) — it can be
   * retried again later.
   */
  async replay(
    id: string,
    replayFn?: (entry: DeadLetterEntry) => Promise<boolean>,
  ): Promise<DeadLetterEntry> {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error(`DLQ entry not found: ${id}`);
    }
    if (entry.status === 'discarded') {
      throw new Error(`DLQ entry ${id} is discarded — cannot replay`);
    }
    if (!entry.replayable) {
      throw new Error(`DLQ entry ${id} is not replayable`);
    }
    if (!replayFn) {
      throw new Error(`No replayFn provided for DLQ entry ${id}`);
    }
    try {
      const ok = await replayFn(entry);
      if (ok) {
        entry.status = 'replayed';
        entry.notes = `Replayed at ${Date.now()}`;
        try {
          eventEngine.emit(
            'resilience.dlq_replayed',
            { dlqId: entry.id, originalQueue: entry.originalQueue, originalId: entry.originalId, ts: Date.now() },
            0,
          );
        } catch {
          // Best-effort.
        }
      } else {
        entry.notes = `Replay attempted at ${Date.now()} but replayFn returned false`;
      }
    } catch (err) {
      entry.notes = `Replay failed at ${Date.now()}: ${err instanceof Error ? err.message : String(err)}`;
    }
    return entry;
  }

  /** Permanently discard a DLQ entry. Audit-logged with `reason`. */
  discard(id: string, reason: string): DeadLetterEntry {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error(`DLQ entry not found: ${id}`);
    }
    entry.status = 'discarded';
    entry.notes = `Discarded: ${reason}`;
    try {
      eventEngine.emit(
        'resilience.dlq_discarded',
        { dlqId: entry.id, originalQueue: entry.originalQueue, originalId: entry.originalId, reason, ts: Date.now() },
        0,
      );
    } catch {
      // Best-effort.
    }
    return entry;
  }

  /**
   * Bulk-replay all entries matching the filter (default: all `pending_review`
   * entries). Returns the count of successfully replayed entries.
   */
  async replayAll(
    queue?: DLQQueue,
    replayFn?: (entry: DeadLetterEntry) => Promise<boolean>,
  ): Promise<{ attempted: number; succeeded: number; failed: number }> {
    const filter: DLQFilter = { status: 'pending_review', replayable: true };
    if (queue) filter.queue = queue;
    const entries = this.list(filter);
    let succeeded = 0;
    let failed = 0;
    for (const entry of entries) {
      try {
        const result = await this.replay(entry.id, replayFn);
        if (result.status === 'replayed') succeeded++;
        else failed++;
      } catch {
        failed++;
      }
    }
    return { attempted: entries.length, succeeded, failed };
  }

  /** Clear all entries (mainly for tests). */
  reset(): void {
    this.entries.clear();
  }
}

/** Singleton DLQ. */
export const deadLetterQueue = new DeadLetterQueue();

/**
 * Convenience helper: move a failed-after-max-retries item to the DLQ.
 *
 * Usage:
 *   if (delivery.attempts >= MAX_RETRIES && delivery.status === 'failed') {
 *     await moveToDLQ('webhook', delivery.id, delivery.payload, {
 *       code: 'webhook_delivery_failed',
 *       message: `Failed after ${delivery.attempts} attempts`,
 *       attempts: delivery.attempts,
 *       lastAttemptTs: delivery.lastAttemptAt ?? Date.now(),
 *     });
 *   }
 */
export function moveToDLQ(
  queue: DLQQueue,
  id: string,
  payload: Record<string, unknown>,
  error: DLQError,
  opts?: { firstAttemptTs?: number; replayable?: boolean },
): DeadLetterEntry {
  return deadLetterQueue.push({
    originalQueue: queue,
    originalId: id,
    payload,
    error,
    firstAttemptTs: opts?.firstAttemptTs,
    replayable: opts?.replayable,
  });
}
