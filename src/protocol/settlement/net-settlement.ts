/**
 * PaySwap Protocol — Net Settlement (corridor netting).
 *
 * Instead of settling every payment individually, maintain corridor
 * obligations. The solver minimizes gross liquidity movement.
 *
 *   Kenya → Ghana: +1.2M
 *   Ghana → Kenya: -1.15M
 *   → Only 50k needs settlement
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

export class NetSettlementEngine {
  private corridors: Map<string, CorridorObligation> = new Map();

  private key(from: string, to: string, currency: string): string {
    return `${from}:${to}:${currency}`;
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

  /** Settle a corridor (reset obligation after settlement). */
  settle(fromCountry: string, toCountry: string, currency: string): { settled: number } {
    const net = this.netSettlement(fromCountry, toCountry, currency);
    const forward = this.corridors.get(this.key(fromCountry, toCountry, currency));
    const reverse = this.corridors.get(this.key(toCountry, fromCountry, currency));
    if (forward) forward.balance = 0;
    if (reverse) reverse.balance = 0;
    return { settled: net.amount };
  }

  /** All corridor obligations. */
  all(): CorridorObligation[] {
    return [...this.corridors.values()];
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

export const netSettlementEngine = new NetSettlementEngine();
