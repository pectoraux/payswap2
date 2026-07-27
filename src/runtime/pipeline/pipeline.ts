/**
 * Pipeline — orchestrates the 14-stage execution. (Vocabulary: Execution.)
 *
 * The Pipeline is the ONLY write path. It:
 *   1. Drives the Intent Engine (stages 0-3) to produce a TypedIntent.
 *   2. Runs the execution stages (4-14) in order.
 *   3. Flushes accumulated events at the event_emission stage.
 *   4. Records a TraceNode for every stage + the root.
 *
 * M-RT-1: stage handlers default to no-op 'continue'. The skeleton still
 * appends a `<kind>.intent_received` Domain Event and a `pipeline.stage_reached`
 * Runtime Event per stage, so a dispatch produces a real trace + real events
 * with zero business logic — proving the spine end-to-end.
 */

import type { RuntimeClock } from '../clock';
import type { IntentEngine, MerchantIntent, TypedIntent } from '../intent';
import type { PolicyEngine } from '../policy';
import type { RequestContext } from '../types';
import type { EventStore, StoredEvent } from '../events';
import type { ExecutionTrace } from '../inspector/types';
import { TraceBuilder } from '../inspector/types';
import type {
  ExecutionResult,
  PipelineStageId,
  StageContext,
  StageHandler,
} from './types';
import { EXECUTION_STAGES, STAGE_LABELS } from './types';

export class Pipeline {
  private handlers: Map<PipelineStageId, StageHandler> = new Map();

  constructor(
    private clock: RuntimeClock,
    private intentEngine: IntentEngine,
    private eventStore: EventStore,
    private policyEngine: PolicyEngine,
  ) {}

  /** Register a handler for an execution stage. */
  register(stage: PipelineStageId, handler: StageHandler): void {
    this.handlers.set(stage, handler);
  }

  /** Dispatch a raw merchant intent through the full pipeline. */
  async dispatch(raw: MerchantIntent, ctx: RequestContext): Promise<ExecutionResult> {
    const trace = new TraceBuilder('pending', ctx.correlationId, this.clock.now());
    const recordedDecisions: import('../decisions/types').Decision[] = [];
    const storedEvents: StoredEvent[] = [];
    const pendingEvents: import('../events').UncommittedEvent[] = [];

    // ── Stages 0-3: Intent Engine ──────────────────────────────────────────
    let intent: TypedIntent;
    try {
      // Stage 0: ingest
      const n0 = this.clock.now();
      const node0 = trace.beginStage('ingest', STAGE_LABELS.ingest, n0);
      trace.finishStage(node0, 'ok', this.clock.now(), { rawKind: raw.kind });

      // Stage 1: normalize (inside ingest)
      const n1 = this.clock.now();
      const node1 = trace.beginStage('normalize', STAGE_LABELS.normalize, n1);
      trace.finishStage(node1, 'ok', this.clock.now());

      // Stage 2: resolve (inside ingest)
      const n2 = this.clock.now();
      const node2 = trace.beginStage('resolve', STAGE_LABELS.resolve, n2);
      trace.finishStage(node2, 'ok', this.clock.now());

      // Stage 3: validate & augment (inside ingest) — produces the TypedIntent
      const n3 = this.clock.now();
      const node3 = trace.beginStage('validate', STAGE_LABELS.validate, n3);
      intent = await this.intentEngine.ingest(raw, ctx);
      trace.finishStage(node3, 'ok', this.clock.now(), { intentId: intent.id });

      // Fix the trace's intentId now that we have it.
      trace.intentId = intent.id;
      trace.root.id = `node_root_${intent.id}`;
      trace.root.label = `${intent.kind} execution`;
    } catch (err) {
      const finished = trace.finalize('failed', this.clock.now());
      return {
        intent: { id: 'pending', kind: raw.kind, actor: ctx.actor, environment: ctx.environment, subject: {}, desired: raw.raw, constraints: {}, evidence: [], correlationId: ctx.correlationId, source: ctx.source, createdAt: this.clock.now() } as TypedIntent,
        trace: finished,
        decisions: [],
        events: storedEvents,
        status: 'failed',
        error: { stage: 'intent', message: err instanceof Error ? err.message : String(err) },
      };
    }

    // Append the intent_received Domain Event.
    pendingEvents.push({
      type: `${intent.kind}.intent_received`,
      streamId: `${intent.environment}:${intent.kind}:${intent.id}`,
      streamType: intent.kind,
      kind: 'domain',
      payload: { intentId: intent.id, kind: intent.kind, desired: intent.desired, subject: intent.subject, source: intent.source },
    });

    // ── Stages 4-14: Execution ─────────────────────────────────────────────
    const stageCtx: StageContext = {
      intent,
      clock: this.clock,
      eventStore: this.eventStore,
      policyEngine: this.policyEngine,
      trace,
      state: {},
      pendingEvents,
      decisions: recordedDecisions,
      storedEvents,
    };

    let finalStatus: 'completed' | 'failed' | 'paused' = 'completed';
    let errorStage: { stage: string; message: string } | undefined;

    for (const stage of EXECUTION_STAGES) {
      const stageStart = this.clock.now();
      const node = trace.beginStage(stage, STAGE_LABELS[stage], stageStart);

      // Record a Runtime Event that this stage was reached.
      pendingEvents.push({
        type: 'pipeline.stage_reached',
        streamId: `runtime:${intent.kind}:${intent.id}`,
        streamType: 'pipeline',
        kind: 'runtime',
        payload: { intentId: intent.id, stage, ts: stageStart },
      });

      const handler = this.handlers.get(stage);
      try {
        const outcome = handler ? await handler(stageCtx) : { status: 'continue' as const };

        if (outcome.decision) {
          recordedDecisions.push(outcome.decision);
          trace.attachDecision(outcome.decision);
        }
        if (outcome.events) {
          pendingEvents.push(...outcome.events);
        }

        if (outcome.status === 'fail') {
          trace.finishStage(node, 'error', this.clock.now(), { reason: outcome.reason });
          finalStatus = 'failed';
          errorStage = { stage, message: outcome.reason ?? 'stage failed' };
          break;
        }
        if (outcome.status === 'pause') {
          trace.finishStage(node, 'warn', this.clock.now(), { reason: outcome.reason });
          finalStatus = 'paused';
          break;
        }
        trace.finishStage(node, 'ok', this.clock.now());
      } catch (err) {
        trace.finishStage(node, 'error', this.clock.now(), { error: err instanceof Error ? err.message : String(err) });
        finalStatus = 'failed';
        errorStage = { stage, message: err instanceof Error ? err.message : String(err) };
        break;
      }

      // Flush events at the event_emission stage.
      if (stage === 'event_emission' && pendingEvents.length > 0) {
        const appendMeta: import('../events').AppendMetadata = {
          intentId: intent.id,
          correlationId: ctx.correlationId,
          actor: ctx.actor.id,
          environment: ctx.environment,
          timestamp: this.clock.now(),
        };
        const expectedVersions = new Map<string, number>();
        for (const ev of pendingEvents) {
          const v = this.eventStore.streamVersion(ev.streamId);
          if (v !== undefined && !expectedVersions.has(ev.streamId)) {
            expectedVersions.set(ev.streamId, v);
          }
        }
        const appendResult = await this.eventStore.append(pendingEvents, expectedVersions, appendMeta);
        storedEvents.push(...appendResult.events);
        pendingEvents.length = 0;
      }
    }

    // Flush any remaining events (e.g. if event_emission stage was skipped/failed early).
    if (pendingEvents.length > 0) {
      const appendMeta: import('../events').AppendMetadata = {
        intentId: intent.id,
        correlationId: ctx.correlationId,
        actor: ctx.actor.id,
        environment: ctx.environment,
        timestamp: this.clock.now(),
      };
      const expectedVersions = new Map<string, number>();
      for (const ev of pendingEvents) {
        const v = this.eventStore.streamVersion(ev.streamId);
        if (v !== undefined && !expectedVersions.has(ev.streamId)) {
          expectedVersions.set(ev.streamId, v);
        }
      }
      const appendResult = await this.eventStore.append(pendingEvents, expectedVersions, appendMeta);
      storedEvents.push(...appendResult.events);
      pendingEvents.length = 0;
    }

    const execTrace: ExecutionTrace = trace.finalize(
      finalStatus === 'completed' ? 'completed' : finalStatus === 'paused' ? 'running' : 'failed',
      this.clock.now(),
    );

    return {
      intent,
      trace: execTrace,
      decisions: recordedDecisions,
      events: storedEvents,
      status: finalStatus,
      error: errorStage,
    };
  }
}
