/**
 * Next.js Instrumentation Hook — runs once on server startup.
 *
 * Initializes the persistent event store: loads all persisted events from the
 * DB, hydrates the in-memory eventEngine, and subscribes to future emits for
 * DB persistence. This makes protocol state survive process restarts.
 *
 * Also starts the checkpoint scheduler for periodic ledger snapshots.
 *
 * P2-1 (C-4 fix): also rehydrates the protocol `LedgerEngine` from the
 * `LedgerEntryRecord` Postgres table. The in-memory `journals` array is a
 * read cache; the DB is the source of truth. Without this call, every
 * server restart would erase the in-memory ledger and the trial-balance /
 * A=L+E assertions would lose history.
 */
export async function register() {
  // Only run on the server (not during build)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { eventStore, checkpointManager } = await import('@/protocol/persistence');
    const { eventEngine } = await import('@/kernel/event');

    // Initialize: load persisted events → hydrate in-memory engine
    const { eventsLoaded, lastSeq } = await eventStore.init();
    if (eventsLoaded > 0) {
      console.log(`[persistence] Hydrated ${eventsLoaded} events from DB (lastSeq=${lastSeq})`);
    }

    // Start periodic snapshot scheduler (every 60s)
    const { stop } = checkpointManager.start({ snapshotIntervalMs: 60_000 });
    (globalThis as any).__persistenceStop = stop;

    console.log('[persistence] Event store initialized, checkpoint scheduler started');
  } catch (e) {
    console.error('[persistence] Failed to initialize:', e);
  }

  // P2-1 (C-4 fix): rehydrate the protocol ledger engine from Postgres.
  // Best-effort — if the DB is unreachable, the engine starts empty (the
  // money-movement routes will still work; they post new entries to the
  // in-memory cache and persist them as they go).
  try {
    const { ledgerEngine } = await import('@/protocol/ledger');
    const { loaded, legs } = await ledgerEngine.rehydrateFromDB();
    if (loaded > 0) {
      console.log(`[ledger] Rehydrated ${loaded} journal entries (${legs} legs) from DB`);
    } else {
      console.log('[ledger] Rehydrate complete (no prior entries found)');
    }
  } catch (e) {
    console.error('[ledger] Failed to rehydrate from DB:', e);
  }
}
