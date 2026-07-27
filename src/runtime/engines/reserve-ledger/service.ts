/**
 * ReserveLedgerService — the ONLY writer to the Reserve Ledger. (M-RT-3.)
 *
 * Responsibilities:
 *   1. Create reserves (emit reserve.created)
 *   2. Execute transitions (lock/unlock/consume/release/replenish)
 *   3. Enforce invariants BEFORE every event append (simulate → check → append)
 *   4. Emit exactly ONE Domain Event per transition
 *   5. Read current state by replaying events (via the projection)
 *
 * The ledger is NEVER mutated directly. All state changes flow through events.
 * The projection derives the current state. This is the same compiled-projection
 * discipline as the Capability Graph.
 */

import type { EventStore, StoredEvent } from '../../events';
import type { RuntimeClock } from '../../clock';
import type { Environment } from '../../types';
import type {
  Reserve,
  ReserveBalances,
  ReserveState,
  ReserveTransition,
  ReserveEventType,
  ReserveUncommittedEvent,
  BackingPolicy,
} from './types';
import { checkTransition, transitionToEventType, validateInvariants } from './types';
import { ReserveLedgerProjection } from './projection';

/** Thrown when a transition would violate an invariant. */
export class ReserveInvariantViolation extends Error {
  constructor(
    readonly reserveId: string,
    readonly transition: ReserveTransition,
    readonly violations: string[],
  ) {
    super(`Invariant violation on reserve ${reserveId} (${transition}): ${violations.join('; ')}`);
    this.name = 'ReserveInvariantViolation';
  }
}

/** Thrown when a reserve doesn't exist. */
export class ReserveNotFoundError extends Error {
  constructor(readonly reserveId: string) {
    super(`Reserve not found: ${reserveId}`);
    this.name = 'ReserveNotFoundError';
  }
}

/** The Reserve Ledger Service — the only writer. */
export class ReserveLedgerService {
  private projection = new ReserveLedgerProjection();

  constructor(
    private eventStore: EventStore,
    private clock: RuntimeClock,
  ) {}

  /** Create a new reserve. Emits reserve.created. */
  async create(params: {
    reserveId: string;
    asset: string;
    owner: string;
    jurisdiction: string;
    backingPolicy: BackingPolicy;
    environment: Environment;
    actorId: string;
    correlationId: string;
  }): Promise<ReserveState> {
    const streamId = `${params.environment}:reserve:${params.reserveId}`;

    // Check the reserve doesn't already exist.
    const existing = await this.getState(params.reserveId, params.environment);
    if (existing) {
      throw new Error(`Reserve ${params.reserveId} already exists`);
    }

    const event: ReserveUncommittedEvent = {
      type: 'reserve.created',
      streamId,
      streamType: 'reserve',
      kind: 'domain',
      payload: {
        reserveId: params.reserveId,
        asset: params.asset,
        owner: params.owner,
        jurisdiction: params.jurisdiction,
        backingPolicy: params.backingPolicy,
        amount: 0,
        reason: 'Reserve created',
      },
    };

    await this.appendEvents([event], streamId, params);
    return (await this.getState(params.reserveId, params.environment))!;
  }

  /** Execute a transition (lock/unlock/consume/release/replenish). Enforces invariants. */
  async transition(params: {
    reserveId: string;
    transition: ReserveTransition;
    amount: number;
    reason: string;
    operationId?: string;
    source?: string;
    environment: Environment;
    actorId: string;
    correlationId: string;
  }): Promise<ReserveState> {
    const { reserveId, transition, amount, environment } = params;

    // 1. Read current state (by replaying events).
    const current = await this.getState(reserveId, environment);
    if (!current) throw new ReserveNotFoundError(reserveId);

    // 2. Simulate the transition + check invariants BEFORE appending.
    const { valid, violations } = checkTransition(current.balances, transition, amount);
    if (!valid) {
      throw new ReserveInvariantViolation(reserveId, transition, violations);
    }

    // 3. Emit exactly one Domain Event.
    const streamId = `${environment}:reserve:${reserveId}`;
    const eventType = transitionToEventType(transition);
    const event: ReserveUncommittedEvent = {
      type: eventType,
      streamId,
      streamType: 'reserve',
      kind: 'domain',
      payload: {
        reserveId,
        amount,
        reason: params.reason,
        operationId: params.operationId,
        source: params.source,
      },
    };

    await this.appendEvents([event], streamId, params);

    // 4. Return the new state (re-read from events — never trust in-memory mutation).
    return (await this.getState(reserveId, environment))!;
  }

  /** Read the current state of a reserve (by replaying its event stream). */
  async getState(reserveId: string, environment: Environment): Promise<ReserveState | null> {
    const streamId = `${environment}:reserve:${reserveId}`;
    const events = await this.eventStore.readStream(streamId);
    if (events.length === 0) return null;
    return this.projection.rebuild(events);
  }

  /** Read all reserves in an environment (scans event streams). */
  async listReserves(environment: Environment): Promise<ReserveState[]> {
    // M-RT-3: scan the global log for reserve.created events.
    // (In production, a projection maintains an index; for now, scan.)
    const allEvents = await this.eventStore.readAll(0, 10000);
    const createdEvents = allEvents.filter(
      (e) => e.type === 'reserve.created' && e.metadata.environment === environment,
    );
    const states: ReserveState[] = [];
    for (const ev of createdEvents) {
      const payload = ev.payload as { reserveId: string };
      const state = await this.getState(payload.reserveId, environment);
      if (state) states.push(state);
    }
    return states;
  }

  /**
   * Replay verification: rebuild state from events and verify invariants hold.
   * This is part of the implementation, not just a test (Principle 6).
   */
  async verifyReplay(reserveId: string, environment: Environment): Promise<{
    valid: boolean;
    state: ReserveState | null;
    violations: string[];
  }> {
    const state = await this.getState(reserveId, environment);
    if (!state) return { valid: true, state: null, violations: [] };
    const violations = validateInvariants(state.balances);
    return { valid: violations.length === 0, state, violations };
  }

  // ── private ──────────────────────────────────────────────────────────

  private async appendEvents(
    events: ReserveUncommittedEvent[],
    streamId: string,
    params: { environment: Environment; actorId: string; correlationId: string },
  ): Promise<void> {
    const expectedVersion = this.eventStore.streamVersion(streamId) ?? -1;
    await this.eventStore.append(
      events,
      new Map([[streamId, expectedVersion]]),
      {
        intentId: params.correlationId,
        correlationId: params.correlationId,
        actor: params.actorId,
        environment: params.environment,
        timestamp: this.clock.now(),
      },
    );
  }
}
