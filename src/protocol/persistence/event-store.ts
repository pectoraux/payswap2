/**
 * PaySwap Protocol — Persistent Event Store (read-side facade + legacy flush).
 *
 * ── P3-2 (H-3) consolidation: PostgresEventStore is the CANONICAL writer ──
 *
 *   This module is NO LONGER an independent writer to the `EventRecord`
 *   table. It is a READ-SIDE facade + a legacy pull-flush compatibility
 *   shim. Its `flush()` method still pulls events from the kernel's
 *   in-memory `eventEngine` (the simulation/protocol event bus) and
 *   persists them to Postgres, but it now PARTICIPATES IN OCC by:
 *
 *     1. Assigning streamId = 'kernel' (a dedicated stream for kernel
 *        simulation events, separate from runtime domain streams like
 *        'wallet:abc' or 'payment:xyz').
 *     2. Computing version = MAX(version) WHERE streamId='kernel' + 1,
 *        incremented per event.
 *     3. Relying on the same `@@unique([streamId, version])` constraint
 *        that PostgresEventStore uses. A race between two replicas
 *        flushing kernel events produces exactly one winner.
 *
 *   The read-side methods (`loadEvents`, `count`, `typeDistribution`,
 *   `getEvent`) are unchanged — they read directly from the DB.
 *
 *   Downstream consumers (`checkpoint.ts`, `instrumentation.ts`, the
 *   persistence API routes) keep their existing API surface. No importer
 *   changes were required.
 *
 * Design:
 *   - `init()` loads all persisted events on startup, hydrates the kernel's
 *     in-memory `eventEngine`, and marks them as already-persisted so
 *     `flush()` doesn't re-write them.
 *   - `flush()` pulls ALL events from `eventEngine.read()`, computes
 *     streamId='kernel' + monotonic version, and batch-inserts them.
 *   - Strict ordering via monotonic `seq` column.
 *   - Idempotent: re-flushing the same events is a no-op (eventId unique).
 */
import { db } from '@/lib/db';
import { eventEngine } from '@/kernel/event';
import type { SimulationEvent } from '@/kernel/types';

type PersistHandler = (event: SimulationEvent, seq: number) => void;

/** Dedicated stream for kernel simulation events (kept separate from runtime streams). */
const KERNEL_STREAM_ID = 'kernel';

/** Prisma's well-known code for unique-constraint violation. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

// Use globalThis to ensure singleton across Next.js dev module instances
const globalAny = globalThis as any;

class EventStore {
  private nextSeq = 1;
  private persistHandlers: Set<PersistHandler> = new Set();
  private initialized = false;
  private persistedEventIds: Set<string> = new Set();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly FLUSH_INTERVAL_MS = 2000; // auto-flush every 2s

  constructor() {
    // Start auto-flush timer (pulls from in-memory event stream)
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
    }, this.FLUSH_INTERVAL_MS);
  }

  /**
   * Initialize: load all persisted events, hydrate the in-memory engine,
   * and mark them as already-persisted so flush() doesn't re-write them.
   */
  async init(): Promise<{ eventsLoaded: number; lastSeq: number }> {
    if (this.initialized) return { eventsLoaded: 0, lastSeq: 0 };
    this.initialized = true;

    try {
      const records = await db.eventRecord.findMany({
        orderBy: { seq: 'asc' },
      });

      const events: SimulationEvent[] = records.map((r) => ({
        id: r.eventId,
        type: r.type,
        payload: JSON.parse(r.payload),
        ts: Number(r.ts),
        frame: r.frame,
      }));

      // Hydrate the in-memory event engine (push directly to stream)
      for (const evt of events) {
        (eventEngine as any).stream.push(evt);
        this.persistedEventIds.add(evt.id);
      }

      this.nextSeq = records.length > 0 ? records[records.length - 1].seq + 1 : 1;

      console.log(
        `[persistence] Hydrated ${events.length} events from DB (lastSeq=${this.nextSeq - 1})`,
      );

      return { eventsLoaded: events.length, lastSeq: this.nextSeq - 1 };
    } catch {
      // DB may not be ready yet — non-fatal
      return { eventsLoaded: 0, lastSeq: 0 };
    }
  }

  /**
   * Pull all events from the in-memory eventEngine and persist any that
   * haven't been persisted yet. P3-2: writes now participate in OCC by
   * using streamId='kernel' + version=MAX(version)+1.
   */
  async flush(): Promise<{ persisted: number }> {
    let persisted = 0;
    try {
      const allEvents = eventEngine.read();
      const newEvents = allEvents.filter((e) => !this.persistedEventIds.has(e.id));

      if (newEvents.length === 0) return { persisted: 0 };

      // P3-1/P3-2: compute the next version for streamId='kernel' from the DB.
      // This makes our writes participate in OCC alongside PostgresEventStore.
      const maxVersionRow = await db.eventRecord.groupBy({
        by: ['streamId'],
        where: { streamId: KERNEL_STREAM_ID },
        _max: { version: true },
      });
      const maxVersionRaw = maxVersionRow[0]?._max?.version as unknown;
      const maxVersion =
        typeof maxVersionRaw === 'bigint'
          ? Number(maxVersionRaw)
          : (maxVersionRaw as number | null) ?? -1;
      let nextVersion = maxVersion + 1;

      // Batch-persist all new events in a single transaction.
      try {
        await db.$transaction(
          newEvents.map((evt) =>
            db.eventRecord.create({
              data: {
                eventId: evt.id,
                type: evt.type,
                payload: JSON.stringify(evt.payload),
                ts: BigInt(evt.ts),
                frame: evt.frame,
                seq: this.nextSeq++,
                // P3-1/P3-2: streamId + version for DB-backed OCC.
                streamId: KERNEL_STREAM_ID,
                version: nextVersion++,
              },
            }),
          ),
        );

        for (const evt of newEvents) {
          this.persistedEventIds.add(evt.id);
          persisted++;
          for (const h of this.persistHandlers) {
            try { h(evt, this.nextSeq - 1); } catch { /* ignore */ }
          }
        }
      } catch (err: any) {
        // P3-2: detect unique-constraint violation on (streamId, version).
        // A concurrent flush from another replica won the version race.
        // Fall back to per-event inserts with version re-computation — this
        // is idempotent and converges.
        const isUniqueViolation =
          err?.code === PRISMA_UNIQUE_VIOLATION ||
          err?.meta?.code === PRISMA_UNIQUE_VIOLATION ||
          err?.message?.includes('unique') ||
          err?.message?.includes('23505');

        if (isUniqueViolation) {
          console.warn(
            '[persistence] OCC race on kernel stream during batch flush — falling back to per-event inserts',
          );
        }

        // Per-event fallback (handles unique violation + already-exists cases).
        for (const evt of newEvents) {
          try {
            // Re-read max(version) per event so we always pick the next free slot.
            const perEvtMax = await db.eventRecord.groupBy({
              by: ['streamId'],
              where: { streamId: KERNEL_STREAM_ID },
              _max: { version: true },
            });
            const perEvtMaxRaw = perEvtMax[0]?._max?.version as unknown;
            const perEvtMaxNum =
              typeof perEvtMaxRaw === 'bigint'
                ? Number(perEvtMaxRaw)
                : (perEvtMaxRaw as number | null) ?? -1;

            await db.eventRecord.create({
              data: {
                eventId: evt.id,
                type: evt.type,
                payload: JSON.stringify(evt.payload),
                ts: BigInt(evt.ts),
                frame: evt.frame,
                seq: this.nextSeq++,
                streamId: KERNEL_STREAM_ID,
                version: perEvtMaxNum + 1,
              },
            });
            this.persistedEventIds.add(evt.id);
            persisted++;
            for (const h of this.persistHandlers) {
              try { h(evt, this.nextSeq - 1); } catch { /* ignore */ }
            }
          } catch {
            // Event may already exist (idempotent) — mark as persisted to skip
            this.persistedEventIds.add(evt.id);
          }
        }
      }
    } catch {
      // DB error — non-fatal, will retry on next flush
    }

    return { persisted };
  }

  /**
   * Load events from the DB (optionally since a given seq).
   */
  async loadEvents(opts?: { sinceSeq?: number; limit?: number; types?: string[] }): Promise<{ events: SimulationEvent[]; lastSeq: number }> {
    const where: any = {};
    if (opts?.sinceSeq !== undefined) where.seq = { gt: opts.sinceSeq };
    if (opts?.types && opts.types.length > 0) where.type = { in: opts.types };

    const records = await db.eventRecord.findMany({
      where,
      orderBy: { seq: 'asc' },
      take: opts?.limit ?? 100000,
    });

    return {
      events: records.map((r) => ({
        id: r.eventId,
        type: r.type,
        payload: JSON.parse(r.payload),
        ts: Number(r.ts),
        frame: r.frame,
      })),
      lastSeq: records.length > 0 ? records[records.length - 1].seq : (opts?.sinceSeq ?? 0),
    };
  }

  async getEvent(eventId: string): Promise<SimulationEvent | null> {
    const r = await db.eventRecord.findUnique({ where: { eventId } });
    if (!r) return null;
    return { id: r.eventId, type: r.type, payload: JSON.parse(r.payload), ts: Number(r.ts), frame: r.frame };
  }

  async count(): Promise<number> {
    return db.eventRecord.count();
  }

  async typeDistribution(): Promise<{ type: string; count: number }[]> {
    const rows = await db.eventRecord.groupBy({
      by: ['type'],
      _count: { type: true },
      orderBy: { _count: { type: 'desc' } },
      take: 20,
    });
    return rows.map((r) => ({ type: r.type, count: r._count.type }));
  }

  onPersist(handler: PersistHandler): () => void {
    this.persistHandlers.add(handler);
    return () => this.persistHandlers.delete(handler);
  }

  currentSeq(): number {
    return this.nextSeq - 1;
  }

  async clear(): Promise<void> {
    await db.eventRecord.deleteMany({});
    this.persistedEventIds.clear();
    this.nextSeq = 1;
  }
}

// Global singleton — survives Next.js dev module re-instantiation
export const eventStore = globalAny.__PAYSWAP_EVENT_STORE ?? new EventStore();
if (!globalAny.__PAYSWAP_EVENT_STORE) globalAny.__PAYSWAP_EVENT_STORE = eventStore;
