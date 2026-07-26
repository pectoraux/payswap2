/**
 * Next.js Instrumentation Hook — runs once on server startup.
 *
 * Initializes the persistent event store: loads all persisted events from the
 * DB, hydrates the in-memory eventEngine, and subscribes to future emits for
 * DB persistence. This makes protocol state survive process restarts.
 *
 * Also starts the checkpoint scheduler for periodic ledger snapshots.
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
}
