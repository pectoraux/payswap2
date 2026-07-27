/**
 * ReserveLedgerProjection — rebuilds reserve balances from the Domain Event
 * stream. (M-RT-3.)
 *
 * The projection is the ONLY thing that produces ReserveState. The ledger is
 * NEVER mutated directly — all state changes flow through events, and this
 * projection derives the current state by replaying them.
 *
 * This gives: deterministic replay, auditing, simulation, time travel, and
 * Digital Twin support — without additional work later. Replaying the same
 * event stream always reconstructs the same ledger (Principle 6).
 */

import type { StoredEvent } from '../../events';
import type {
  Reserve,
  ReserveBalances,
  ReserveState,
  ReserveEventPayload,
} from './types';

/** A handler that applies a reserve event to a ReserveState (pure function). */
export class ReserveLedgerProjection {
  /** Rebuild the full state of a reserve from its event stream. */
  rebuild(events: StoredEvent[]): ReserveState | null {
    if (events.length === 0) return null;

    let state: ReserveState | null = null;

    for (const event of events) {
      state = this.apply(event, state);
    }

    return state;
  }

  /** Apply one event to an existing state (or create from reserve.created). */
  apply(event: StoredEvent, current: ReserveState | null): ReserveState {
    const payload = event.payload as unknown as ReserveEventPayload;

    switch (event.type) {
      case 'reserve.created': {
        // Create a new reserve with zero balances.
        const reserve: Reserve = {
          id: payload.reserveId,
          asset: (event.payload as { asset?: string }).asset ?? '',
          owner: (event.payload as { owner?: string }).owner ?? '',
          jurisdiction: (event.payload as { jurisdiction?: string }).jurisdiction ?? '',
          backingPolicy: (event.payload as { backingPolicy?: Reserve['backingPolicy'] }).backingPolicy ?? 'fiat_full',
          createdAt: event.metadata.timestamp,
        };
        return {
          reserve,
          balances: { available: 0, locked: 0, pending: 0, consumed: 0, released: 0 },
          version: event.version,
        };
      }

      case 'reserve.funded':
      case 'reserve.locked':
      case 'reserve.unlocked':
      case 'reserve.consumed':
      case 'reserve.released':
      case 'reserve.adjusted': {
        if (!current) {
          throw new Error(`Cannot apply ${event.type} to non-existent reserve ${payload.reserveId}`);
        }
        const newBalances = this.applyTransition(current.balances, event.type, payload.amount);
        return {
          reserve: current.reserve,
          balances: newBalances,
          version: event.version,
        };
      }

      default:
        return current ?? stateThrow(event.type);
    }
  }

  /** Apply a transition to balances (pure). */
  private applyTransition(
    balances: ReserveBalances,
    eventType: string,
    amount: number,
  ): ReserveBalances {
    const next: ReserveBalances = { ...balances };

    switch (eventType) {
      case 'reserve.funded':
        next.available += amount;
        break;
      case 'reserve.locked':
        next.available -= amount;
        next.locked += amount;
        break;
      case 'reserve.unlocked':
        next.locked -= amount;
        next.available += amount;
        break;
      case 'reserve.consumed':
        next.locked -= amount;
        next.consumed += amount;
        break;
      case 'reserve.released':
        next.consumed -= amount;
        next.released += amount;
        break;
      case 'reserve.adjusted':
        // Manual adjustment: amount can be + or - on available.
        next.available += amount;
        break;
    }

    return next;
  }
}

function stateThrow(eventType: string): never {
  throw new Error(`Unknown reserve event type: ${eventType}`);
}
