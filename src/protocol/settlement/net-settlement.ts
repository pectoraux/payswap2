/**
 * PaySwap Protocol — Net Settlement (corridor netting).
 *
 * Instead of settling every payment individually, maintain corridor
 * obligations. The solver minimizes gross liquidity movement.
 *
 *   Kenya → Ghana: +1.2M
 *   Ghana → Kenya: -1.15M
 *   → Only 50k needs settlement
 *
 * W3 FIX: The engine now supports event-sourced rehydration. Call
 * `rehydrateFromEvents()` on startup to rebuild the corridor Map from
 * `corridor.obligation.recorded` + `corridor.obligation.settled` events.
 * The `onSettle` callback lets the caller emit a `corridor.obligation.settled`
 * event when `settle()` runs — closing the W2 "records but never nets" gap.
 */
import { uid, round } from '@/kernel/support';

export interface CorridorObligation {
  id: string;
  fromCountry: string;
  toCountry: string;
  currency: string;
  balance: number;  // positive = net owed from→to
  lastSettled: number;
  transactionCount: number;
}

/** Callback fired when a corridor is settled. The caller emits the event. */
export type OnSettleCallback = (result: {
  fromCountry: string;
  toCountry: string;
  currency: string;
  amount: number;
  direction: string;
  settledAt: number;
}) => void;

/** A replayed obligation event (for rehydration). */
export interface ObligationEvent {
  type: 'corridor.obligation.recorded' | 'corridor.obligation.settled';
  fromCountry: string;
  toCountry: string;
  currency: string;
  amount: number; // positive for recorded, the settled net for settled
}

export class NetSettlementEngine {
  private corridors: Map<string, CorridorObligation> = new Map();
  /** Pluggable callback — the caller wires this to emit the event. */
  private onSettle: OnSettleCallback | null = null;

  private key(from: string, to: string, currency: string): string {
    return `${from}:${to}:${currency}`;
  }

  /** Set the onSettle callback (the caller wires this to emit events). */
  setOnSettle(cb: OnSettleCallback): void {
    this.onSettle = cb;
  }

  /** Record a payment obligation on a corridor. */
  record(fromCountry: string, toCountry: string, currency: string, amount: number): CorridorObligation {
    const k = this.key(fromCountry, toCountry, currency);
    let corridor = this.corridors.get(k);
    if (!corridor) {
      corridor = {
        id: uid('corridor'),
        fromCountry,
        toCountry,
        currency,
        balance: 0,
        lastSettled: Date.now(),
        transactionCount: 0,
      };
      this.corridors.set(k, corridor);
    }
    corridor.balance += amount;
    corridor.transactionCount++;
    return corridor;
  }

  /** Compute the net settlement needed for a corridor. */
  netSettlement(fromCountry: string, toCountry: string, currency: string): { amount: number; direction: string } {
    const forward = this.corridors.get(this.key(fromCountry, toCountry, currency));
    const reverse = this.corridors.get(this.key(toCountry, fromCountry, currency));
    const forwardBalance = forward?.balance ?? 0;
    const reverseBalance = reverse?.balance ?? 0;
    const net = forwardBalance - reverseBalance;
    return {
      amount: Math.abs(net),
      direction: net >= 0 ? `${fromCountry}→${toCountry}` : `${toCountry}→${fromCountry}`,
    };
  }

  /** Settle a corridor (reset obligation after settlement). Fires onSettle. */
  settle(fromCountry: string, toCountry: string, currency: string): { settled: number; direction: string } {
    const net = this.netSettlement(fromCountry, toCountry, currency);
    const forward = this.corridors.get(this.key(fromCountry, toCountry, currency));
    const reverse = this.corridors.get(this.key(toCountry, fromCountry, currency));
    if (forward) {
      forward.balance = 0;
      forward.lastSettled = Date.now();
    }
    if (reverse) {
      reverse.balance = 0;
      reverse.lastSettled = Date.now();
    }
    // W2 FIX: fire the callback so the caller can emit corridor.obligation.settled.
    if (this.onSettle && net.amount > 0) {
      this.onSettle({
        fromCountry,
        toCountry,
        currency,
        amount: net.amount,
        direction: net.direction,
        settledAt: Date.now(),
      });
    }
    return { settled: net.amount, direction: net.direction };
  }

  /**
   * W3 FIX: Rehydrate the corridor Map from replayed obligation events.
   * Call this on startup after replaying the event log.
   */
  rehydrateFromEvents(events: ObligationEvent[]): void {
    this.corridors.clear();
    for (const evt of events) {
      if (evt.type === 'corridor.obligation.recorded') {
        this.record(evt.fromCountry, evt.toCountry, evt.currency, evt.amount);
      } else if (evt.type === 'corridor.obligation.settled') {
        // Settled events zero out the corridor balance (both directions).
        const forward = this.corridors.get(this.key(evt.fromCountry, evt.toCountry, evt.currency));
        const reverse = this.corridors.get(this.key(evt.toCountry, evt.fromCountry, evt.currency));
        if (forward) forward.balance = 0;
        if (reverse) reverse.balance = 0;
      }
    }
  }

  /** All corridor obligations. */
  all(): CorridorObligation[] {
    return [...this.corridors.values()];
  }

  /** All corridor pair keys (for the settlement cycle to iterate). */
  corridorPairs(): { fromCountry: string; toCountry: string; currency: string }[] {
    const seen = new Set<string>();
    const out: { fromCountry: string; toCountry: string; currency: string }[] = [];
    for (const c of this.corridors.values()) {
      const pairKey = [c.fromCountry, c.toCountry, c.currency].sort().join(':');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      out.push({ fromCountry: c.fromCountry, toCountry: c.toCountry, currency: c.currency });
    }
    return out;
  }

  /** Total gross volume (sum of all corridor balances). */
  grossVolume(): number {
    return round(this.corridors.values().reduce((s, c) => s + Math.abs(c.balance), 0), 2);
  }

  /** Total net volume (what actually needs to settle). */
  netVolume(): number {
    const pairs = new Set<string>();
    let total = 0;
    for (const c of this.corridors.values()) {
      const pairKey = [c.fromCountry, c.toCountry, c.currency].sort().join(':');
      if (pairs.has(pairKey)) continue;
      pairs.add(pairKey);
      total += this.netSettlement(c.fromCountry, c.toCountry, c.currency).amount;
    }
    return round(total, 2);
  }
}

// Singleton on globalThis to survive Next.js dev-mode module duplication.
declare global {
  // eslint-disable-next-line no-var
  var __PAYSWAP_NET_SETTLEMENT_ENGINE: NetSettlementEngine | undefined;
}

export const netSettlementEngine: NetSettlementEngine =
  globalThis.__PAYSWAP_NET_SETTLEMENT_ENGINE ?? new NetSettlementEngine();

if (!globalThis.__PAYSWAP_NET_SETTLEMENT_ENGINE) {
  globalThis.__PAYSWAP_NET_SETTLEMENT_ENGINE = netSettlementEngine;
}
