/**
 * Transaction Coordinator — the ONLY component allowed to commit events.
 * (M-RT-26.)
 *
 *   Runtime → Transaction Coordinator → Dispatcher → Handlers
 *          → Invariant Engine → EventStore → Projections
 *
 * The coordinator replaces the dispatcher's direct append. Every financial
 * mutation now flows through a RuntimeTransaction:
 *
 *   Begin Transaction → Handle Command → Generate Events → Verify Invariants
 *   → Append Events → Commit Transaction
 *
 * If any step fails, Rollback discards all events — no partial projections.
 *
 * PHASE 3 — PROJECTION ISOLATION:
 *   Events are buffered in the transaction until Commit. The ProjectionRunner
 *   only fires AFTER the EventStore append succeeds. This prevents partially
 *   updated projections during multi-step transactions.
 */

import type { RuntimeCommand } from '../dispatcher/types';
import type { EventStore, StoredEvent, UncommittedEvent } from '../events';
import type { RuntimeClock } from '../clock';
import type { InvariantEngine } from '../invariants';
import type { RuntimeSnapshot } from '../invariants';
import type { CommandRegistry, CommandResult } from '../dispatcher/registry';
import { RuntimeTransaction, type TransactionObservability } from './transaction';
import { IdempotencyStore } from '../dispatcher/idempotency-store';
import { RetryPolicy, defaultShouldRetry } from '../dispatcher/retry-policy';
import { uid } from '../types';

/** Inputs to the TransactionCoordinator. */
export interface TransactionCoordinatorInputs {
  eventStore: EventStore;
  clock: RuntimeClock;
  invariants: InvariantEngine;
  registry: CommandRegistry;
  idempotency?: IdempotencyStore;
  retry?: RetryPolicy;
}

/** The result of executing a command through the coordinator. */
export interface TransactionResult {
  /** Whether the transaction committed. */
  success: boolean;
  /** Transaction ID. */
  transactionId: string;
  /** The command type. */
  commandType: string;
  /** Entity ID (if created/modified). */
  entityId?: string;
  /** Events appended (empty if rolled back). */
  events: StoredEvent[];
  /** Human-readable message. */
  message: string;
  /** Error (if failed). */
  error?: string;
  /** Observability metadata. */
  observability: TransactionObservability;
  /** Timing metrics (ms). */
  metrics: {
    compileTime: number;
    verifyTime: number;
    appendTime: number;
    totalTime: number;
  };
}

/**
 * TransactionCoordinator — the kernel scheduler.
 *
 * Every command flows through here:
 *   1. Begin transaction (capture snapshot + expected versions)
 *   2. Handle command (handler produces events — buffered, NOT appended)
 *   3. Verify invariants (against buffered events + snapshot)
 *   4. Commit (append all buffered events atomically to EventStore)
 *   5. If any step fails: Rollback (discard all buffered events)
 *
 * Projection Isolation (Phase 3):
 *   The EventStore's subscriber (ProjectionRunner) fires synchronously on
 *   append. Since we only append at Commit, projections don't update until
 *   the transaction is fully committed. No partial projections.
 */
export class TransactionCoordinator {
  private readonly idempotency: IdempotencyStore;
  private readonly retry: RetryPolicy;
  /** Recent transactions (for the inspector). */
  private readonly recentTransactions: TransactionObservability[] = [];
  private readonly maxRecent = 100;

  constructor(private inputs: TransactionCoordinatorInputs) {
    this.idempotency = inputs.idempotency ?? new IdempotencyStore();
    this.retry = inputs.retry ?? new RetryPolicy();
  }

  /**
   * Execute a command inside a transaction.
   *
   * This is the ONLY way to mutate financial state.
   */
  async execute(command: RuntimeCommand): Promise<TransactionResult> {
    const totalTimeStart = this.inputs.clock.now();

    // Idempotency check.
    const idempotencyKey = command.metadata.idempotencyKey ?? command.metadata.commandId ?? uid('tx');
    const cached = this.idempotency.get(idempotencyKey);
    if (cached) {
      const result = cached.result as TransactionResult;
      return { ...result, message: `${result.message} (idempotent cache hit)` };
    }

    try {
      const outcome = await this.idempotency.execute(
        idempotencyKey,
        () => this.executeWithRetry(command, totalTimeStart),
      );

      if (outcome.cached) {
        const result = outcome.result as TransactionResult;
        return { ...result, message: `${result.message} (concurrent idempotent hit)` };
      }

      return outcome.result;
    } catch (err) {
      return this.fail(command, err instanceof Error ? err.message : String(err), totalTimeStart);
    }
  }

  /**
   * Execute with retry on OCC conflicts.
   */
  private async executeWithRetry(command: RuntimeCommand, totalTimeStart: number): Promise<TransactionResult> {
    const outcome = await this.retry.execute(
      () => this.executeOnce(command, totalTimeStart),
      (error) => defaultShouldRetry(error, 0),
    );

    if (outcome.succeeded) return outcome.result!;
    return this.fail(command, outcome.error?.message ?? 'All retries exhausted', totalTimeStart);
  }

  /**
   * Execute one transaction attempt (no retry).
   *
   * This is the atomic transaction:
   *   1. Begin (capture snapshot + expected versions)
   *   2. Handle (handler produces events — buffered)
   *   3. Verify (invariant engine checks buffered events)
   *   4. Commit (append to EventStore) or Rollback (discard)
   */
  private async executeOnce(command: RuntimeCommand, totalTimeStart: number): Promise<TransactionResult> {
    const tx = new RuntimeTransaction(uid('tx'), command);

    // ── Step 1: Begin — capture snapshot + expected versions ──────────────
    const snapshot = await this.buildSnapshot();
    const expectedVersions = new Map<string, number>();
    for (const ev of snapshot.events) {
      expectedVersions.set(ev.streamId, ev.version); // last version per stream
    }
    tx.begin(snapshot, expectedVersions);

    // ── Step 2: Handle — look up handler, produce events ──────────────────
    const handler = this.inputs.registry.get(command.type);
    if (!handler) {
      tx.abort(`No handler registered for command type: ${command.type}`);
      this.recordTransaction(tx);
      throw new Error(`No handler registered: ${command.type}`);
    }

    const compileStart = this.inputs.clock.now();
    let handlerResult: CommandResult;
    try {
      handlerResult = await handler.handle(command, snapshot);
    } catch (err) {
      tx.abort(`Handler threw: ${err instanceof Error ? err.message : String(err)}`);
      this.recordTransaction(tx);
      throw err;
    }
    const compileTime = this.inputs.clock.now() - compileStart;

    if (!handlerResult.success || handlerResult.events.length === 0) {
      tx.abort(handlerResult.message || 'Handler produced no events');
      this.recordTransaction(tx);
      return {
        success: false,
        transactionId: tx.id,
        commandType: command.type,
        entityId: handlerResult.entityId,
        events: [],
        message: handlerResult.message || 'Handler produced no events',
        error: handlerResult.error,
        observability: tx.getObservability(),
        metrics: { compileTime, verifyTime: 0, appendTime: 0, totalTime: this.inputs.clock.now() - totalTimeStart },
      };
    }

    // Buffer events (do NOT append yet).
    tx.append(handlerResult.events);
    tx.recordNestedCommand({ command, handlerResult });

    // ── Step 3: Verify invariants ─────────────────────────────────────────
    const verifyStart = this.inputs.clock.now();
    const proposedStoredEvents: StoredEvent[] = handlerResult.events.map((ev, i) => ({
      id: `proposed_${i}`,
      streamId: ev.streamId,
      streamType: ev.streamType,
      version: -1,
      globalPosition: -1,
      type: ev.type,
      kind: ev.kind,
      payload: ev.payload,
      metadata: {
        intentId: tx.id,
        correlationId: command.metadata.correlationId,
        actor: command.metadata.actor.id,
        environment: command.metadata.environment,
        timestamp: this.inputs.clock.now(),
      },
    }));

    const decision = this.inputs.invariants.verify(proposedStoredEvents, snapshot);
    tx.verify(decision);
    const verifyTime = this.inputs.clock.now() - verifyStart;

    if (!decision.allow) {
      const errorViolations = decision.violations.filter((v) => v.severity === 'error');
      tx.rollback(`Invariant violation: ${errorViolations.length} error(s)`);
      this.recordTransaction(tx);
      return {
        success: false,
        transactionId: tx.id,
        commandType: command.type,
        entityId: handlerResult.entityId,
        events: [],
        message: `Transaction rolled back: invariant violation`,
        error: errorViolations.map((v) => `[${v.invariantId}] ${v.message}`).join('; '),
        observability: tx.getObservability(),
        metrics: { compileTime, verifyTime, appendTime: 0, totalTime: this.inputs.clock.now() - totalTimeStart },
      };
    }

    // ── Step 4: Commit — append to EventStore atomically ──────────────────
    const appendStart = this.inputs.clock.now();
    let appendedEvents: StoredEvent[] = [];
    try {
      // Use expected versions from the transaction (captured at Begin).
      const txExpectedVersions = new Map<string, number>();
      for (const ev of tx.bufferedEvents) {
        if (!txExpectedVersions.has(ev.streamId)) {
          txExpectedVersions.set(ev.streamId, tx.expectedVersions.get(ev.streamId) ?? -1);
        }
      }

      const appendResult = await this.inputs.eventStore.append(
        tx.bufferedEvents,
        txExpectedVersions,
        {
          intentId: tx.id,
          correlationId: command.metadata.correlationId,
          actor: command.metadata.actor.id,
          environment: command.metadata.environment,
          timestamp: this.inputs.clock.now(),
        },
      );
      appendedEvents = appendResult.events;
    } catch (err) {
      // OCC error → re-throw for retry policy.
      tx.rollback(`Append failed: ${err instanceof Error ? err.message : String(err)}`);
      this.recordTransaction(tx);
      throw err;
    }
    const appendTime = this.inputs.clock.now() - appendStart;

    // Determine affected projections (from event types).
    const affectedProjections = this.getAffectedProjections(tx.bufferedEvents);

    // Commit the transaction.
    tx.commit(appendedEvents, affectedProjections);
    this.recordTransaction(tx);

    return {
      success: true,
      transactionId: tx.id,
      commandType: command.type,
      entityId: handlerResult.entityId,
      events: appendedEvents,
      message: handlerResult.message,
      observability: tx.getObservability(),
      metrics: {
        compileTime,
        verifyTime,
        appendTime,
        totalTime: this.inputs.clock.now() - totalTimeStart,
      },
    };
  }

  /**
   * Execute NESTED commands in a single transaction. (Phase 7.)
   *
   * All commands share the same snapshot, expected versions, and commit.
   * Either ALL commit or NONE commit.
   */
  async executeNested(commands: RuntimeCommand[], metadata: RuntimeCommand['metadata']): Promise<TransactionResult> {
    if (commands.length === 0) {
      return this.fail({ type: 'nested', payload: {}, metadata } as RuntimeCommand, 'No commands', this.inputs.clock.now());
    }

    const totalTimeStart = this.inputs.clock.now();
    const tx = new RuntimeTransaction(uid('tx'), commands[0]);

    // Begin.
    const snapshot = await this.buildSnapshot();
    const expectedVersions = new Map<string, number>();
    for (const ev of snapshot.events) {
      expectedVersions.set(ev.streamId, ev.version);
    }
    tx.begin(snapshot, expectedVersions);

    let totalCompileTime = 0;
    let entityIds: string[] = [];

    // Handle each command sequentially, buffering all events.
    for (const cmd of commands) {
      const handler = this.inputs.registry.get(cmd.type);
      if (!handler) {
        tx.abort(`No handler for nested command: ${cmd.type}`);
        this.recordTransaction(tx);
        return this.fail(cmd, `No handler: ${cmd.type}`, totalTimeStart);
      }

      const compileStart = this.inputs.clock.now();
      let result: CommandResult;
      try {
        result = await handler.handle(cmd, snapshot);
      } catch (err) {
        tx.abort(`Nested handler threw: ${err instanceof Error ? err.message : String(err)}`);
        this.recordTransaction(tx);
        return this.fail(cmd, err instanceof Error ? err.message : String(err), totalTimeStart);
      }
      totalCompileTime += this.inputs.clock.now() - compileStart;

      if (!result.success) {
        tx.abort(`Nested command failed: ${result.message}`);
        this.recordTransaction(tx);
        return {
          success: false,
          transactionId: tx.id,
          commandType: cmd.type,
          events: [],
          message: `Nested transaction aborted: ${result.message}`,
          error: result.error,
          observability: tx.getObservability(),
          metrics: { compileTime: totalCompileTime, verifyTime: 0, appendTime: 0, totalTime: this.inputs.clock.now() - totalTimeStart },
        };
      }

      tx.append(result.events);
      tx.recordNestedCommand({ command: cmd, handlerResult: result });
      if (result.entityId) entityIds.push(result.entityId);
    }

    // Verify all buffered events.
    const verifyStart = this.inputs.clock.now();
    const proposedStoredEvents: StoredEvent[] = tx.bufferedEvents.map((ev, i) => ({
      id: `proposed_${i}`,
      streamId: ev.streamId,
      streamType: ev.streamType,
      version: -1,
      globalPosition: -1,
      type: ev.type,
      kind: ev.kind,
      payload: ev.payload,
      metadata: {
        intentId: tx.id,
        correlationId: metadata.correlationId,
        actor: metadata.actor.id,
        environment: metadata.environment,
        timestamp: this.inputs.clock.now(),
      },
    }));

    const decision = this.inputs.invariants.verify(proposedStoredEvents, snapshot);
    tx.verify(decision);
    const verifyTime = this.inputs.clock.now() - verifyStart;

    if (!decision.allow) {
      const errorViolations = decision.violations.filter((v) => v.severity === 'error');
      tx.rollback(`Invariant violation in nested transaction: ${errorViolations.length} error(s)`);
      this.recordTransaction(tx);
      return {
        success: false,
        transactionId: tx.id,
        commandType: 'nested',
        events: [],
        message: 'Nested transaction rolled back: invariant violation',
        error: errorViolations.map((v) => `[${v.invariantId}] ${v.message}`).join('; '),
        observability: tx.getObservability(),
        metrics: { compileTime: totalCompileTime, verifyTime, appendTime: 0, totalTime: this.inputs.clock.now() - totalTimeStart },
      };
    }

    // Commit.
    const appendStart = this.inputs.clock.now();
    let appendedEvents: StoredEvent[] = [];
    try {
      const txExpectedVersions = new Map<string, number>();
      for (const ev of tx.bufferedEvents) {
        if (!txExpectedVersions.has(ev.streamId)) {
          txExpectedVersions.set(ev.streamId, tx.expectedVersions.get(ev.streamId) ?? -1);
        }
      }
      const appendResult = await this.inputs.eventStore.append(
        tx.bufferedEvents,
        txExpectedVersions,
        {
          intentId: tx.id,
          correlationId: metadata.correlationId,
          actor: metadata.actor.id,
          environment: metadata.environment,
          timestamp: this.inputs.clock.now(),
        },
      );
      appendedEvents = appendResult.events;
    } catch (err) {
      tx.rollback(`Append failed: ${err instanceof Error ? err.message : String(err)}`);
      this.recordTransaction(tx);
      throw err;
    }
    const appendTime = this.inputs.clock.now() - appendStart;

    const affectedProjections = this.getAffectedProjections(tx.bufferedEvents);
    tx.commit(appendedEvents, affectedProjections);
    this.recordTransaction(tx);

    return {
      success: true,
      transactionId: tx.id,
      commandType: 'nested',
      entityId: entityIds[0],
      events: appendedEvents,
      message: `Nested transaction committed: ${commands.length} commands, ${appendedEvents.length} events`,
      observability: tx.getObservability(),
      metrics: { compileTime: totalCompileTime, verifyTime, appendTime, totalTime: this.inputs.clock.now() - totalTimeStart },
    };
  }

  /** Get recent transactions (for the inspector). */
  getRecentTransactions(): TransactionObservability[] {
    return [...this.recentTransactions];
  }

  /** Build the current runtime snapshot. */
  private async buildSnapshot(): Promise<RuntimeSnapshot> {
    const events = await this.inputs.eventStore.readAll(0, 50_000);

    // Build wallet balances from wallet events (same as dispatcher).
    const wallets = new Map<string, { walletId: string; available: number; reserved: number; total: number; isClosed: boolean }>();
    const walletState = new Map<string, { credits: number; debits: number; reserved: number; released: number; isClosed: boolean }>();
    for (const ev of events) {
      if (ev.streamType !== 'wallet') continue;
      const payload = ev.payload as Record<string, unknown>;
      const walletId = payload.walletId as string;
      if (!walletId) continue;
      let state = walletState.get(walletId);
      if (!state) { state = { credits: 0, debits: 0, reserved: 0, released: 0, isClosed: false }; walletState.set(walletId, state); }
      switch (ev.type) {
        case 'wallet.credited': state.credits += payload.amount as number; break;
        case 'wallet.debited': state.debits += payload.amount as number; break;
        case 'wallet.reserved': state.reserved += payload.amount as number; break;
        case 'wallet.released': state.released += payload.amount as number; break;
        case 'wallet.closed': state.isClosed = true; break;
      }
    }
    for (const [walletId, state] of walletState) {
      const available = state.credits - state.debits - state.reserved + state.released;
      const reserved = state.reserved - state.released;
      wallets.set(walletId, { walletId, available, reserved, total: available + reserved, isClosed: state.isClosed });
    }

    return {
      events,
      payments: new Map(),
      refunds: new Map(),
      reserves: new Map(),
      wallets,
      ledgerEntries: [],
      executionPlans: new Map(),
    };
  }

  /** Determine which projections are affected by a set of events. */
  private getAffectedProjections(events: UncommittedEvent[]): string[] {
    const projections = new Set<string>();
    for (const ev of events) {
      switch (ev.streamType) {
        case 'payment': projections.add('payments'); break;
        case 'refund': projections.add('refunds'); break;
        case 'wallet': projections.add('wallets'); break;
        case 'treasury': projections.add('treasury'); break;
        case 'twin': projections.add('twinTokens'); break;
        case 'reserve': projections.add('reserveLedger'); break;
      }
    }
    return [...projections];
  }

  /** Record a transaction in the recent history. */
  private recordTransaction(tx: RuntimeTransaction): void {
    this.recentTransactions.push(tx.getObservability());
    if (this.recentTransactions.length > this.maxRecent) {
      this.recentTransactions.shift();
    }
  }

  /** Build a failure result. */
  private fail(command: RuntimeCommand, error: string, totalTimeStart: number): TransactionResult {
    return {
      success: false,
      transactionId: 'n/a',
      commandType: command.type,
      events: [],
      message: error,
      error,
      observability: {
        transactionId: 'n/a',
        startedAt: totalTimeStart,
        completedAt: this.inputs.clock.now(),
        durationMs: this.inputs.clock.now() - totalTimeStart,
        commands: [],
        generatedEvents: [],
        appendedEvents: [],
        streams: [],
        expectedVersions: new Map(),
        retries: 0,
        rollbackReason: error,
        invariantResult: null,
        affectedProjections: [],
        status: 'aborted',
      },
      metrics: { compileTime: 0, verifyTime: 0, appendTime: 0, totalTime: this.inputs.clock.now() - totalTimeStart },
    };
  }
}
