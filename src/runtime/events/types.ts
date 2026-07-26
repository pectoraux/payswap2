/**
 * Runtime Events — Domain vs Runtime. (Vocabulary: Event.)
 *
 * Domain Events affect business state and are replayed to rebuild aggregates
 * and read models. Runtime Events are operational side-effects, retained for
 * inspection/ops but NOT replayed to rebuild business state.
 *
 * Two logical streams per aggregate: domain:<id> (source of truth) and
 * runtime:<id> (operational, independently prunable). The global log
 * preserves total order.
 */

import type { Environment } from '../types';

export type EventKind = 'domain' | 'runtime';

/** An event before it is stored (no id/version/position yet). */
export interface UncommittedEvent {
  type: string;
  streamId: string;
  streamType: string;
  kind: EventKind;
  payload: Record<string, unknown>;
}

/** An event after it is stored — immutable, with position + metadata. */
export interface StoredEvent {
  id: string;
  streamId: string;
  streamType: string;
  version: number;            // per-stream, monotonic (for optimistic concurrency)
  globalPosition: number;     // global log order
  type: string;
  kind: EventKind;
  payload: Record<string, unknown>;
  metadata: {
    intentId: string;
    correlationId: string;
    actor: string;
    environment: Environment;
    timestamp: number;        // Runtime Clock time
  };
}

/** Metadata attached at append time. */
export interface AppendMetadata {
  intentId: string;
  correlationId: string;
  actor: string;
  environment: Environment;
  timestamp: number;
}

export interface AppendResult {
  /** First global position written. */
  fromPosition: number;
  /** Last global position written. */
  toPosition: number;
  /** Versions of the streams after append (streamId → new version). */
  streamVersions: Map<string, number>;
  /** The stored events. */
  events: StoredEvent[];
}

/** A handler invoked synchronously when events are appended (drives projections). */
export type EventSubscriber = (events: StoredEvent[]) => void | Promise<void>;
