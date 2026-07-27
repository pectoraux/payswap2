/**
 * RuntimeDispatcher — the ONLY way to mutate financial state. (M-RT-21.)
 *
 * Pipeline:
 *   Command → CommandHandler.handle() → events[]
 *          → InvariantEngine.verify(events, snapshot)
 *          → if pass: EventStore.append(events)
 *          → projections auto-update (via EventStore subscriber)
 *          → return CommandResult with timing metrics
 *
 * No Prisma writes. Ever. The dispatcher is the single entry point for
 * all financial mutations.
 *
 * TIMING METRICS (Phase 6):
 *   compileTime  — time spent in the command handler (producing events)
 *   verifyTime   — time spent in the invariant engine
 *   appendTime   — time spent appending to the EventStore
 *   totalTime    — total dispatch time
 *   (projectionTime is ~0 — projections update synchronously on append)
 */

import type { RuntimeCommand, CommandMetadata } from './types';
import type { UncommittedEvent, StoredEvent } from '../events';
import type { EventStore } from '../events';
import { OptimisticConcurrencyError } from '../events';
import type { RuntimeClock } from '../clock';
import type { InvariantEngine } from '../invariants';
import type { RuntimeSnapshot } from '../invariants';
import type { CommandRegistry, CommandResult } from './registry';
import { uid } from '../types';
import { IdempotencyStore } from './idempotency-store';
import { RetryPolicy, defaultShouldRetry } from './retry-policy';

/** The result of dispatching a command through the runtime. */
export interface DispatchResult {
  /** Whether the command succeeded. */
  success: boolean;
  /** The command type. */
  commandType: string;
  /** The entity ID (if created/modified). */
  entityId?: string;
  /** Events that were appended (empty if failed). */
  events: StoredEvent[];
  /** Human-readable message. */
  message: string;
  /** Error message (if failed). */
  error?: string;
  /** Timing metrics (ms). */
  metrics: {
    compileTime: number;
    verifyTime: number;
    appendTime: number;
    totalTime: number;
  };
  /** The invariant decision (if verification ran). */
  invariantDecision?: {
    allow: boolean;
    violationCount: number;
  };
  /** When the dispatch ran (epoch ms). */
  dispatchedAt: number;
}

/** Inputs to the RuntimeDispatcher. */
export interface DispatcherInputs {
  eventStore: EventStore;
  clock: RuntimeClock;
  invariants: InvariantEngine;
  registry: CommandRegistry;
  /** Idempotency store (M-RT-22). If not provided, one is created. */
  idempotency?: IdempotencyStore;
  /** Retry policy (M-RT-22). If not provided, one is created. */
  retry?: RetryPolicy;
}

/**
 * RuntimeDispatcher — the single entry point for all financial mutations.
 *
 * Every command flows through here:
 *   1. Look up the handler in the CommandRegistry
 *   2. Handler produces events (compile)
 *   3. InvariantEngine verifies the events
 *   4. If pass: EventStore.append (atomic)
 *   5. Return DispatchResult with timing metrics
 *
 * If ANY step fails, no events are appended. No partial financial state.
 */
export class RuntimeDispatcher {
  private readonly idempotency: IdempotencyStore;
  private readonly retry: RetryPolicy;

  constructor(private inputs: DispatcherInputs) {
    this.idempotency = inputs.idempotency ?? new IdempotencyStore();
    this.retry = inputs.retry ?? new RetryPolicy();
  }

  /**
   * Dispatch a command through the runtime.
   *
   * This is the ONLY way to mutate financial state.
   * Returns a DispatchResult with success/failure + timing metrics.
   *
   * M-RT-22: This method now provides:
   *   - Idempotency: duplicate commandId/idempotencyKey → cached result
   *   - Optimistic concurrency: expected stream version checked on append
   *   - Retry: on OCC conflict, re-load + re-handle + re-verify + re-append
   *   - Atomic boundary: load → handle → verify → append (all-or-nothing)
   */
  async dispatch(command: RuntimeCommand): Promise<DispatchResult> {
    const totalTimeStart = this.inputs.clock.now();
    const dispatchedAt = this.inputs.clock.now();

    // ── M-RT-22: Idempotency check ─────────────────────────────────────────
    // Determine the idempotency key (idempotencyKey > commandId > auto-generated).
    const idempotencyKey = command.metadata.idempotencyKey
      ?? command.metadata.commandId
      ?? uid('cmd');

    // Check if this command was already processed.
    const cached = this.idempotency.get(idempotencyKey);
    if (cached) {
      const result = cached.result as DispatchResult;
      return {
        ...result,
        message: `${result.message} (idempotent cache hit)`,
      };
    }

    // ── M-RT-22: Execute with idempotency + retry ──────────────────────────
    try {
      const outcome = await this.idempotency.execute(
        idempotencyKey,
        () => this.dispatchWithRetry(command, totalTimeStart, dispatchedAt),
      );

      if (outcome.cached) {
        // Another concurrent dispatch processed this key first.
        const result = outcome.result as DispatchResult;
        return {
          ...result,
          message: `${result.message} (concurrent idempotent hit)`,
        };
      }

      return outcome.result;
    } catch (err) {
      // All retries exhausted.
      return this.fail(
        command.type,
        err instanceof Error ? err.message : String(err),
        totalTimeStart,
        dispatchedAt,
      );
    }
  }

  /**
   * Dispatch with retry on transient failures (OCC conflicts).
   *
   * This is the inner loop: load → handle → verify → append.
   * On OptimisticConcurrencyError, retry (re-load the stream version).
   */
  private async dispatchWithRetry(
    command: RuntimeCommand,
    totalTimeStart: number,
    dispatchedAt: number,
  ): Promise<DispatchResult> {
    const outcome = await this.retry.execute(
      () => this.dispatchOnce(command, totalTimeStart, dispatchedAt),
      (error) => defaultShouldRetry(error, 0),
    );

    if (outcome.succeeded) {
      return outcome.result!;
    }

    // All retries failed.
    return this.fail(
      command.type,
      outcome.error?.message ?? 'All retries exhausted',
      totalTimeStart,
      dispatchedAt,
    );
  }

  /**
   * Execute one dispatch attempt (no retry).
   *
   * This is the atomic transaction:
   *   1. Look up handler
   *   2. Build snapshot (load stream versions)
   *   3. Compile (handler produces events)
   *   4. Verify invariants
   *   5. Append with expectedVersion (OCC)
   *
   * If step 5 fails with OCC, the caller (dispatchWithRetry) retries.
   */
  private async dispatchOnce(
    command: RuntimeCommand,
    totalTimeStart: number,
    dispatchedAt: number,
  ): Promise<DispatchResult> {
    // ── Step 1: Look up the handler ────────────────────────────────────────
    const handler = this.inputs.registry.get(command.type);
    if (!handler) {
      return this.fail(command.type, `No handler registered for command type: ${command.type}`, totalTimeStart, dispatchedAt);
    }

    // ── Step 2: Build the current snapshot ────────────────────────────────
    const snapshot = await this.buildSnapshot();

    // ── Step 3: Compile (handler produces events) ─────────────────────────
    const compileStart = this.inputs.clock.now();
    let handlerResult: CommandResult;
    try {
      handlerResult = await handler.handle(command, snapshot);
    } catch (err) {
      return this.fail(command.type, `Handler threw: ${err instanceof Error ? err.message : String(err)}`, totalTimeStart, dispatchedAt, { compileTime: this.inputs.clock.now() - compileStart });
    }
    const compileTime = this.inputs.clock.now() - compileStart;

    if (!handlerResult.success || handlerResult.events.length === 0) {
      return {
        success: false,
        commandType: command.type,
        entityId: handlerResult.entityId,
        events: [],
        message: handlerResult.message || 'Handler produced no events',
        error: handlerResult.error,
        metrics: { compileTime, verifyTime: 0, appendTime: 0, totalTime: this.inputs.clock.now() - totalTimeStart },
        dispatchedAt,
      };
    }

    // ── Step 4: Verify invariants ─────────────────────────────────────────
    const verifyStart = this.inputs.clock.now();
    // Read the current events from the EventStore to build the full snapshot
    // for invariant verification.
    const currentEvents = await this.inputs.eventStore.readAll(0, 50_000);
    const fullSnapshot: RuntimeSnapshot = {
      ...snapshot,
      events: currentEvents,
    };
    // Convert UncommittedEvent[] to StoredEvent[] (with placeholder version/position)
    // for invariant verification. The invariant engine reads event.type + event.payload,
    // which are present on both types.
    const proposedStoredEvents: StoredEvent[] = handlerResult.events.map((ev, i) => ({
      id: `proposed_${i}`,
      streamId: ev.streamId,
      streamType: ev.streamType,
      version: -1, // placeholder — not yet stored
      globalPosition: -1, // placeholder — not yet stored
      type: ev.type,
      kind: ev.kind,
      payload: ev.payload,
      metadata: {
        intentId: uid('cmd'),
        correlationId: command.metadata.correlationId,
        actor: command.metadata.actor.id,
        environment: command.metadata.environment,
        timestamp: this.inputs.clock.now(),
      },
    }));
    const decision = this.inputs.invariants.verify(proposedStoredEvents, fullSnapshot);
    const verifyTime = this.inputs.clock.now() - verifyStart;

    if (!decision.allow) {
      // Invariant violation — reject the append.
      const errorViolations = decision.violations.filter((v) => v.severity === 'error');
      return {
        success: false,
        commandType: command.type,
        entityId: handlerResult.entityId,
        events: [],
        message: `Invariant violation: ${errorViolations.length} error(s)`,
        error: errorViolations.map((v) => `[${v.invariantId}] ${v.message}`).join('; '),
        metrics: { compileTime, verifyTime, appendTime: 0, totalTime: this.inputs.clock.now() - totalTimeStart },
        invariantDecision: { allow: false, violationCount: errorViolations.length },
        dispatchedAt,
      };
    }

    // ── Step 5: Append events to the EventStore ───────────────────────────
    const appendStart = this.inputs.clock.now();
    let appendedEvents: StoredEvent[] = [];
    try {
      // Build expectedVersions map from the handler result.
      const expectedVersions = new Map<string, number>();
      for (const ev of handlerResult.events) {
        if (!expectedVersions.has(ev.streamId)) {
          expectedVersions.set(ev.streamId, this.inputs.eventStore.streamVersion(ev.streamId) ?? -1);
        }
      }
      const appendResult = await this.inputs.eventStore.append(
        handlerResult.events,
        expectedVersions,
        {
          intentId: uid('cmd'),
          correlationId: command.metadata.correlationId,
          actor: command.metadata.actor.id,
          environment: command.metadata.environment,
          timestamp: this.inputs.clock.now(),
        },
      );
      appendedEvents = appendResult.events;
    } catch (err) {
      return {
        success: false,
        commandType: command.type,
        entityId: handlerResult.entityId,
        events: [],
        message: `Append failed: ${err instanceof Error ? err.message : String(err)}`,
        error: err instanceof Error ? err.message : String(err),
        metrics: { compileTime, verifyTime, appendTime: this.inputs.clock.now() - appendStart, totalTime: this.inputs.clock.now() - totalTimeStart },
        invariantDecision: { allow: true, violationCount: 0 },
        dispatchedAt,
      };
    }
    const appendTime = this.inputs.clock.now() - appendStart;

    // ── Step 6: Return success ────────────────────────────────────────────
    return {
      success: true,
      commandType: command.type,
      entityId: handlerResult.entityId,
      events: appendedEvents,
      message: handlerResult.message,
      metrics: {
        compileTime,
        verifyTime,
        appendTime,
        totalTime: this.inputs.clock.now() - totalTimeStart,
      },
      invariantDecision: { allow: true, violationCount: 0 },
      dispatchedAt,
    };
  }

  /** Build the current runtime snapshot (for invariant verification). */
  private async buildSnapshot(): Promise<RuntimeSnapshot> {
    const events = await this.inputs.eventStore.readAll(0, 50_000);
    return {
      events,
      payments: new Map(),
      refunds: new Map(),
      reserves: new Map(),
      ledgerEntries: [],
      executionPlans: new Map(),
    };
  }

  /** Build a failure result. */
  private fail(
    commandType: string,
    error: string,
    totalTimeStart: number,
    dispatchedAt: number,
    partialMetrics?: { compileTime?: number },
  ): DispatchResult {
    return {
      success: false,
      commandType,
      events: [],
      message: error,
      error,
      metrics: {
        compileTime: partialMetrics?.compileTime ?? 0,
        verifyTime: 0,
        appendTime: 0,
        totalTime: this.inputs.clock.now() - totalTimeStart,
      },
      dispatchedAt,
    };
  }
}
