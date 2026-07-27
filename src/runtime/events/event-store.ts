/**
 * Event Store — the immutable source of truth. (M-RT-1 foundation.)
 *
 * The store is audit / replay / sim / debug / inspect source ONLY. Pages
 * never replay — they read read models, which projections update
 * IMMEDIATELY on append (the subscriber fires synchronously).
 *
 * This is the in-memory implementation. It maintains a global array (total
 * order) and a per-stream version counter. Optimistic concurrency: append
 * rejects if expectedVersions disagree.
 */

import type {
  AppendMetadata,
  AppendResult,
  EventSubscriber,
  StoredEvent,
  UncommittedEvent,
} from './types';
import { uid } from '../types';

export interface EventStore {
  append(
    events: UncommittedEvent[],
    expectedVersions: Map<string, number>,
    meta: AppendMetadata,
  ): Promise<AppendResult>;
  readStream(streamId: string, fromVersion?: number): Promise<StoredEvent[]>;
  readAll(fromPosition: number, limit: number): Promise<StoredEvent[]>;
  streamVersion(streamId: string): number | undefined;
  size(): number;
  subscribe(subscriber: EventSubscriber): () => void;
}

export class InMemoryEventStore implements EventStore {
  private global: StoredEvent[] = [];
  private versions: Map<string, number> = new Map();
  private subscribers: Set<EventSubscriber> = new Set();

  async append(
    events: UncommittedEvent[],
    expectedVersions: Map<string, number>,
    meta: AppendMetadata,
  ): Promise<AppendResult> {
    if (events.length === 0) {
      return { fromPosition: this.global.length, toPosition: this.global.length - 1, streamVersions: new Map(this.versions), events: [] };
    }

    for (const [streamId, expected] of expectedVersions) {
      const actual = this.versions.get(streamId);
      if (actual !== undefined && actual !== expected) {
        throw new OptimisticConcurrencyError(streamId, expected, actual);
      }
    }

    const stored: StoredEvent[] = [];
    const fromPosition = this.global.length;

    for (const ev of events) {
      const currentVersion = this.versions.get(ev.streamId) ?? -1;
      const nextVersion = currentVersion + 1;
      this.versions.set(ev.streamId, nextVersion);

      const record: StoredEvent = {
        id: uid('evt'),
        streamId: ev.streamId,
        streamType: ev.streamType,
        version: nextVersion,
        globalPosition: this.global.length,
        type: ev.type,
        kind: ev.kind,
        payload: ev.payload,
        metadata: {
          intentId: meta.intentId,
          correlationId: meta.correlationId,
          actor: meta.actor,
          environment: meta.environment,
          timestamp: meta.timestamp,
        },
      };
      this.global.push(record);
      stored.push(record);
    }

    for (const sub of this.subscribers) {
      await sub(stored);
    }

    return { fromPosition, toPosition: this.global.length - 1, streamVersions: new Map(this.versions), events: stored };
  }

  async readStream(streamId: string, fromVersion = 0): Promise<StoredEvent[]> {
    return this.global.filter((e) => e.streamId === streamId && e.version >= fromVersion);
  }

  async readAll(fromPosition: number, limit: number): Promise<StoredEvent[]> {
    return this.global.slice(fromPosition, fromPosition + limit);
  }

  streamVersion(streamId: string): number | undefined {
    return this.versions.get(streamId);
  }

  size(): number {
    return this.global.length;
  }

  subscribe(subscriber: EventSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }
}

export class OptimisticConcurrencyError extends Error {
  constructor(
    readonly streamId: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Optimistic concurrency conflict on stream "${streamId}": expected version ${expected}, actual ${actual}`);
    this.name = 'OptimisticConcurrencyError';
  }
}
