/**
 * Execution Pipeline — the side-effect-owning executor. (M-RT-12.)
 *
 * The compiler answers "What should happen?" — the pipeline answers "Make it happen."
 * The compiler is pure; the pipeline owns side effects.
 *
 * 10 explicit stages (each a thin, inspectable step):
 *   1. Receive    — Accept ExecutionPlan
 *   2. Validate   — Verify plan still executable
 *   3. Reserve    — Lock reserves (via ReserveLedgerService)
 *   4. Liquidity  — Consume LP offer (mark as used)
 *   5. Settlement — Execute settlement legs
 *   6. Ledger     — Update balances (consume + release reserves)
 *   7. Events     — Append domain events (payment.completed etc.)
 *   8. Projection — Refresh derived views (projection runner handles this)
 *   9. Inspector  — Record the full execution trace
 *   10. Complete   — Final status
 *
 * M-RT-12 is intentionally simple: no retries, no async queues, no compensation,
 * no parallel execution. One successful deterministic payment is more valuable
 * than a sophisticated executor.
 */

import type { EventStore } from '../../events';
import type { RuntimeClock } from '../../clock';
import type { Environment } from '../../types';
import type { ExecutionPlan } from '../../compiler/types';
import type { ReserveLedgerService } from '../reserve-ledger/service';
import type { LiquidityMarketplaceService } from '../liquidity-marketplace/service';
import type { TypedIntent } from '../../intent/types';

/** The result of one pipeline stage. */
export interface StageResult {
  stage: string;
  status: 'ok' | 'skipped' | 'failed';
  durationMs: number;
  detail: string;
  /** Events emitted by this stage (for the Inspector). */
  eventsEmitted: string[];
}

/** The result of executing an ExecutionPlan through the pipeline. */
export interface ExecutionResult {
  plan: ExecutionPlan;
  intent: TypedIntent;
  stages: StageResult[];
  status: 'completed' | 'failed';
  error?: string;
  /** The domain events emitted (event types). */
  domainEvents: string[];
  /** The payment ID (stream ID in the Event Store). */
  paymentId: string;
  /** Full execution trace for the Inspector. */
  trace: {
    intentId: string;
    planId: string;
    compilerPasses: number;
    pipelineStages: number;
    eventsEmitted: number;
    durationMs: number;
  };
  executedAt: number;
}

/** The inputs to the pipeline — all the services it needs to execute. */
export interface PipelineInputs {
  eventStore: EventStore;
  clock: RuntimeClock;
  reserveLedger: ReserveLedgerService;
  liquidityMarketplace: LiquidityMarketplaceService;
}

/**
 * ExecutionPipeline — the side-effect-owning executor.
 *
 * Takes an ExecutionPlan (from the pure Financial Compiler) and executes it
 * through 10 explicit stages. Each stage is inspectable. The pipeline owns
 * all side effects: reserve locking, ledger updates, event emission.
 */
export class ExecutionPipeline {
  constructor(private inputs: PipelineInputs) {}

  /** Execute an ExecutionPlan. Returns the full result + trace. */
  async execute(
    plan: ExecutionPlan,
    intent: TypedIntent,
    environment: Environment,
  ): Promise<ExecutionResult> {
    const { eventStore, clock, reserveLedger, liquidityMarketplace } = this.inputs;
    const stages: StageResult[] = [];
    const domainEvents: string[] = [];
    const paymentId = `payment_${intent.id}`;
    const startTime = clock.now();

    // ── Stage 1: Receive ──────────────────────────────────────────────
    stages.push(this.stage('receive', startTime, () => {
      return { detail: `Received ExecutionPlan ${plan.id} for intent ${intent.id}`, eventsEmitted: [] };
    }));

    // ── Stage 2: Validate ─────────────────────────────────────────────
    const validateResult = this.stage('validate', clock.now(), () => {
      if (plan.settlementLegs.length === 0) throw new Error('No settlement legs in plan');
      if (plan.lpAllocations.length === 0) throw new Error('No LP allocations in plan');
      return { detail: `Plan validated: ${plan.settlementLegs.length} legs, ${plan.lpAllocations.length} LP allocations`, eventsEmitted: [] };
    });
    stages.push(validateResult);
    if (validateResult.status === 'failed') {
      return this.fail(plan, intent, stages, paymentId, startTime, validateResult.detail);
    }

    // ── Stage 3: Reserve — lock reserves ──────────────────────────────
    const reserveStageStart = clock.now();
    try {
      for (const alloc of plan.reserveAllocations) {
        await reserveLedger.transition({
          reserveId: alloc.reserveId,
          transition: 'lock',
          amount: alloc.amount,
          reason: `Lock for payment ${paymentId}`,
          operationId: paymentId,
          environment,
          actorId: intent.actor.id,
          correlationId: intent.correlationId,
        });
      }
      stages.push({
        stage: 'reserve', status: 'ok', durationMs: clock.now() - reserveStageStart,
        detail: `Locked ${plan.reserveAllocations.length} reserves`, eventsEmitted: ['reserve.locked'],
      });
      domainEvents.push('reserve.locked');
    } catch (err) {
      stages.push({ stage: 'reserve', status: 'failed', durationMs: clock.now() - reserveStageStart, detail: err instanceof Error ? err.message : 'Unknown', eventsEmitted: [] });
      return this.fail(plan, intent, stages, paymentId, startTime, 'Reserve lock failed');
    }

    // ── Stage 4: Liquidity — consume the LP offer ─────────────────────
    const liquidityStart = clock.now();
    try {
      // M-RT-12: no explicit offer consumption — the marketplace is read-only.
      // We just verify the offer is still valid. Future milestones add offer locking.
      const book = await liquidityMarketplace.getOrderBook(environment);
      const lpId = plan.lpAllocations[0]?.lpId;
      const hasOffer = book.offers.some((o) => o.lpId === lpId);
      if (!hasOffer) throw new Error(`LP ${lpId} no longer has a valid offer`);
      stages.push({
        stage: 'liquidity', status: 'ok', durationMs: clock.now() - liquidityStart,
        detail: `Verified LP ${lpId} offer is still valid`, eventsEmitted: ['liquidity.verified'],
      });
      domainEvents.push('liquidity.verified');
    } catch (err) {
      stages.push({ stage: 'liquidity', status: 'failed', durationMs: clock.now() - liquidityStart, detail: err instanceof Error ? err.message : 'Unknown', eventsEmitted: [] });
      return this.fail(plan, intent, stages, paymentId, startTime, 'Liquidity verification failed');
    }

    // ── Stage 5: Settlement — execute settlement legs ─────────────────
    const settlementStart = clock.now();
    try {
      // M-RT-12: settlement is a no-op (no real connector calls).
      // We just record that the legs were "executed".
      stages.push({
        stage: 'settlement', status: 'ok', durationMs: clock.now() - settlementStart,
        detail: `Executed ${plan.settlementLegs.length} settlement legs: ${plan.settlementLegs.map((l) => `${l.from}→${l.to}`).join(', ')}`,
        eventsEmitted: ['settlement.executed'],
      });
      domainEvents.push('settlement.executed');
    } catch (err) {
      stages.push({ stage: 'settlement', status: 'failed', durationMs: clock.now() - settlementStart, detail: err instanceof Error ? err.message : 'Unknown', eventsEmitted: [] });
      return this.fail(plan, intent, stages, paymentId, startTime, 'Settlement failed');
    }

    // ── Stage 6: Ledger — consume + release reserves ──────────────────
    const ledgerStart = clock.now();
    try {
      for (const alloc of plan.reserveAllocations) {
        // Consume the locked reserve (Locked → Consumed).
        await reserveLedger.transition({
          reserveId: alloc.reserveId,
          transition: 'consume',
          amount: alloc.amount,
          reason: `Consume for payment ${paymentId}`,
          operationId: paymentId,
          environment,
          actorId: intent.actor.id,
          correlationId: intent.correlationId,
        });
        // Release (Consumed → Released).
        await reserveLedger.transition({
          reserveId: alloc.reserveId,
          transition: 'release',
          amount: alloc.amount,
          reason: `Release for payment ${paymentId}`,
          operationId: paymentId,
          environment,
          actorId: intent.actor.id,
          correlationId: intent.correlationId,
        });
      }
      stages.push({
        stage: 'ledger', status: 'ok', durationMs: clock.now() - ledgerStart,
        detail: `Consumed + released ${plan.reserveAllocations.length} reserves`, eventsEmitted: ['ledger.updated'],
      });
      domainEvents.push('ledger.updated');
    } catch (err) {
      stages.push({ stage: 'ledger', status: 'failed', durationMs: clock.now() - ledgerStart, detail: err instanceof Error ? err.message : 'Unknown', eventsEmitted: [] });
      return this.fail(plan, intent, stages, paymentId, startTime, 'Ledger update failed');
    }

    // ── Stage 7: Events — append payment.completed ─────────────────────
    const eventsStart = clock.now();
    try {
      const streamId = `${environment}:payment:${paymentId}`;
      await eventStore.append(
        [{
          type: 'payment.completed',
          streamId,
          streamType: 'payment',
          kind: 'domain',
          payload: {
            paymentId,
            intentId: intent.id,
            planId: plan.id,
            amount: intent.desired.amount,
            from: intent.desired.from,
            to: intent.desired.to,
            lpId: plan.lpAllocations[0]?.lpId,
            feeBps: plan.estimatedCostBps,
            stages: stages.map((s) => ({ stage: s.stage, status: s.status, durationMs: s.durationMs })),
          },
        }],
        new Map([[streamId, eventStore.streamVersion(streamId) ?? -1]]),
        {
          intentId: intent.id,
          correlationId: intent.correlationId,
          actor: intent.actor.id,
          environment,
          timestamp: clock.now(),
        },
      );
      stages.push({
        stage: 'events', status: 'ok', durationMs: clock.now() - eventsStart,
        detail: 'Appended payment.completed domain event', eventsEmitted: ['payment.completed'],
      });
      domainEvents.push('payment.completed');
    } catch (err) {
      stages.push({ stage: 'events', status: 'failed', durationMs: clock.now() - eventsStart, detail: err instanceof Error ? err.message : 'Unknown', eventsEmitted: [] });
      return this.fail(plan, intent, stages, paymentId, startTime, 'Event emission failed');
    }

    // ── Stage 8: Projection — projections auto-update via EventStore subscriber ──
    stages.push({
      stage: 'projection', status: 'ok', durationMs: 0,
      detail: 'Projections auto-updated via EventStore subscriber (immediate on append)',
      eventsEmitted: [],
    });

    // ── Stage 9: Inspector — record trace ──────────────────────────────
    stages.push({
      stage: 'inspector', status: 'ok', durationMs: 0,
      detail: `Full execution trace recorded: ${stages.length} stages, ${domainEvents.length} domain events`,
      eventsEmitted: [],
    });

    // ── Stage 10: Complete ─────────────────────────────────────────────
    const endTime = clock.now();
    stages.push({
      stage: 'complete', status: 'ok', durationMs: 0,
      detail: `Payment ${paymentId} completed successfully in ${endTime - startTime}ms`,
      eventsEmitted: [],
    });

    return {
      plan,
      intent,
      stages,
      status: 'completed',
      domainEvents,
      paymentId,
      trace: {
        intentId: intent.id,
        planId: plan.id,
        compilerPasses: plan.passes.length,
        pipelineStages: stages.length,
        eventsEmitted: domainEvents.length,
        durationMs: endTime - startTime,
      },
      executedAt: endTime,
    };
  }

  // ── private helpers ─────────────────────────────────────────────────

  private stage(
    name: string,
    start: number,
    fn: () => { detail: string; eventsEmitted: string[] },
  ): StageResult {
    try {
      const result = fn();
      return { stage: name, status: 'ok', durationMs: this.inputs.clock.now() - start, detail: result.detail, eventsEmitted: result.eventsEmitted };
    } catch (err) {
      return { stage: name, status: 'failed', durationMs: this.inputs.clock.now() - start, detail: err instanceof Error ? err.message : 'Unknown', eventsEmitted: [] };
    }
  }

  private fail(
    plan: ExecutionPlan,
    intent: TypedIntent,
    stages: StageResult[],
    paymentId: string,
    startTime: number,
    error: string,
  ): ExecutionResult {
    return {
      plan, intent, stages, status: 'failed', error,
      domainEvents: stages.flatMap((s) => s.eventsEmitted),
      paymentId,
      trace: {
        intentId: intent.id, planId: plan.id,
        compilerPasses: plan.passes.length, pipelineStages: stages.length,
        eventsEmitted: stages.flatMap((s) => s.eventsEmitted).length,
        durationMs: this.inputs.clock.now() - startTime,
      },
      executedAt: this.inputs.clock.now(),
    };
  }
}
