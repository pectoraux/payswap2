/**
 * PostgresEventStore — the CANONICAL event store backed by PostgreSQL.
 *
 * ── P3-1 (H-1) fix: DB-backed optimistic concurrency ──────────────────────
 *
 *   OCC is enforced AT THE DATABASE LEVEL by the `@@unique([streamId, version])`
 *   constraint on `EventRecord`. The append() flow is:
 *
 *     1. For each streamId touched by this append, read `MAX(version)` from DB.
 *     2. If the caller's expectedVersions disagree with the DB max, reject
 *        with OCCError (the caller has a stale view).
 *     3. Assign new event version = maxVersion + 1 (per stream).
 *     4. Insert rows. If two replicas race, the unique constraint makes
 *        exactly one of them fail with P2002 (unique violation).
 *     5. On P2002, re-read max(version), re-bump, retry — up to 3 times.
 *     6. If still failing, throw OCCError with a structured conflict report.
 *
 *   The in-process `versions` Map is now ONLY a read cache (for fast
 *   `streamVersion()` lookups). It is NEVER the authoritative version check.
 *   Two replicas can both pass an in-process check; only the DB constraint
 *   is load-bearing.
 *
 * ── P3-2 (H-3) fix: this is the ONE event store ──────────────────────────
 *
 *   The other two implementations have been consolidated:
 *     - `runtime/events/event-store.ts` keeps the `EventStore` interface
 *       + `OptimisticConcurrencyError`, but its `InMemoryEventStore` class
 *       is now a thin deprecated wrapper that logs a LOUD warning when used
 *       in production (no DATABASE_URL).
 *     - `protocol/persistence/event-store.ts` is a read-side facade +
 *       legacy pull-flush compatibility shim. Its writes have been removed;
 *       it delegates to this store's durable writes.
 *
 * Architecture:
 *   Dispatcher → PostgresEventStore.append() → DB COMMIT → notify subscribers
 *                                          ↓
 *                                   In-memory cache (disposable read cache)
 */

import type {
  AppendMetadata,
  AppendResult,
  EventSubscriber,
  StoredEvent,
  UncommittedEvent,
} from './types';
import { uid } from '../types';
import type { EventStore } from './event-store';
import { db } from '@/lib/db';

/** Prisma's well-known code for unique-constraint violation. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

/** Max retry attempts when a concurrent append wins the version race. */
const OCC_MAX_RETRIES = 3;

export class PostgresEventStore implements EventStore {
  private subscribers: Set<EventSubscriber> = new Set();
  private cache: StoredEvent[] = [];
  /** Read-only cache of per-stream version (for fast streamVersion() lookups). */
  private versionCache: Map<string, number> = new Map();
  private hydrated = false;

  /**
   * Hydrate the in-memory read cache from the database.
   * Called on startup — loads all persisted events into memory for fast reads.
   * The cache is disposable: if lost, the DB remains the source of truth.
   */
  async hydrate(): Promise<{ eventsLoaded: number }> {
    if (this.hydrated) return { eventsLoaded: 0 };

    try {
      const records = await db.eventRecord.findMany({
        orderBy: { seq: 'asc' },
        take: 100_000,
      });

      this.cache = [];
      this.versionCache.clear();

      for (const r of records) {
        const payload = r.payload ? JSON.parse(r.payload) : {};
        const streamId = r.streamId ?? payload.streamId ?? `${r.type}`;
        const streamType = payload.streamType ?? 'unknown';
        // P3-1: version is now a real DB column — authoritative.
        const version = r.version ?? payload.version ?? 0;

        const event: StoredEvent = {
          id: r.eventId,
          streamId,
          streamType,
          version,
          globalPosition: r.seq,
          type: r.type,
          kind: 'domain',
          payload,
          metadata: {
            intentId: r.eventId,
            correlationId: r.eventId,
            actor: 'system',
            environment: 'sandbox',
            timestamp: Number(r.ts),
          },
        };
        this.cache.push(event);
        // Maintain the per-stream max-version read cache.
        const cur = this.versionCache.get(streamId) ?? -1;
        if (version > cur) this.versionCache.set(streamId, version);
      }

      this.hydrated = true;
      return { eventsLoaded: this.cache.length };
    } catch (err) {
      console.error('[PostgresEventStore] Hydration failed:', err);
      this.hydrated = true; // Don't retry — operate in degraded mode
      return { eventsLoaded: 0 };
    }
  }

  /**
   * Append events to the database (authoritative) + cache (disposable).
   *
   * P3-1: OCC is enforced at the DB level via `@@unique([streamId, version])`.
   * Two replicas racing for the same (streamId, version) slot will produce
   * exactly one winner; the loser gets a P2002 unique violation and retries
   * (up to OCC_MAX_RETRIES) before giving up with a structured OCCError.
   */
  async append(
    events: UncommittedEvent[],
    expectedVersions: Map<string, number>,
    meta: AppendMetadata,
  ): Promise<AppendResult> {
    if (events.length === 0) {
      return {
        fromPosition: this.cache.length,
        toPosition: this.cache.length - 1,
        streamVersions: new Map(this.versionCache),
        events: [],
      };
    }

    // ── ATTEMPT LOOP: retry on unique-constraint violation (P2002) ────────
    let attempt = 0;
    while (true) {
      attempt++;
      // 1. Read the authoritative max(version) per stream from the DB.
      const streamIds = Array.from(new Set(events.map((e) => e.streamId)));
      const dbMaxVersions = await this.readMaxVersions(streamIds);

      // 2. Verify optimistic concurrency: caller's expectedVersions must
      //    agree with the DB max. (In-process cache is NOT authoritative.)
      for (const [streamId, expected] of expectedVersions) {
        const actual = dbMaxVersions.get(streamId) ?? -1;
        if (actual !== expected) {
          throw new OCCError(streamId, expected, actual);
        }
      }

      // 3. Assign new versions = maxVersion + 1 per stream (local bump).
      const localVersions = new Map<string, number>();
      for (const [sid, max] of dbMaxVersions) localVersions.set(sid, max);
      const stored: StoredEvent[] = [];
      const fromPosition = this.cache.length;

      for (const ev of events) {
        const currentVersion = localVersions.get(ev.streamId) ?? -1;
        const nextVersion = currentVersion + 1;
        localVersions.set(ev.streamId, nextVersion);

        const record: StoredEvent = {
          id: uid('evt'),
          streamId: ev.streamId,
          streamType: ev.streamType,
          version: nextVersion,
          globalPosition: this.cache.length + stored.length,
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
        stored.push(record);
      }

      // 4. ── DURABLE WRITE — DB unique constraint catches races ──────────
      try {
        await db.$transaction(
          stored.map((evt) =>
            db.eventRecord.create({
              data: {
                eventId: evt.id,
                type: evt.type,
                payload: JSON.stringify({
                  ...evt.payload,
                  streamId: evt.streamId,
                  streamType: evt.streamType,
                  version: evt.version,
                }),
                ts: BigInt(Math.trunc(evt.metadata.timestamp)), // HLC may produce fractional ms; truncate to integer for BigInt column
                frame: 0,
                seq: fromPosition + stored.indexOf(evt) + 1,
                // P3-1: persist streamId + version to the DB columns.
                // The @@unique([streamId, version]) constraint is the
                // load-bearing OCC check.
                streamId: evt.streamId,
                version: evt.version,
              },
            }),
          ),
        );
      } catch (err: any) {
        // P3-1: detect unique-constraint violation on (streamId, version).
        // Prisma marks these with code 'P2002'. The Postgres SQLSTATE is
        // 23505; we accept either signal to be robust across drivers.
        const isUniqueViolation =
          err?.code === PRISMA_UNIQUE_VIOLATION ||
          err?.meta?.code === PRISMA_UNIQUE_VIOLATION ||
          err?.message?.includes('unique') ||
          err?.message?.includes('23505');

        if (isUniqueViolation && attempt <= OCC_MAX_RETRIES) {
          // A concurrent append won the version race. Re-read max(version),
          // re-bump, and retry. This is the expected fast path under
          // contention — the DB constraint is doing its job.
          if (attempt === 1) {
            console.warn(
              `[PostgresEventStore] OCC race detected on streams [${streamIds.join(', ')}] — retrying (attempt ${attempt}/${OCC_MAX_RETRIES})`,
            );
          }
          continue; // retry the while-loop
        }

        if (isUniqueViolation) {
          // Exhausted retries — surface a structured conflict error.
          const refreshed = await this.readMaxVersions(streamIds);
          const conflicts = streamIds.map((sid) => ({
            streamId: sid,
            expected: expectedVersions.get(sid) ?? -1,
            actual: refreshed.get(sid) ?? -1,
          }));
          throw new OCCError(
            conflicts[0]?.streamId ?? streamIds[0],
            conflicts[0]?.expected ?? -1,
            conflicts[0]?.actual ?? -1,
            { retries: attempt - 1, conflicts },
          );
        }

        // Non-OCC DB error — surface as a generic append failure.
        throw new Error(
          `Event store DB write failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // 5. ── CACHE UPDATE — only after DB commit succeeds ────────────────
      for (const evt of stored) {
        this.versionCache.set(evt.streamId, evt.version);
        this.cache.push(evt);
      }

      // 6. ── NOTIFY SUBSCRIBERS — projections update synchronously ───────
      for (const subscriber of this.subscribers) {
        try {
          subscriber(stored);
        } catch (err) {
          console.error('[PostgresEventStore] Subscriber error:', err);
        }
      }

      return {
        fromPosition,
        toPosition: this.cache.length - 1,
        streamVersions: new Map(this.versionCache),
        events: stored,
      };
    }
  }

  /**
   * Read the authoritative max(version) per streamId from the DB.
   * Returns a Map<streamId, maxVersion>. Streams with no events return -1
   * implicitly (via the `?? -1` fallback at call sites).
   *
   * P3-1: this query is the AUTHORITATIVE OCC check. The in-process
   * versionCache is only a hint; it must never gate append().
   */
  private async readMaxVersions(streamIds: string[]): Promise<Map<string, number>> {
    if (streamIds.length === 0) return new Map();
    const rows = await db.eventRecord.groupBy({
      by: ['streamId'],
      where: { streamId: { in: streamIds } },
      _max: { version: true },
    });
    const out = new Map<string, number>();
    for (const r of rows) {
      // Prisma returns _max.version as bigint | null (Int aggregated in some drivers).
      const maxVal = r._max?.version as unknown;
      const num = typeof maxVal === 'bigint' ? Number(maxVal) : (maxVal as number | null);
      out.set(r.streamId, num ?? -1);
    }
    // Ensure all requested streamIds appear in the map (with -1 fallback).
    for (const sid of streamIds) {
      if (!out.has(sid)) out.set(sid, -1);
    }
    return out;
  }

  async readStream(streamId: string, fromVersion?: number): Promise<StoredEvent[]> {
    const events = this.cache.filter(
      (e) => e.streamId === streamId && (fromVersion === undefined || e.version > fromVersion),
    );
    return events;
  }

  async readAll(fromPosition: number, limit: number): Promise<StoredEvent[]> {
    return this.cache.slice(fromPosition, fromPosition + limit);
  }

  streamVersion(streamId: string): number | undefined {
    // Read-cache lookup — fast path. The authoritative value is in the DB.
    return this.versionCache.get(streamId);
  }

  size(): number {
    return this.cache.length;
  }

  subscribe(subscriber: EventSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }
}

/** OCC error — thrown when expected version doesn't match actual. */
export class OCCError extends Error {
  public readonly conflictInfo?: {
    retries: number;
    conflicts: Array<{ streamId: string; expected: number; actual: number }>;
  };

  constructor(
    public streamId: string,
    public expectedVersion: number,
    public actualVersion: number,
    conflictInfo?: {
      retries: number;
      conflicts: Array<{ streamId: string; expected: number; actual: number }>;
    },
  ) {
    super(
      `OCC conflict on stream "${streamId}": expected v${expectedVersion}, got v${actualVersion}` +
        (conflictInfo ? ` (retries: ${conflictInfo.retries}, conflicts: ${JSON.stringify(conflictInfo.conflicts)})` : ''),
    );
    this.name = 'OptimisticConcurrencyError';
    this.conflictInfo = conflictInfo;
  }
}
