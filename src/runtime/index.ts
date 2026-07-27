/**
 * PaySwap Runtime — public entry point.
 *
 * The Runtime is the product. Every client (Dashboard, Admin, Twin, SDK,
 * CLI, Extensions, AI Agents, Mobile, API) enters through the runtime.
 *
 * M-RT-19: the runtime hosts the migration framework + migrated capabilities
 * (payments, refunds). Each capability follows the same pipeline:
 *   Events → Projection → Read Model → View
 *
 * The `paymentReadModel` / `refundReadModel` façades in read-models/v2 are
 * the FROZEN contracts pages consume. Their internals delegate to
 * runtime.payments / runtime.refunds, which read from projections fed by
 * the EventStore.
 */

import { LiveClock, VirtualClock, type RuntimeClock } from './clock';
import { InMemoryEventStore, type EventStore } from './events';
import { ProjectionRunner } from './read-models';
import { PaymentsService, PaymentBackfillService } from './engines/payments';
import { RefundsService, RefundBackfillService } from './engines/refunds';
import { ProjectionHealthRegistry, MigrationManager } from './migration';
import { LiquidityComposer } from './engines/liquidity-composer';
import type { Environment } from './types';

// Re-export the public surface.
export * from './types';
export * from './clock';
export * from './events';
export * from './read-models';
export * from './engines/payments';
export * from './engines/refunds';
export * from './migration';
export * from './read-models/v2';
export * from './engines/liquidity-composer';

/** The Runtime container — holds every component. */
export interface Runtime {
  clock: RuntimeClock;
  eventStore: EventStore;
  projectionRunner: ProjectionRunner;
  /** M-RT-18: Payments capability (Events → Projection → Read Model → View). */
  payments: PaymentsService;
  paymentBackfill: PaymentBackfillService;
  /** M-RT-19: Refunds capability (uses the generic migration framework). */
  refunds: RefundsService;
  refundBackfill: RefundBackfillService;
  /** M-RT-19: Projection health registry (aggregates health from all projections). */
  health: ProjectionHealthRegistry;
  /** M-RT-19: Migration manager (owns all capability backfills; inverts _onFirstRead ownership). */
  migrations: MigrationManager;
  /** M-RT-16: Liquidity Composer (multi-hop + split routing). Pure — never executes. */
  composer: LiquidityComposer;
}

export interface CreateRuntimeOptions {
  environment?: Environment;
  virtualClock?: { origin?: number; speed?: number };
  eventStore?: EventStore;
}

/** Create a Runtime instance. */
export function createRuntime(opts: CreateRuntimeOptions = {}): Runtime {
  const clock: RuntimeClock = opts.virtualClock
    ? new VirtualClock(opts.virtualClock)
    : new LiveClock();
  const eventStore: EventStore = opts.eventStore ?? new InMemoryEventStore();
  const projectionRunner = new ProjectionRunner();
  projectionRunner.start(eventStore);

  // ── Payments capability (M-RT-18) ────────────────────────────────────────
  const payments = new PaymentsService({ eventStore, clock });
  projectionRunner.register(payments.projection);
  const paymentBackfill = new PaymentBackfillService({
    paymentsService: payments,
    environment: opts.environment ?? 'live',
    actorId: 'system:backfill',
    correlationPrefix: 'backfill:payment',
  });

  // ── Refunds capability (M-RT-19 — uses BackfillEngine<T>) ────────────────
  const refunds = new RefundsService({ eventStore, clock });
  projectionRunner.register(refunds.projection);
  const refundBackfill = new RefundBackfillService({
    refundsService: refunds,
    environment: opts.environment ?? 'live',
    correlationPrefix: 'backfill:refund',
  });

  // ── Migration Manager (M-RT-19 feedback: invert backfill ownership) ─────
  // The manager OWNS all capability backfills. Capabilities don't trigger
  // their own backfills — the manager does it centrally. This separates
  // migration (a deployment concern) from domain logic.
  const migrations = new MigrationManager();
  migrations.register(
    'payments',
    1,
    () => paymentBackfill.run(),
    () => paymentBackfill.status(),
    () => paymentBackfill.status().then((s) => payments.health(s.prismaCount)),
  );
  migrations.register(
    'refunds',
    1,
    () => refundBackfill.run(),
    () => refundBackfill.status(),
    () => refundBackfill.status().then((s) => refunds.health(s.prismaCount)),
  );
  // Trigger all backfills on startup (non-blocking; idempotent).
  migrations.triggerAll();

  // ── Projection health registry (M-RT-19) ────────────────────────────────
  const health = new ProjectionHealthRegistry();
  health.register('payments', async () => {
    const status = await paymentBackfill.status();
    return payments.health(status.prismaCount);
  });
  health.register('refunds', async () => {
    const status = await refundBackfill.status();
    return refunds.health(status.prismaCount);
  });

  // ── Liquidity Composer (M-RT-16) ────────────────────────────────────────
  const composer = new LiquidityComposer();

  return {
    clock,
    eventStore,
    projectionRunner,
    payments,
    paymentBackfill,
    refunds,
    refundBackfill,
    health,
    migrations,
    composer,
  };
}

/**
 * The default Runtime singleton. Uses globalThis so Next.js dev-mode module
 * re-instantiation doesn't create duplicate runtimes.
 */
const globalForRuntime = globalThis as unknown as { __PAYSWAP_RUNTIME__?: Runtime };
export const runtime: Runtime =
  globalForRuntime.__PAYSWAP_RUNTIME__ ?? createRuntime();
if (!globalForRuntime.__PAYSWAP_RUNTIME__) {
  globalForRuntime.__PAYSWAP_RUNTIME__ = runtime;
}
