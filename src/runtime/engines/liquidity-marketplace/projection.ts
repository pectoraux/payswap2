/**
 * OrderBookProjection — rebuilds the order book from offer events. (M-RT-5.)
 *
 * Same projection discipline as Capability Graph and Reserve Ledger:
 * the order book is NEVER mutated directly. It is derived from Domain Events.
 * Replaying the same event stream always reconstructs the same order book.
 */

import type { StoredEvent } from '../../events';
import type { LiquidityOffer, OrderBook } from './types';
import { isExpired } from './types';

/** Rebuild the order book from a list of stored events. */
export class OrderBookProjection {
  /** Rebuild all active offers from events. Pure. */
  rebuild(events: StoredEvent[], now: number): OrderBook {
    const offersById = new Map<string, LiquidityOffer>();

    // Apply events in order.
    for (const event of events) {
      if (event.type === 'offer.published') {
        const offer = event.payload as unknown as LiquidityOffer;
        offersById.set(offer.id, { ...offer, active: true });
      } else if (event.type === 'offer.withdrawn' || event.type === 'offer.expired') {
        const payload = event.payload as { offerId: string };
        offersById.delete(payload.offerId);
      }
    }

    // Filter out expired offers.
    const active = [...offersById.values()].filter((o) => !isExpired(o, now));

    return {
      offers: active,
      forRoute(from: string, to: string): LiquidityOffer[] {
        return active.filter((o) => o.from === from && o.to === to);
      },
      forLP(lpId: string): LiquidityOffer[] {
        return active.filter((o) => o.lpId === lpId);
      },
    };
  }
}
