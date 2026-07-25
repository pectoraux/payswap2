/**
 * PaySwap Protocol — Resilience / Event Replay Engine.
 * -----------------------------------------------------------------------------
 * The EventReplayEngine replays a slice of the event stream through a target
 * projection. This is the foundation of disaster recovery:
 *
 *   - Ledger rebuild:        replay all events → produce a fresh ledger
 *                             (used after db corruption, or for verification)
 *   - Projection rebuild:    replay events → re-derive merchant / LP / wallet
 *                             state (used when a projection is corrupted)
 *   - Webhook re-fire:       replay events in a time range → re-fire webhooks
 *                             for events that were missed (e.g. during an
 *                             outage of the webhook engine)
 *   - Audit re-derive:       replay events → re-derive the audit log
 *
 * DETERMINISM INVARIANT: replaying the same events through the same target
 * MUST produce identical projections every time. `verifyReplayDeterminism`
 * runs the replay TWICE and compares outputs — any mismatch is a bug.
 *
 * The engine delegates the actual projection logic to caller-supplied
 * functions (`rebuildFn`, `replayFn`). For the ledger target, the default
 * rebuild function is `rebuildLedgerFromEvents` from the ledger module.
 *
 * INVARIANTS:
 *   - Replay is deterministic — same events → same output.
 *   - Replay is idempotent — replaying the same events multiple times does
 *     not corrupt state (projections are rebuilt into fresh instances).
 *   - Replay is auditable — every replay produces a `ReplayReport` with
 *     counts, duration, and errors.
 */
import type { SimulationEvent } from '@/kernel/types';

/** Replay target types. */
export type ReplayTargetType = 'ledger' | 'projection' | 'webhook' | 'audit';

/** A replay target — what to replay through, and over what time range. */
export interface ReplayTarget {
  type: ReplayTargetType;
  fromTs: number;
  toTs: number;
  /** Optional event-type filter (e.g. only replay 'ledger.*' events). */
  filter?: {
    eventTypes?: string[];
  };
}

/** Summary report for a replay run. */
export interface ReplayReport {
  target: ReplayTargetType;
  eventsReplayed: number;
  durationMs: number;
  errors: Array<{ eventId: string; eventType: string; error: string }>;
  /** Optional output — for ledger rebuilds, this is a trial-balance summary. */
  output?: unknown;
}

/** Determinism check result. */
export interface DeterminismResult {
  deterministic: boolean;
  /** If not deterministic, a description of the mismatch. */
  mismatch?: string;
  /** The two outputs compared. */
  run1?: unknown;
  run2?: unknown;
}

/**
 * Event replay engine. Delegates projection logic to caller-supplied
 * functions so it can be used for ledger, webhook, audit, or any custom
 * projection without coupling.
 */
export class EventReplayEngine {
  /**
   * Replay a slice of the event stream through a target.
   *
   * @param target     The replay target (type + time range + optional filter).
   * @param events     The full event stream (will be filtered by target).
   * @param replayFn   Caller-supplied: (event, ctx) → void. Called once per
   *                   event in the slice. `ctx` is a per-replay context object
   *                   (fresh for each replay run).
   * @param finalizeFn Caller-supplied: (ctx) → unknown. Called at the end of
   *                   the replay to produce the output (e.g. the rebuilt
   *                   ledger's trial balance). Default: returns ctx.
   * @param initCtxFn  Caller-supplied: () → ctx. Creates a fresh context.
   *                   Default: returns `{}`.
   */
  replay<TCtx = Record<string, unknown>, TOut = unknown>(
    target: ReplayTarget,
    events: SimulationEvent[],
    replayFn: (event: SimulationEvent, ctx: TCtx) => void,
    finalizeFn?: (ctx: TCtx) => TOut,
    initCtxFn?: () => TCtx,
  ): ReplayReport {
    const start = Date.now();
    const ctx = initCtxFn ? initCtxFn() : ({} as TCtx);
    const slice = this.filterEvents(target, events);
    const errors: ReplayReport['errors'] = [];
    for (const event of slice) {
      try {
        replayFn(event, ctx);
      } catch (err) {
        errors.push({
          eventId: event.id,
          eventType: event.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const output = finalizeFn ? finalizeFn(ctx) : (ctx as unknown as TOut);
    return {
      target: target.type,
      eventsReplayed: slice.length,
      durationMs: Date.now() - start,
      errors,
      output,
    };
  }

  /**
   * Replay from a snapshot — fast-forward by restoring a snapshot and then
   * replaying only the post-snapshot events.
   *
   * @param target        The replay target.
   * @param snapshotTs    The snapshot timestamp.
   * @param events        The full event stream.
   * @param restoreFn     Restores the snapshot into a fresh ctx.
   * @param replayFn      Replays an event into the ctx.
   * @param finalizeFn    Produces the output from the ctx.
   */
  replayFromSnapshot<TCtx, TOut>(
    target: ReplayTarget,
    snapshotTs: number,
    events: SimulationEvent[],
    restoreFn: () => TCtx,
    replayFn: (event: SimulationEvent, ctx: TCtx) => void,
    finalizeFn?: (ctx: TCtx) => TOut,
  ): { report: ReplayReport; snapshotTs: number; replayedCount: number } {
    // Override fromTs to be strictly after the snapshot.
    const effectiveTarget: ReplayTarget = {
      ...target,
      fromTs: Math.max(target.fromTs, snapshotTs + 1),
    };
    const start = Date.now();
    const ctx = restoreFn();
    const slice = this.filterEvents(effectiveTarget, events);
    const errors: ReplayReport['errors'] = [];
    for (const event of slice) {
      try {
        replayFn(event, ctx);
      } catch (err) {
        errors.push({
          eventId: event.id,
          eventType: event.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const output = finalizeFn ? finalizeFn(ctx) : (ctx as unknown as TOut);
    const report: ReplayReport = {
      target: target.type,
      eventsReplayed: slice.length,
      durationMs: Date.now() - start,
      errors,
      output,
    };
    return { report, snapshotTs, replayedCount: slice.length };
  }

  /**
   * Verify replay determinism — replay the same events twice and compare
   * outputs. Returns `{ deterministic: true }` if both runs produce identical
   * output, otherwise `{ deterministic: false, mismatch }`.
   *
   * The comparison uses canonical JSON (sorted keys) so property-order
   * differences don't cause false mismatches.
   */
  verifyReplayDeterminism<TCtx, TOut>(
    target: ReplayTarget,
    events: SimulationEvent[],
    replayFn: (event: SimulationEvent, ctx: TCtx) => void,
    finalizeFn: (ctx: TCtx) => TOut,
    initCtxFn: () => TCtx,
  ): DeterminismResult {
    const run1 = this.replay(target, events, replayFn, finalizeFn, initCtxFn);
    const run2 = this.replay(target, events, replayFn, finalizeFn, initCtxFn);
    const out1 = canonicalize(run1.output);
    const out2 = canonicalize(run2.output);
    if (out1 === out2) {
      return { deterministic: true, run1: run1.output, run2: run2.output };
    }
    return {
      deterministic: false,
      mismatch: `Replay outputs differ. Run1 length=${out1.length}, Run2 length=${out2.length}. First diff at index ${firstDiff(out1, out2)}.`,
      run1: run1.output,
      run2: run2.output,
    };
  }

  /**
   * Convenience: produce a replay report (counts, duration, errors) without
   * needing to specify all the function params. The caller still supplies
   * `replayFn` + `finalizeFn`.
   */
  replayReport<TCtx, TOut>(
    target: ReplayTarget,
    events: SimulationEvent[],
    replayFn: (event: SimulationEvent, ctx: TCtx) => void,
    finalizeFn: (ctx: TCtx) => TOut,
    initCtxFn?: () => TCtx,
  ): ReplayReport {
    return this.replay(target, events, replayFn, finalizeFn, initCtxFn);
  }

  // ─── internal ────────────────────────────────────────────────────────────

  /** Filter events by the target's time range + optional event-type filter. */
  private filterEvents(target: ReplayTarget, events: SimulationEvent[]): SimulationEvent[] {
    let slice = events.filter(
      (e) => e.ts >= target.fromTs && e.ts <= target.toTs,
    );
    if (target.filter?.eventTypes && target.filter.eventTypes.length > 0) {
      const types = new Set(target.filter.eventTypes);
      slice = slice.filter((e) =>
        types.some((t) => t.endsWith('.') ? e.type.startsWith(t) : e.type === t),
      );
    }
    // Stable sort: by ts asc, then frame asc, then id asc — for determinism.
    return [...slice].sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      if ((a.frame ?? 0) !== (b.frame ?? 0)) return (a.frame ?? 0) - (b.frame ?? 0);
      return a.id.localeCompare(b.id);
    });
  }
}

/** Canonical JSON string (sorted keys, no whitespace). */
function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  if (typeof value === 'object' && value !== undefined) {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const pairs = keys.map(
      (k) => JSON.stringify(k) + ':' + canonicalize((value as Record<string, unknown>)[k]),
    );
    return '{' + pairs.join(',') + '}';
  }
  return 'null';
}

/** Find the first index where two strings differ. */
function firstDiff(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  return len;
}

/** Singleton event replay engine. */
export const eventReplayEngine = new EventReplayEngine();
