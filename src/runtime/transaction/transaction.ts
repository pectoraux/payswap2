/**
 * Runtime Transaction — the atomic unit of execution. (M-RT-26.)
 *
 * Every financial mutation in PaySwap executes inside a RuntimeTransaction.
 * The Transaction Coordinator is the ONLY component allowed to commit events.
 *
 *   Runtime → Transaction Coordinator → Dispatcher → Handlers
 *          → Invariant Engine → EventStore → Projections
 *
 * The transaction is immutable after Commit. If any step fails, Rollback
 * discards all generated events — no partial projections, no partial state.
 *
 * Lifecycle:
 *   pending → in_progress → verifying → committing → committed
 *                                                   → rolled_back
 *                          → aborted
 */

import type { RuntimeCommand } from '../dispatcher/types';
import type { UncommittedEvent, StoredEvent } from '../events';
import type { RuntimeSnapshot, VerificationDecision } from '../invariants';

/** Transaction status. */
export type TransactionStatus =
  | 'pending'        // created, not started
  | 'in_progress'    // handler running, generating events
  | 'verifying'      // invariant engine running
  | 'committing'     // appending to EventStore
  | 'committed'      // successfully committed (immutable)
  | 'rolled_back'    // rolled back (no events appended)
  | 'aborted';       // aborted (error before commit)

/** A nested command within a transaction. */
export interface NestedCommand {
  command: RuntimeCommand;
  handlerResult: {
    success: boolean;
    events: UncommittedEvent[];
    entityId?: string;
    message: string;
    error?: string;
  } | null;
}

/** Transaction observability metadata (M-RT-26 Phase 8). */
export interface TransactionObservability {
  /** Transaction ID. */
  transactionId: string;
  /** When the transaction started (epoch ms). */
  startedAt: number;
  /** When the transaction completed (epoch ms, or null if in progress). */
  completedAt: number | null;
  /** Total duration (ms, or null if in progress). */
  durationMs: number | null;
  /** All commands executed (for nested commands, multiple). */
  commands: NestedCommand[];
  /** All events generated (before commit). */
  generatedEvents: UncommittedEvent[];
  /** All events actually appended (after commit). */
  appendedEvents: StoredEvent[];
  /** Stream IDs touched. */
  streams: string[];
  /** Expected versions captured at transaction start. */
  expectedVersions: Map<string, number>;
  /** Number of retries (OCC conflicts). */
  retries: number;
  /** Rollback reason (if rolled back). */
  rollbackReason: string | null;
  /** Invariant verification result. */
  invariantResult: VerificationDecision | null;
  /** Projections affected (by name). */
  affectedProjections: string[];
  /** Final status. */
  status: TransactionStatus;
}

/**
 * RuntimeTransaction — the atomic unit of execution.
 *
 * Lifecycle:
 *   1. Begin() — capture snapshot + expected versions
 *   2. Append(events) — buffer events from handlers (no EventStore write)
 *   3. Verify() — run invariant engine against buffered events
 *   4. Commit() — append all buffered events to EventStore atomically
 *   5. Rollback() — discard all buffered events (no EventStore write)
 *
 * The transaction is IMMUTABLE after Commit or Rollback.
 */
export class RuntimeTransaction {
  readonly id: string;
  readonly startedAt: number;
  status: TransactionStatus = 'pending';

  /** The command that initiated this transaction. */
  readonly command: RuntimeCommand;

  /** Snapshot captured at Begin() (read-only). */
  snapshot: RuntimeSnapshot | null = null;

  /** Expected stream versions captured at Begin(). */
  expectedVersions: Map<string, number> = new Map();

  /** Events buffered from handlers (not yet committed). */
  bufferedEvents: UncommittedEvent[] = [];

  /** Events actually appended (after Commit). */
  appendedEvents: StoredEvent[] = [];

  /** Nested commands (for multi-command transactions). */
  nestedCommands: NestedCommand[] = [];

  /** Invariant verification result. */
  invariantResult: VerificationDecision | null = null;

  /** Rollback reason. */
  rollbackReason: string | null = null;

  /** Number of retries. */
  retries: 0 = 0;

  /** Affected projections (computed at commit). */
  affectedProjections: string[] = [];

  private completedAt: number | null = null;

  constructor(id: string, command: RuntimeCommand) {
    this.id = id;
    this.startedAt = Date.now();
    this.command = command;
  }

  /** Begin the transaction: capture snapshot + expected versions. */
  begin(snapshot: RuntimeSnapshot, expectedVersions: Map<string, number>): void {
    if (this.status !== 'pending') {
      throw new Error(`Cannot begin transaction in status: ${this.status}`);
    }
    this.snapshot = snapshot;
    this.expectedVersions = new Map(expectedVersions);
    this.status = 'in_progress';
  }

  /** Append events to the transaction buffer (does NOT write to EventStore). */
  append(events: UncommittedEvent[]): void {
    if (this.status !== 'in_progress') {
      throw new Error(`Cannot append events to transaction in status: ${this.status}`);
    }
    this.bufferedEvents.push(...events);
  }

  /** Record a nested command (for multi-command transactions). */
  recordNestedCommand(cmd: NestedCommand): void {
    this.nestedCommands.push(cmd);
  }

  /** Verify invariants against buffered events. */
  verify(result: VerificationDecision): void {
    if (this.status !== 'in_progress') {
      throw new Error(`Cannot verify transaction in status: ${this.status}`);
    }
    this.invariantResult = result;
    this.status = 'verifying';
  }

  /** Commit: events are appended to the EventStore. Transaction becomes immutable. */
  commit(appendedEvents: StoredEvent[], affectedProjections: string[]): void {
    if (this.status !== 'verifying') {
      throw new Error(`Cannot commit transaction in status: ${this.status}`);
    }
    this.appendedEvents = appendedEvents;
    this.affectedProjections = affectedProjections;
    this.status = 'committing';
    this.completedAt = Date.now();
    this.status = 'committed';
  }

  /** Rollback: discard all buffered events. Transaction becomes immutable. */
  rollback(reason: string): void {
    if (this.status === 'committed' || this.status === 'rolled_back') {
      throw new Error(`Cannot rollback transaction in status: ${this.status}`);
    }
    this.rollbackReason = reason;
    this.completedAt = Date.now();
    this.status = 'rolled_back';
  }

  /** Abort: transaction failed before verification. */
  abort(reason: string): void {
    this.rollbackReason = reason;
    this.completedAt = Date.now();
    this.status = 'aborted';
  }

  /** Whether the transaction is committed. */
  isCommitted(): boolean {
    return this.status === 'committed';
  }

  /** Whether the transaction was rolled back. */
  isRolledBack(): boolean {
    return this.status === 'rolled_back';
  }

  /** Get the stream IDs touched by this transaction. */
  getStreams(): string[] {
    return [...new Set(this.bufferedEvents.map((e) => e.streamId))];
  }

  /** Get observability metadata. */
  getObservability(): TransactionObservability {
    return {
      transactionId: this.id,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      durationMs: this.completedAt !== null ? this.completedAt - this.startedAt : null,
      commands: this.nestedCommands,
      generatedEvents: this.bufferedEvents,
      appendedEvents: this.appendedEvents,
      streams: this.getStreams(),
      expectedVersions: this.expectedVersions,
      retries: this.retries,
      rollbackReason: this.rollbackReason,
      invariantResult: this.invariantResult,
      affectedProjections: this.affectedProjections,
      status: this.status,
    };
  }
}
