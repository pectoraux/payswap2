/**
 * PaySwap Protocol — Persistent Event Store.
 *
 * The event stream is the single source of truth. This module persists every
 * emitted event to the database (append-only) so protocol state survives
 * process restarts. On startup, the in-memory `eventEngine` is hydrated by
 * replaying the persisted event stream.
 *
 * Design:
 *   - Uses a "pull" model: flush() reads ALL events from eventEngine.read()
 *     and persists any that aren't yet in the DB (tracked by eventId).
 *   - This is robust against Next.js dev mode creating multiple module
 *     instances (the event bus subscription model breaks in that case).
 *   - On startup: loadEvents() → hydrate in-memory engine → state restored
 *   - Strict ordering via monotonic `seq` column
 *   - Idempotent: re-flushing the same events is a no-op (eventId unique)
 *
 * The kernel is untouched. This module wraps the existing eventEngine and
 * adds a persistence layer on top.
 */
import { db } from '@/lib/db';
import { eventEngine } from '@/kernel/event';
import type { SimulationEvent } from '@/kernel/types';

type PersistHandler = (event: SimulationEvent, seq: number) => void;

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

      return { eventsLoaded: events.length, lastSeq: this.nextSeq - 1 };
    } catch {
      // DB may not be ready yet — non-fatal
      return { eventsLoaded: 0, lastSeq: 0 };
    }
  }

  /**
   * Pull all events from the in-memory eventEngine and persist any that
   * haven't been persisted yet. This is the "pull" model — robust against
   * module instance issues in Next.js dev mode.
   */
  async flush(): Promise<{ persisted: number }> {
    let persisted = 0;
    try {
      // Read ALL events from the in-memory stream
      const allEvents = eventEngine.read();

      // Filter to events that haven't been persisted yet
      const newEvents = allEvents.filter((e) => !this.persistedEventIds.has(e.id));

      if (newEvents.length === 0) return { persisted: 0 };

      // Persist each new event
      for (const evt of newEvents) {
        try {
          await db.eventRecord.create({
            data: {
              eventId: evt.id,
              type: evt.type,
              payload: JSON.stringify(evt.payload),
              ts: BigInt(evt.ts),
              frame: evt.frame,
              seq: this.nextSeq++,
            },
          });
          this.persistedEventIds.add(evt.id);
          persisted++;
          // Notify handlers
          for (const h of this.persistHandlers) {
            try { h(evt, this.nextSeq - 1); } catch { /* ignore */ }
          }
        } catch {
          // Event may already exist (idempotent) — mark as persisted to skip
          this.persistedEventIds.add(evt.id);
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
