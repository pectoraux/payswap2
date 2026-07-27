/**
 * Runtime Events — Domain vs Runtime. (M-RT-1 foundation.)
 *
 * Domain Events affect business state and are replayed to rebuild aggregates
 * and read models. Runtime Events are operational side-effects, retained for
 * inspection/ops but NOT replayed to rebuild business state.
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
    timestamp: number;
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
  fromPosition: number;
  toPosition: number;
  streamVersions: Map<string, number>;
  events: StoredEvent[];
}

/** A handler invoked synchronously when events are appended (drives projections). */
export type EventSubscriber = (events: StoredEvent[]) => void | Promise<void>;
