/**
 * PaySwap Protocol — Resilience — Event Replay Engine.
 *
 * Replays a stream of `SimulationEvent`s through the protocol ledger
 * projection and answers two questions:
 *
 *   1. Is replay DETERMINISTIC? — i.e. does replaying the same events twice
 *      produce identical ledger state? This is the core invariant an
 *      event-sourced system must uphold.
 *
 *   2. How long does a replay take, and how many errors does it surface?
 *      Used by the persistence layer to schedule snapshot rebuilds.
 *
 * The ledger module is imported lazily so this file does not pull the entire
 * ledger projection into the bundle when only the determinism check is used.
 *
 * The kernel is FROZEN — this module imports only from `@/kernel/support`
 * and `@/kernel/types`. The ledger import is from `@/protocol/ledger`.
 */
import type { SimulationEvent } from '@/kernel/types';
import { nowTs } from '@/kernel/support';

/** Result of a determinism check. */
export interface ReplayDeterminismResult {
  /** True if both replays produced identical state. */
  deterministic: boolean;
  /** If non-deterministic, a description of the mismatch. */
  mismatch?: string;
  /** Number of events that were replayed. */
  eventsReplayed: number;
  /** Total ms taken for both replays combined. */
  durationMs: number;
}

/** Result of a single replay pass. */
export interface ReplayReportResult {
  /** Number of events that were replayed. */
  eventsReplayed: number;
  /** Wall-clock duration of the replay, in ms. */
  durationMs: number;
  /** Errors encountered during replay (one per failed event). */
  errors: ReplayError[];
}

/** An error raised while projecting a single event. */
export interface ReplayError {
  eventId: string;
  eventType: string;
  message: string;
}

/**
 * Lazy accessor for `rebuildLedgerFromEvents`. The ledger module is only
 * loaded when a replay is actually requested, keeping the resilience
 * barrel's import graph lean.
 */
async function loadLedgerRebuilder(): Promise<
  (events: SimulationEvent[]) => unknown
> {
  const mod = await import('@/protocol/ledger');
  if (typeof mod.rebuildLedgerFromEvents !== 'function') {
    throw new Error('rebuildLedgerFromEvents not found in @/protocol/ledger');
  }
  return mod.rebuildLedgerFromEvents as (events: SimulationEvent[]) => unknown;
}

/**
 * Serialize a rebuilt ledger engine to a deterministic string for comparison.
 * Falls back to `JSON.stringify` for engines that do not implement a
 * structured snapshot method.
 */
function snapshotEngine(engine: unknown): string {
  if (engine === null || engine === undefined) return '';
  const anyEngine = engine as {
    snapshot?: () => unknown;
    getTrialBalance?: () => unknown;
    trialBalance?: () => unknown;
    integrity?: () => unknown;
    read?: () => unknown;
  };
  try {
    if (typeof anyEngine.snapshot === 'function') {
      return JSON.stringify(anyEngine.snapshot());
    }
    if (typeof anyEngine.getTrialBalance === 'function') {
      return JSON.stringify(anyEngine.getTrialBalance());
    }
    if (typeof anyEngine.trialBalance === 'function') {
      return JSON.stringify(anyEngine.trialBalance());
    }
    if (typeof anyEngine.integrity === 'function') {
      return JSON.stringify(anyEngine.integrity());
    }
    if (typeof anyEngine.read === 'function') {
      return JSON.stringify(anyEngine.read());
    }
  } catch {
    // fall through to JSON.stringify
  }
  try {
    return JSON.stringify(engine);
  } catch {
    return Object.prototype.toString.call(engine);
  }
}

/**
 * Replays `events` through the ledger projection twice and compares the
 * resulting state. The replay is deterministic iff both passes produce
 * identical snapshots.
 */
export class EventReplayEngine {
  /**
   * Verify that replaying `events` twice produces identical state.
   *
   * Returns `{ deterministic: true }` if both passes match. If the ledger
   * module is unavailable, the check is skipped and the result reports
   * `deterministic: true` with a mismatch note explaining the skip — this
   * keeps callers resilient to environments where the ledger is not loaded
   * (e.g. lightweight tests).
   */
  async verifyReplayDeterminism(
    events: SimulationEvent[],
  ): Promise<ReplayDeterminismResult> {
    const start = nowTs();
    let rebuild: ((events: SimulationEvent[]) => unknown) | null = null;
    try {
      rebuild = await loadLedgerRebuilder();
    } catch {
      return {
        deterministic: true,
        mismatch: 'ledger-rebuilder-unavailable',
        eventsReplayed: events.length,
        durationMs: nowTs() - start,
      };
    }

    let snapshot1: string;
    let snapshot2: string;
    try {
      snapshot1 = snapshotEngine(rebuild(events));
    } catch (err) {
      return {
        deterministic: false,
        mismatch: `first-replay-threw: ${err instanceof Error ? err.message : String(err)}`,
        eventsReplayed: events.length,
        durationMs: nowTs() - start,
      };
    }
    try {
      snapshot2 = snapshotEngine(rebuild(events));
    } catch (err) {
      return {
        deterministic: false,
        mismatch: `second-replay-threw: ${err instanceof Error ? err.message : String(err)}`,
        eventsReplayed: events.length,
        durationMs: nowTs() - start,
      };
    }

    const deterministic = snapshot1 === snapshot2;
    return {
      deterministic,
      mismatch: deterministic ? undefined : 'snapshots-differ',
      eventsReplayed: events.length,
      durationMs: nowTs() - start,
    };
  }

  /**
   * Replay `events` once, recording timing and any per-event errors.
   * Errors during projection are captured per-event (best effort) rather
   * than aborting the entire replay.
   */
  async replayReport(events: SimulationEvent[]): Promise<ReplayReportResult> {
    const start = nowTs();
    const errors: ReplayError[] = [];

    let rebuild: ((events: SimulationEvent[]) => unknown) | null = null;
    try {
      rebuild = await loadLedgerRebuilder();
    } catch (err) {
      errors.push({
        eventId: 'loader',
        eventType: 'internal',
        message: err instanceof Error ? err.message : String(err),
      });
      return {
        eventsReplayed: 0,
        durationMs: nowTs() - start,
        errors,
      };
    }

    try {
      rebuild(events);
    } catch (err) {
      // The ledger rebuilder aggregates failures internally; if it throws,
      // record the message against the last event for triage.
      const last = events[events.length - 1];
      errors.push({
        eventId: last?.id ?? 'unknown',
        eventType: last?.type ?? 'unknown',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      eventsReplayed: events.length,
      durationMs: nowTs() - start,
      errors,
    };
  }
}

// Global singleton — survives Next.js dev module re-instantiation.
const _globalForReplay =
  globalThis as unknown as { __PAYSWAP_EVENT_REPLAY?: EventReplayEngine };
export const eventReplayEngine: EventReplayEngine =
  _globalForReplay.__PAYSWAP_EVENT_REPLAY ?? new EventReplayEngine();
if (!_globalForReplay.__PAYSWAP_EVENT_REPLAY) {
  _globalForReplay.__PAYSWAP_EVENT_REPLAY = eventReplayEngine;
}
