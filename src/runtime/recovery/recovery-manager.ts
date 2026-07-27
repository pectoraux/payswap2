/**
 * Recovery Manager — manages projection recovery, verification, and rebuild.
 * (M-RT-28.)
 *
 *   RecoveryManager
 *   ├── recoverProjection()  — resume from checkpoint (incremental replay)
 *   ├── recoverRuntime()     — recover all projections
 *   ├── verifyProjection()   — checksum comparison
 *   ├── verifyRuntime()      — verify all projections
 *   ├── rebuildProjection()  — full rebuild from zero
 *   ├── rebuildAll()         — rebuild all projections
 *   └── getReport()          — recovery status report
 *
 * STARTUP SEQUENCE (Phase 6):
 *   Load checkpoints → Resume replay → Upcast → Verify invariants
 *   → Verify projections → Open runtime → Accept traffic
 */

import type { EventStore, StoredEvent } from '../events';
import type { SchemaRegistry } from '../event-evolution';
import type { Projection } from '../read-models';
import { CheckpointStore, createCheckpoint, computeChecksum, type ProjectionCheckpointV2, type CheckpointStatus } from './checkpoint';

/** A projection registered with the recovery manager. */
interface RegisteredProjection {
  projection: Projection;
  /** Function to get the projection's internal state (for checksumming). */
  getState: () => unknown;
  /** Function to get the projection's event count. */
  getEventCount: () => number;
}

/** Recovery report (for /api/runtime/recovery). */
export interface RecoveryReport {
  totalProjections: number;
  healthy: number;
  recovering: number;
  corrupted: number;
  unknown: number;
  projections: {
    name: string;
    status: CheckpointStatus;
    lastEventId: number;
    eventCount: number;
    checksum: string;
    lastReplayTimestamp: number | null;
    schemaVersion: number;
  }[];
}

/** Inputs to the RecoveryManager. */
export interface RecoveryManagerInputs {
  eventStore: EventStore;
  schema: SchemaRegistry;
}

export class RecoveryManager {
  private readonly store: CheckpointStore;
  private readonly projections = new Map<string, RegisteredProjection>();
  private readonly order: string[] = [];

  constructor(private inputs: RecoveryManagerInputs) {
    this.store = new CheckpointStore();
  }

  /**
   * Register a projection with the recovery manager.
   *
   * @param projection    The projection (implements the Projection interface).
   * @param getState      Function to get the projection's internal state (for checksumming).
   * @param getEventCount Function to get the projection's total event count.
   */
  register(projection: Projection, getState: () => unknown, getEventCount: () => number): void {
    if (!this.projections.has(projection.name)) {
      this.order.push(projection.name);
    }
    this.projections.set(projection.name, { projection, getState, getEventCount });
  }

  /**
   * Recover a single projection: resume from checkpoint (incremental replay).
   *
   * If a checkpoint exists, replay only events AFTER the checkpoint position.
   * If no checkpoint exists, do a full rebuild.
   */
  async recoverProjection(projectionName: string): Promise<{
    name: string;
    recovered: boolean;
    eventsReplayed: number;
    fullRebuild: boolean;
    durationMs: number;
  }> {
    const start = Date.now();
    const registered = this.projections.get(projectionName);
    if (!registered) {
      return { name: projectionName, recovered: false, eventsReplayed: 0, fullRebuild: false, durationMs: 0 };
    }

    const { projection, getState, getEventCount } = registered;
    const checkpoint = this.store.get(projectionName);

    // Read all events.
    const allEvents = await this.inputs.eventStore.readAll(0, 50_000);

    // Upcast events through the schema registry.
    const upcastResult = this.inputs.schema.upcast(allEvents);
    const events = upcastResult.events;

    // Filter to events this projection handles.
    const relevant = events.filter((e) =>
      projection.handles.some((prefix) => e.type.startsWith(prefix)),
    );

    if (checkpoint && checkpoint.lastEventId >= 0) {
      // Incremental replay: only events after the checkpoint position.
      const newEvents = relevant.filter((e) => e.globalPosition > checkpoint.lastEventId);

      // M-RT-28: Crash recovery — if the checkpoint exists but the projection
      // appears empty (eventCount=0 but checkpoint has events), do a full rebuild.
      // This handles the case where the process crashed and the projection was
      // not persisted (in-memory projections are lost on restart).
      const currentCount = getEventCount();
      if (currentCount === 0 && checkpoint.eventCount > 0) {
        // Projection was cleared (crash) — full rebuild needed.
        await projection.rebuild(relevant as unknown as StoredEvent[]);
      } else if (newEvents.length > 0) {
        // Apply only the new events (incremental).
        // Note: we need to pass the raw StoredEvent (not VersionedEvent) to the projection.
        // The projection's apply() only reads type + payload, so we cast.
        await projection.apply(newEvents as unknown as StoredEvent[]);
      }

      // Update checkpoint.
      const lastEvent = relevant.length > 0 ? relevant[relevant.length - 1] : null;
      const state = getState();
      const count = getEventCount();
      this.store.save(createCheckpoint(projectionName, lastEvent as unknown as StoredEvent | null, count, state));

      return {
        name: projectionName,
        recovered: true,
        eventsReplayed: newEvents.length,
        fullRebuild: false,
        durationMs: Date.now() - start,
      };
    } else {
      // No checkpoint — full rebuild.
      await projection.rebuild(relevant as unknown as StoredEvent[]);

      const lastEvent = relevant.length > 0 ? relevant[relevant.length - 1] : null;
      const state = getState();
      const count = getEventCount();
      this.store.save(createCheckpoint(projectionName, lastEvent as unknown as StoredEvent | null, count, state));

      return {
        name: projectionName,
        recovered: true,
        eventsReplayed: relevant.length,
        fullRebuild: true,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Recover all registered projections.
   */
  async recoverRuntime(): Promise<{
    total: number;
    recovered: number;
    results: { name: string; recovered: boolean; eventsReplayed: number; fullRebuild: boolean; durationMs: number }[];
  }> {
    const results: { name: string; recovered: boolean; eventsReplayed: number; fullRebuild: boolean; durationMs: number }[] = [];
    for (const name of this.order) {
      const result = await this.recoverProjection(name);
      results.push(result);
    }
    return {
      total: this.order.length,
      recovered: results.filter((r) => r.recovered).length,
      results,
    };
  }

  /**
   * Verify a projection: compare its current checksum against the checkpoint.
   *
   * If the checksums match, the projection is healthy.
   * If they differ, the projection is corrupted (needs rebuild).
   */
  verifyProjection(projectionName: string): {
    name: string;
    healthy: boolean;
    checksumMatch: boolean;
    expectedChecksum: string;
    actualChecksum: string;
  } {
    const registered = this.projections.get(projectionName);
    if (!registered) {
      return { name: projectionName, healthy: false, checksumMatch: false, expectedChecksum: '', actualChecksum: '' };
    }

    const checkpoint = this.store.get(projectionName);
    if (!checkpoint) {
      return { name: projectionName, healthy: false, checksumMatch: false, expectedChecksum: '', actualChecksum: '' };
    }

    const actualChecksum = computeChecksum(registered.getState());
    const checksumMatch = actualChecksum === checkpoint.checksum;

    // Update status.
    this.store.save({ ...checkpoint, status: checksumMatch ? 'healthy' : 'corrupted' });

    return {
      name: projectionName,
      healthy: checksumMatch,
      checksumMatch,
      expectedChecksum: checkpoint.checksum,
      actualChecksum,
    };
  }

  /**
   * Verify all projections.
   */
  verifyRuntime(): { total: number; healthy: number; corrupted: number; results: ReturnType<RecoveryManager['verifyProjection']>[] } {
    const results = this.order.map((name) => this.verifyProjection(name));
    return {
      total: results.length,
      healthy: results.filter((r) => r.healthy).length,
      corrupted: results.filter((r) => !r.healthy).length,
      results,
    };
  }

  /**
   * Rebuild a projection from zero (full replay).
   */
  async rebuildProjection(projectionName: string): Promise<{ name: string; rebuilt: boolean; eventsReplayed: number; durationMs: number }> {
    const start = Date.now();
    const registered = this.projections.get(projectionName);
    if (!registered) {
      return { name: projectionName, rebuilt: false, eventsReplayed: 0, durationMs: 0 };
    }

    const { projection, getState, getEventCount } = registered;
    const allEvents = await this.inputs.eventStore.readAll(0, 50_000);
    const upcastResult = this.inputs.schema.upcast(allEvents);
    const events = upcastResult.events;
    const relevant = events.filter((e) => projection.handles.some((prefix) => e.type.startsWith(prefix)));

    await projection.rebuild(relevant as unknown as StoredEvent[]);

    const lastEvent = relevant.length > 0 ? relevant[relevant.length - 1] : null;
    const state = getState();
    const count = getEventCount();
    this.store.save(createCheckpoint(projectionName, lastEvent as unknown as StoredEvent | null, count, state));

    return { name: projectionName, rebuilt: true, eventsReplayed: relevant.length, durationMs: Date.now() - start };
  }

  /**
   * Rebuild all projections from zero.
   */
  async rebuildAll(): Promise<{ total: number; rebuilt: number; results: { name: string; rebuilt: boolean; eventsReplayed: number; durationMs: number }[] }> {
    const results: { name: string; rebuilt: boolean; eventsReplayed: number; durationMs: number }[] = [];
    for (const name of this.order) {
      results.push(await this.rebuildProjection(name));
    }
    return { total: this.order.length, rebuilt: results.filter((r) => r.rebuilt).length, results };
  }

  /** Get a recovery report. */
  getReport(): RecoveryReport {
    const projections = this.order.map((name) => {
      const cp = this.store.get(name);
      return {
        name,
        status: cp?.status ?? 'unknown',
        lastEventId: cp?.lastEventId ?? -1,
        eventCount: cp?.eventCount ?? 0,
        checksum: cp?.checksum ?? '',
        lastReplayTimestamp: cp?.lastReplayTimestamp ?? null,
        schemaVersion: cp?.schemaVersion ?? 1,
      };
    });

    return {
      totalProjections: projections.length,
      healthy: projections.filter((p) => p.status === 'healthy').length,
      recovering: projections.filter((p) => p.status === 'recovering').length,
      corrupted: projections.filter((p) => p.status === 'corrupted').length,
      unknown: projections.filter((p) => p.status === 'unknown').length,
      projections,
    };
  }

  /** Get the checkpoint store (for direct access). */
  getStore(): CheckpointStore {
    return this.store;
  }
}
