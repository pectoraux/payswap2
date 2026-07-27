/**
 * Projection Checkpoint V2 — persistent replay state. (M-RT-28.)
 *
 * Every projection persists its replay position so startup is proportional
 * to events-since-last-checkpoint, not events-since-beginning-of-time.
 *
 *   ProjectionCheckpointV2
 *   ├── projectionName
 *   ├── lastEventId          (global position)
 *   ├── lastStreamVersion    (per-stream version map)
 *   ├── lastReplayTimestamp  (when the checkpoint was taken)
 *   ├── eventCount           (total events processed)
 *   ├── checksum             (deterministic hash of projection state)
 *   ├── schemaVersion        (event schema version at checkpoint)
 *   ├── status               (healthy | recovering | corrupted | unknown)
 *   └── updatedAt
 */

import type { StoredEvent } from '../events';

export type CheckpointStatus = 'healthy' | 'recovering' | 'corrupted' | 'unknown';

export interface ProjectionCheckpointV2 {
  /** Projection name. */
  projectionName: string;
  /** Last global event position processed. */
  lastEventId: number;
  /** Last per-stream version (streamId → version). */
  lastStreamVersion: Map<string, number>;
  /** When the checkpoint was taken (epoch ms). */
  lastReplayTimestamp: number;
  /** Total events processed by this projection. */
  eventCount: number;
  /** Deterministic checksum of the projection state (for verification). */
  checksum: string;
  /** Event schema version at the time of the checkpoint. */
  schemaVersion: number;
  /** Checkpoint status. */
  status: CheckpointStatus;
  /** When the checkpoint was last updated (epoch ms). */
  updatedAt: number;
}

/**
 * CheckpointStore — holds checkpoints for all projections.
 *
 * M-RT-28: in-memory. A future milestone can persist to Prisma.
 */
export class CheckpointStore {
  private readonly checkpoints = new Map<string, ProjectionCheckpointV2>();

  /** Get the checkpoint for a projection (or null if none). */
  get(projectionName: string): ProjectionCheckpointV2 | null {
    return this.checkpoints.get(projectionName) ?? null;
  }

  /** Save a checkpoint (creates or updates). */
  save(checkpoint: ProjectionCheckpointV2): void {
    this.checkpoints.set(checkpoint.projectionName, { ...checkpoint, updatedAt: Date.now() });
  }

  /** Get all checkpoints. */
  all(): ProjectionCheckpointV2[] {
    return [...this.checkpoints.values()];
  }

  /** Clear a checkpoint (forces full rebuild on next startup). */
  clear(projectionName: string): void {
    this.checkpoints.delete(projectionName);
  }

  /** Clear all checkpoints. */
  clearAll(): void {
    this.checkpoints.clear();
  }

  /** Number of checkpoints. */
  count(): number {
    return this.checkpoints.size;
  }
}

/**
 * Compute a deterministic checksum for a projection's state.
 *
 * The checksum is a hash of the projection's serialized state.
 * If the projection is replayed from the same events, the checksum
 * should be identical (deterministic replay verification).
 */
export function computeChecksum(state: unknown): string {
  const json = JSON.stringify(state, (_key, value) => {
    // Sort Map entries for deterministic serialization.
    if (value instanceof Map) {
      return Object.fromEntries([...value.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))));
    }
    return value;
  });
  // Simple hash (not cryptographic — just for equality checking).
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    const char = json.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer.
  }
  return `chk_${Math.abs(hash).toString(36)}_${json.length.toString(36)}`;
}

/**
 * Create a checkpoint from the current projection state.
 */
export function createCheckpoint(
  projectionName: string,
  lastEvent: StoredEvent | null,
  eventCount: number,
  state: unknown,
  schemaVersion: number = 1,
): ProjectionCheckpointV2 {
  return {
    projectionName,
    lastEventId: lastEvent?.globalPosition ?? -1,
    lastStreamVersion: new Map(lastEvent ? [[lastEvent.streamId, lastEvent.version]] : []),
    lastReplayTimestamp: Date.now(),
    eventCount,
    checksum: computeChecksum(state),
    schemaVersion,
    status: 'healthy',
    updatedAt: Date.now(),
  };
}
