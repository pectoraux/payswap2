/**
 * Next.js Instrumentation Hook — runs once on server startup.
 *
 * Initializes:
 *  1. The persistent event store: loads all persisted events from the DB,
 *     hydrates the in-memory eventEngine, and subscribes to future emits for
 *     DB persistence. This makes protocol state survive process restarts.
 *  2. The checkpoint scheduler for periodic ledger snapshots.
 *  3. The closed-loop controllers — pairs every treasury observer with an
 *     actuator so the system ACTS on what it computes (drift → rebalance,
 *     low → rebalance, info-proposal → auto-apply, backing-block → fallback,
 *     FX-breach → block, auction-timeout → refund, net-settlement cycle).
 *     Without this wiring, the dashboard would say "problem handled" while
 *     nothing actually happens.
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

    // ── Closed-loop controllers ─────────────────────────────────────────
    // Wire every observer to its actuator. Without this, the drift monitor
    // fires alarms that nobody hears, the migration proposals sit forever,
    // and the FX breach "block" doesn't actually block. The dashboard would
    // report these as handled when nothing happened.
    try {
      const { wireClosedLoops } = await import('@/protocol/treasury-v2/closed-loop-controllers');
      wireClosedLoops();
      console.log('[closed-loops] 8 controllers wired (E1-E8): drift→rebalance, low→rebalance, critical→pause, info-proposal→auto-apply, backing→fallback, net-settle cycle, FX→block, auction-timeout→refund');
    } catch (e) {
      console.error('[closed-loops] Failed to wire:', e);
    }
  } catch (e) {
    console.error('[persistence] Failed to initialize:', e);
  }
}
