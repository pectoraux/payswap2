/**
 * Event Store — the immutable source of truth. (Principle 5: Event Truth.)
 *
 * ── P3-2 (H-3) consolidation: PostgresEventStore is now the CANONICAL ────
 *
 *   This file retains the `EventStore` INTERFACE (the type contract every
 *   store implements) plus the `OptimisticConcurrencyError` class. The
 *   `InMemoryEventStore` class is kept ONLY as a dev/test fallback and logs
 *   a LOUD warning on every append when no DATABASE_URL is configured. In
 *   production (`NODE_ENV=production`), `createRuntime()` refuses to use it
 *   — see `src/runtime/index.ts`.
 *
 *   The authoritative writer is `src/runtime/events/postgres-event-store.ts`.
 *   All money-path events flow through it and are persisted to Postgres with
 *   a DB-enforced `@@unique([streamId, version])` constraint (P3-1).
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
  /** Append events to one or more streams. Rejects if expectedVersion is stale. */
  append(
    events: UncommittedEvent[],
    expectedVersions: Map<string, number>,
    meta: AppendMetadata,
  ): Promise<AppendResult>;

  /** Read all events for a stream, optionally from a version. */
  readStream(streamId: string, fromVersion?: number): Promise<StoredEvent[]>;

  /** Read the global log from a position. */
  readAll(fromPosition: number, limit: number): Promise<StoredEvent[]>;

  /** Current version of a stream (or undefined if it doesn't exist). */
  streamVersion(streamId: string): number | undefined;

  /** Total events in the global log. */
  size(): number;

  /** Subscribe to appended events (synchronous, drives projections). */
  subscribe(subscriber: EventSubscriber): () => void;
}

/**
 * InMemoryEventStore — DEPRECATED dev/test fallback.
 *
 * P3-2 (H-3): This class is NOT used in production. `createRuntime()` in
 * `src/runtime/index.ts` selects `PostgresEventStore` when `DATABASE_URL`
 * points at a real Postgres instance; when no DB is configured, it logs a
 * LOUD warning and (in `NODE_ENV=production`) refuses to start.
 *
 * The class is retained for:
 *   - Local dev without a database
 *   - Unit tests that don't want to spin up Postgres
 *   - The sandbox/twin runtime (which deliberately never touches real money)
 *
 * It performs OCC via an in-process `Map` — that is acceptable ONLY because
 * no real money ever flows through it. The Postgres-backed OCC check
 * (`@@unique([streamId, version])`) is the load-bearing guarantee.
 */
export class InMemoryEventStore implements EventStore {
  private global: StoredEvent[] = [];
  private versions: Map<string, number> = new Map();
  private subscribers: Set<EventSubscriber> = new Set();
  private loudWarned = false;

  constructor() {
    // P3-2: LOUD warning when this fallback is instantiated.
    const dbUrl = process.env.DATABASE_URL ?? '';
    const isProd = process.env.NODE_ENV === 'production';
    const hasPostgres = dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://');
    if (isProd && !hasPostgres) {
      // In production with no DB, this is a hard failure path. The runtime
      // factory in runtime/index.ts should have already thrown — this is a
      // belt-and-suspenders guard.
      console.error(
        '┌──────────────────────────────────────────────────────────────────┐\n' +
        '│ [P3-2] InMemoryEventStore instantiated in PRODUCTION with no    │\n' +
        '│ DATABASE_URL. This MUST NOT happen — money-path events would    │\n' +
        '│ be lost on process restart. Refusing to operate.                │\n' +
        '└──────────────────────────────────────────────────────────────────┘',
      );
      throw new Error(
        'InMemoryEventStore cannot be used in production without a Postgres DATABASE_URL (P3-2).',
      );
    }
    if (!hasPostgres) {
      console.warn(
        '┌──────────────────────────────────────────────────────────────────┐\n' +
        '│ [P3-2] Using InMemoryEventStore — no Postgres DATABASE_URL.     │\n' +
        '│ Acceptable for dev/tests ONLY. Money-path events will NOT be    │\n' +
        '│ durable across process restarts.                                │\n' +
        '└──────────────────────────────────────────────────────────────────┘',
      );
    }
  }

  async append(
    events: UncommittedEvent[],
    expectedVersions: Map<string, number>,
    meta: AppendMetadata,
  ): Promise<AppendResult> {
    if (events.length === 0) {
      return { fromPosition: this.global.length, toPosition: this.global.length - 1, streamVersions: new Map(this.versions), events: [] };
    }

    // Verify optimistic concurrency per stream (in-process — dev/test only).
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

    // Notify subscribers synchronously (immediate projection — Principle 5).
    for (const sub of this.subscribers) {
      await sub(stored);
    }

    return {
      fromPosition,
      toPosition: this.global.length - 1,
      streamVersions: new Map(this.versions),
      events: stored,
    };
  }

  async readStream(streamId: string, fromVersion = 0): Promise<StoredEvent[]> {
    return this.global.filter(
      (e) => e.streamId === streamId && e.version >= fromVersion,
    );
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

/** Thrown when an append's expectedVersion is stale (concurrent modification). */
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
