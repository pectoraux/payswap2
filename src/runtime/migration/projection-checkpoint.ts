/**
 * ProjectionCheckpoint — snapshot a projection's state so replay is
 * proportional to events-since-last-snapshot, not events-since-beginning.
 * (M-RT-19, Capability Migration Framework.)
 *
 * PROBLEM:
 *   As the event log grows from 271 payments to 27 million, rebuilding the
 *   projection from zero on every restart becomes impractical. A projection
 *   that takes 1.2s to rebuild today would take 30+ hours at 27M events.
 *
 * SOLUTION:
 *   Periodically snapshot the projection's state at a specific global
 *   position. On restart, restore the snapshot, then replay only the events
 *   AFTER that position. Replay stays deterministic (same events → same
 *   state) but startup time is bounded by events-since-last-snapshot.
 *
 * M-RT-19: in-memory snapshots (lost on process restart). The architecture
 * is in place; a future milestone can persist snapshots to Prisma
 * (CheckpointRecord table) for true durability across restarts.
 *
 * USAGE:
 *   const checkpoint = new ProjectionCheckpoint('refunds', refundsService.projection);
 *   await checkpoint.snapshot(12345);  // snapshot at global position 12345
 *   const restored = checkpoint.restore();
 *   if (restored) {
 *     // Replay only events after position 12345.
 *     const recentEvents = await eventStore.readAll(12345 + 1, 50_000);
 *     await refundsService.projection.apply(recentEvents);
 *   } else {
 *     // No snapshot — full rebuild from zero.
 *     const allEvents = await eventStore.readAll(0, 50_000);
 *     await refundsService.projection.rebuild(allEvents);
 *   }
 */

import type { CheckpointSnapshot } from './types';

/**
 * The contract a projection must implement to support checkpointing.
 *
 * A checkpointable projection can serialize its state (for snapshot) and
 * replace its state (for restore). The state is opaque — the checkpoint
 * system just stores and retrieves it.
 */
export interface CheckpointableProjection {
  /** The projection's name (e.g. "payments", "refunds"). */
  readonly name: string;
  /** Serialize the projection's current state to an opaque blob. */
  serializeState(): unknown;
  /** Replace the projection's state from an opaque blob. */
  restoreState(state: unknown): void;
  /** Current global position the projection has processed. */
  checkpoint(): number;
}

/**
 * ProjectionCheckpoint — manages snapshots for one projection.
 *
 * One instance per projection. Held by the runtime container.
 */
export class ProjectionCheckpoint {
  private currentSnapshot: CheckpointSnapshot | null = null;

  constructor(
    private readonly projectionName: string,
    private readonly projection: CheckpointableProjection,
  ) {}

  /**
   * Take a snapshot of the projection's current state at the given global
   * position. Overwrites any previous snapshot.
   */
  async snapshot(globalPosition: number): Promise<CheckpointSnapshot> {
    this.currentSnapshot = {
      projection: this.projectionName,
      globalPosition,
      takenAt: Date.now(),
      state: this.projection.serializeState(),
    };
    return this.currentSnapshot;
  }

  /**
   * Restore the projection's state from the snapshot. Returns the global
   * position of the snapshot, or null if no snapshot exists.
   */
  restore(): { globalPosition: number } | null {
    if (!this.currentSnapshot) return null;
    this.projection.restoreState(this.currentSnapshot.state);
    return { globalPosition: this.currentSnapshot.globalPosition };
  }

  /** The current snapshot (or null). */
  current(): CheckpointSnapshot | null {
    return this.currentSnapshot;
  }

  /** Drop the snapshot (forces full rebuild on next restart). */
  clear(): void {
    this.currentSnapshot = null;
  }
}
