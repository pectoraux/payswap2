/**
 * PaySwap Protocol — Resilience — Dead Letter Queue.
 *
 * Messages that exhaust their retry budget land here for manual or automated
 * review. Each entry captures enough context to:
 *   - inspect what failed and why,
 *   - replay the message through `replayFn` once the underlying issue is
 *     resolved,
 *   - or discard it (with a reason) after deciding it is non-recoverable.
 *
 * The DLQ is in-memory; production deployments can swap this for a DB-backed
 * implementation behind the same interface.
 *
 * The kernel is FROZEN — this module imports only from `@/kernel/event` and
 * `@/kernel/support`.
 */
import { eventEngine } from '@/kernel/event';
import { uid, nowTs } from '@/kernel/support';

/** Lifecycle state of a DLQ entry. */
export type DeadLetterStatus = 'pending_review' | 'replayed' | 'discarded';

/** Error context recorded against a dead-lettered message. */
export interface DeadLetterError {
  /** Short machine code (e.g. `UPSTREAM_TIMEOUT`, `INVALID_PAYLOAD`). */
  code: string;
  /** Human-readable error message. */
  message: string;
  /** Number of attempts made before the message was dead-lettered. */
  attempts: number;
  /** ts of the most recent attempt. */
  lastAttemptTs: number;
}

/** A single dead-letter entry. */
export interface DeadLetterEntry {
  /** Unique DLQ id (e.g. `dlq_xxx`). */
  id: string;
  /** Name of the queue/topic the message originated from. */
  originalQueue: string;
  /** Original message id from the source queue, if known. */
  originalId: string | null;
  /** The original message payload (opaque to the DLQ). */
  payload: Record<string, unknown>;
  /** Error context recorded against the message. */
  error: DeadLetterError;
  /** ts of the first attempt for this message. */
  firstAttemptTs: number;
  /** ts the message entered the DLQ. */
  dlqAt: number;
  /** Current lifecycle state. */
  status: DeadLetterStatus;
  /** If discarded, the reason supplied to `discard()`. */
  discardReason?: string;
  /** If replayed, the ts the replay was attempted. */
  replayedAt?: number;
  /** If replayed, the outcome of the replay attempt. */
  replayOutcome?: { ok: true } | { ok: false; message: string };
}

/** Optional filter passed to `list()`. All fields are optional. */
export interface DeadLetterListFilter {
  originalQueue?: string;
  status?: DeadLetterStatus;
  /** If provided, only entries whose `error.code` matches are returned. */
  errorCode?: string;
}

/** Input shape for `push()` — the DLQ assigns the id and timestamps. */
export interface DeadLetterPushInput {
  originalQueue: string;
  originalId?: string | null;
  payload: Record<string, unknown>;
  error: Omit<DeadLetterError, 'lastAttemptTs'> & { lastAttemptTs?: number };
  firstAttemptTs?: number;
}

/**
 * In-memory dead-letter queue.
 *
 * Entries are append-only; status transitions are recorded in-place. The
 * `replay*` methods accept a caller-supplied async `replayFn` so the DLQ
 * itself stays decoupled from the original processing logic.
 */
export class DeadLetterQueue {
  private readonly entries = new Map<string, DeadLetterEntry>();
  private readonly order: string[] = [];

  /** Add a new entry to the DLQ. Returns the stored entry. */
  push(input: DeadLetterPushInput): DeadLetterEntry {
    const id = uid('dlq');
    const ts = nowTs();
    const entry: DeadLetterEntry = {
      id,
      originalQueue: input.originalQueue,
      originalId: input.originalId ?? null,
      payload: input.payload,
      error: {
        code: input.error.code,
        message: input.error.message,
        attempts: input.error.attempts,
        lastAttemptTs: input.error.lastAttemptTs ?? ts,
      },
      firstAttemptTs: input.firstAttemptTs ?? ts,
      dlqAt: ts,
      status: 'pending_review',
    };
    this.entries.set(id, entry);
    this.order.push(id);

    eventEngine.emit('resilience.dlq_entry', {
      id,
      originalQueue: entry.originalQueue,
      originalId: entry.originalId,
      errorCode: entry.error.code,
      attempts: entry.error.attempts,
      dlqAt: entry.dlqAt,
    });

    return entry;
  }

  /** List entries, optionally filtered. Returns a copy of each entry. */
  list(filter?: DeadLetterListFilter): DeadLetterEntry[] {
    const all = this.order.map((id) => this.entries.get(id)!).filter(Boolean);
    if (!filter) return all.map((e) => ({ ...e }));
    return all
      .filter((e) => {
        if (filter.originalQueue !== undefined && e.originalQueue !== filter.originalQueue) return false;
        if (filter.status !== undefined && e.status !== filter.status) return false;
        if (filter.errorCode !== undefined && e.error.code !== filter.errorCode) return false;
        return true;
      })
      .map((e) => ({ ...e }));
  }

  /** Fetch a single entry by id (or undefined). */
  get(id: string): DeadLetterEntry | undefined {
    const entry = this.entries.get(id);
    return entry ? { ...entry } : undefined;
  }

  /**
   * Replay a single entry through `replayFn`. On success the entry is marked
   * `replayed`; on failure the entry stays `pending_review` and the failure
   * is recorded on the entry.
   */
  async replay(
    id: string,
    replayFn: (entry: DeadLetterEntry) => Promise<void>,
  ): Promise<DeadLetterEntry | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    const replayedAt = nowTs();
    try {
      await replayFn({ ...entry });
      entry.status = 'replayed';
      entry.replayedAt = replayedAt;
      entry.replayOutcome = { ok: true };
    } catch (err) {
      entry.replayedAt = replayedAt;
      entry.replayOutcome = {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
      // Leave status as pending_review so it can be retried again.
    }
    return { ...entry };
  }

  /** Mark an entry as discarded with a human-readable reason. */
  discard(id: string, reason: string): DeadLetterEntry | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    entry.status = 'discarded';
    entry.discardReason = reason;
    return { ...entry };
  }

  /**
   * Replay every entry matching `queue` (or every pending entry if omitted)
   * through `replayFn`. Returns the entries that were attempted, with their
   * final state.
   */
  async replayAll(
    queue?: string,
    replayFn?: (entry: DeadLetterEntry) => Promise<void>,
  ): Promise<DeadLetterEntry[]> {
    if (!replayFn) return [];
    const candidates = this.list({ originalQueue: queue, status: 'pending_review' });
    const results: DeadLetterEntry[] = [];
    for (const candidate of candidates) {
      const updated = await this.replay(candidate.id, replayFn);
      if (updated) results.push(updated);
    }
    return results;
  }

  /** Number of entries currently in the DLQ. */
  size(): number {
    return this.entries.size;
  }

  /** Number of entries matching a status. */
  countByStatus(status: DeadLetterStatus): number {
    let n = 0;
    for (const entry of this.entries.values()) {
      if (entry.status === status) n += 1;
    }
    return n;
  }

  /** Remove every entry. */
  clear(): void {
    this.entries.clear();
    this.order.length = 0;
  }
}

// Global singleton — survives Next.js dev module re-instantiation.
const _globalForDLQ =
  globalThis as unknown as { __PAYSWAP_DLQ?: DeadLetterQueue };
export const deadLetterQueue: DeadLetterQueue =
  _globalForDLQ.__PAYSWAP_DLQ ?? new DeadLetterQueue();
if (!_globalForDLQ.__PAYSWAP_DLQ) {
  _globalForDLQ.__PAYSWAP_DLQ = deadLetterQueue;
}
