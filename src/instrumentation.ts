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
      const { wireClosedLoops, wireNetSettleInputs } = await import('@/protocol/treasury-v2/closed-loop-controllers');
      const { netSettlementEngine } = await import('@/protocol/settlement/net-settlement');
      const { eventEngine } = await import('@/kernel/event');

      // W2+W3 FIX: wire the net settlement cycle to actually call settle().
      // The onSettle callback emits a `corridor.obligation.settled` event so
      // the settlement is durable + auditable. The rehydrateFromEvents()
      // call rebuilds the corridor Map from the event log on startup.
      netSettlementEngine.setOnSettle((result) => {
        eventEngine.emit('corridor.obligation.settled', {
          fromCountry: result.fromCountry,
          toCountry: result.toCountry,
          currency: result.currency,
          amount: result.amount,
          direction: result.direction,
          settledAt: result.settledAt,
        } as unknown as Record<string, unknown>);
      });

      // Rehydrate the corridor Map from the event log (W3).
      try {
        const { eventStore } = await import('@/protocol/persistence');
        const { events: persisted } = await eventStore.loadEvents({
          limit: 1_000_000,
          types: ['corridor.obligation.recorded', 'corridor.obligation.settled'],
        });
        const obligationEvents = persisted
          .map(e => {
            const p = (e as any).payload ?? (e as any);
            if ((e as any).type === 'corridor.obligation.recorded' || p.type === 'corridor.obligation.recorded') {
              return {
                type: 'corridor.obligation.recorded' as const,
                fromCountry: p.fromCountry,
                toCountry: p.toCountry,
                currency: p.currency,
                amount: p.amount,
              };
            }
            return {
              type: 'corridor.obligation.settled' as const,
              fromCountry: p.fromCountry,
              toCountry: p.toCountry,
              currency: p.currency,
              amount: p.amount,
            };
          });
        if (obligationEvents.length > 0) {
          netSettlementEngine.rehydrateFromEvents(obligationEvents);
          console.log(`[net-settlement] Rehydrated ${obligationEvents.length} obligation events into ${netSettlementEngine.all().length} corridors`);
        }
      } catch (e) {
        console.error('[net-settlement] Rehydrate failed:', e);
      }

      // Wire the E6 net settlement cycle to call netSettlementEngine.settle().
      wireNetSettleInputs({
        corridorsWithObligations: () => {
          return netSettlementEngine.corridorPairs().map(p => `${p.fromCountry}:${p.toCountry}:${p.currency}`);
        },
        settleCorridor: (corridor: string) => {
          const [from, to, currency] = corridor.split(':');
          const result = netSettlementEngine.settle(from, to, currency);
          return { settled: result.settled, currency };
        },
      });

      wireClosedLoops();
      console.log('[closed-loops] 8 controllers wired (E1-E8): drift→rebalance, low→rebalance, critical→pause, info-proposal→auto-apply, backing→fallback, net-settle cycle (W2+W3: settle() called, events emitted, Map rehydrated), FX→block, auction-timeout→refund');
    } catch (e) {
      console.error('[closed-loops] Failed to wire:', e);
    }
  } catch (e) {
    console.error('[persistence] Failed to initialize:', e);
  }
}
