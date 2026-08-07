/**
 * Treasury v2 — Automatic corridor balancing.
 *
 * The CorridorBalancer monitors reserve envelopes for each configured corridor
 * and pulls liquidity from over-reserved corridors to under-reserved ones via
 * the liquidity network when a corridor falls below its `minReserve`.
 *
 * Algorithm:
 *   1. For each corridor target, the treasury's reserve on the `from` side is
 *      checked against `minReserve`. If `available(from) < minReserve`, the
 *      corridor is "under-reserved" and a rebalance is needed.
 *   2. The balancer scans all OTHER configured corridors for a "donor" — a
 *      corridor whose `from` reserve exceeds `maxReserve` (over-reserved).
 *   3. The amount to move = `min(targetReserve − available(under),
 *      available(donor) − targetReserve(donor))`.
 *   4. The balancer asks the liquidity network for a quote to route a swap
 *      from the donor's `from` currency to the under-reserved corridor's `from`
 *      currency. If a route is found, it executes + settles the route
 *      (synthetic success), updates the reserves via the reserve monitor, and
 *      emits `treasury.corridor_rebalanced`.
 *   5. If no donor is available, or no route can be found, the rebalance is
 *      skipped (returns `{ rebalanced: false, reason }`).
 *
 * Invariants:
 *  - The balancer never puts a corridor's reserve below its `minReserve` (the
 *    amount moved is capped at `available(donor) − targetReserve(donor)`, and
 *    we never pull from a donor that's not over-reserved).
 *  - The balancer never moves more than `targetReserve − available(under)` —
 *    the under-reserved corridor is topped up to its target, no more.
 *  - Every successful rebalance emits `treasury.corridor_rebalanced` with the
 *    donor, recipient, amount and route id.
 */
import { round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type {
  CorridorTarget,
  CorridorTargetConfig,
  RebalanceResult,
  TreasuryCorridor,
} from './types';
import type { ReserveMonitor } from './reserve';
import type { LiquidityNetwork } from '@/protocol/liquidity-network';
import { corridorKey as liquidityCorridorKey, type Corridor as LiquidityCorridor } from '@/protocol/liquidity-network';

/** Stable string key for a treasury corridor. */
export function treasuryCorridorKey(c: TreasuryCorridor): string {
  return `${c.from}→${c.to}`;
}

/** Parse a treasury corridor key back into a corridor. */
export function parseTreasuryCorridorKey(key: string): TreasuryCorridor {
  const [from, to] = key.split('→');
  return { from, to };
}

/** Convert a treasury corridor to a liquidity-network corridor. */
function toLiquidityCorridor(c: TreasuryCorridor): LiquidityCorridor {
  return { fromCurrency: c.from, toCurrency: c.to };
}

/**
 * CorridorBalancer — singleton-style class.
 */
export class CorridorBalancer {
  private targets: Map<string, CorridorTarget> = new Map();

  /** Configure a corridor target envelope. */
  configure(config: CorridorTargetConfig): CorridorTarget {
    const key = treasuryCorridorKey(config.corridor);
    const target: CorridorTarget = {
      corridor: config.corridor,
      targetReserve: config.targetReserve,
      minReserve: config.minReserve,
      maxReserve: config.maxReserve,
      rebalanceThreshold: config.rebalanceThreshold,
      lastBalancedTs: null,
    };
    this.targets.set(key, target);
    return target;
  }

  /** Get a corridor's target envelope. */
  get(corridor: TreasuryCorridor): CorridorTarget | undefined {
    return this.targets.get(treasuryCorridorKey(corridor));
  }

  /** All configured corridor targets. */
  all(): CorridorTarget[] {
    return [...this.targets.values()];
  }

  /**
   * Check whether a corridor's reserve is below `minReserve` and, if so,
   * attempt a rebalance via the liquidity network. Returns a `RebalanceResult`.
   *
   *   - If the corridor isn't configured: `{ rebalanced: false, reason: 'not_configured' }`.
   *   - If the corridor's `from` reserve is at or above `minReserve`: `{ rebalanced: false, reason: 'not_needed' }`.
   *   - If no donor corridor is over-reserved: `{ rebalanced: false, reason: 'no_donor' }`.
   *   - If the liquidity network can't route a swap: `{ rebalanced: false, reason: 'no_route' }`.
   *   - On success: `{ rebalanced: true, from: donorKey, to: underKey, amount, route: planId }`.
   */
  checkAndRebalance(
    corridor: TreasuryCorridor,
    liquidityNetwork: LiquidityNetwork,
    reserveMonitor: ReserveMonitor,
  ): RebalanceResult {
    const key = treasuryCorridorKey(corridor);
    const target = this.targets.get(key);
    if (!target) return { rebalanced: false, reason: 'not_configured' };

    const available = reserveMonitor.available(corridor.from);
    const needed = round(target.targetReserve - available, 6);
    if (needed <= 0) return { rebalanced: false, reason: 'not_needed' };

    // Find a donor: any other configured corridor whose `from` reserve is
    // above its `maxReserve` AND has at least `needed` excess above its own
    // target.
    let donor: { target: CorridorTarget; excess: number } | null = null;
    for (const t of this.targets.values()) {
      if (treasuryCorridorKey(t.corridor) === key) continue;
      if (t.corridor.from !== corridor.from) {
        // Different currency — the donor's `from` side is a different
        // currency than the under-reserved corridor's `from` side, so a
        // swap is needed. We still consider it as a donor (the liquidity
        // network handles the FX).
      }
      const donorAvailable = reserveMonitor.available(t.corridor.from);
      const donorExcess = round(donorAvailable - t.targetReserve, 6);
      if (donorAvailable > t.maxReserve && donorExcess > 0) {
        // Prefer the donor with the most excess (largest surplus).
        if (!donor || donorExcess > donor.excess) {
          donor = { target: t, excess: donorExcess };
        }
      }
    }
    if (!donor) return { rebalanced: false, reason: 'no_donor' };

    const amount = round(Math.min(needed, donor.excess), 6);
    if (amount <= 0) return { rebalanced: false, reason: 'zero_amount' };

    // Route a swap from donor.from → under.from via the liquidity network.
    const swapCorridor: LiquidityCorridor = {
      fromCurrency: donor.target.corridor.from,
      toCurrency: corridor.from,
    };
    const plan = liquidityNetwork.getQuote(swapCorridor, amount);
    if (!plan) {
      eventEngine.emit('treasury.corridor_rebalance_failed', {
        corridor,
        reason: 'no_route',
        amount,
        donor: donor.target.corridor,
      }, 0);
      return { rebalanced: false, reason: 'no_route' };
    }

    // Execute + settle the route (synthetic success — treasury rebalances
    // are treated as successful settlements for LP scoring purposes; in
    // production, the actual outcome would be observed asynchronously).
    const exec = liquidityNetwork.executeRoute(plan);
    if (!exec.success) {
      eventEngine.emit('treasury.corridor_rebalance_failed', {
        corridor,
        reason: 'execution_failed',
        amount,
        donor: donor.target.corridor,
        failedLegs: exec.failed,
      }, 0);
      return { rebalanced: false, reason: 'execution_failed' };
    }

    liquidityNetwork.settleRoute(
      plan,
      plan.id,
      plan.route.map((leg) => ({
        lpId: leg.lpId,
        success: true,
        settlementMs: 3000,
        amount: leg.amount,
      })),
    );

    // Update reserves: subtract from donor's `from` side, add to under's
    // `from` side.
    const donorReserve = reserveMonitor.getReserve(donor.target.corridor.from);
    if (donorReserve) {
      reserveMonitor.setReserve(
        donor.target.corridor.from,
        round(donorReserve.balance - amount, 6),
        donorReserve.reserved,
      );
    }
    const underReserve = reserveMonitor.getReserve(corridor.from);
    if (underReserve) {
      reserveMonitor.setReserve(
        corridor.from,
        round(underReserve.balance + amount, 6),
        underReserve.reserved,
      );
    } else {
      // No existing reserve account for the under-reserved currency —
      // create one with the rebalanced amount.
      reserveMonitor.setReserve(corridor.from, amount, 0);
    }

    // Mark lastBalancedTs on the under-reserved corridor.
    target.lastBalancedTs = Date.now();
    this.targets.set(key, target);

    eventEngine.emit('treasury.corridor_rebalanced', {
      corridor,
      donor: donor.target.corridor,
      amount,
      route: plan.id,
      newAvailable: reserveMonitor.available(corridor.from),
    }, 0);

    return {
      rebalanced: true,
      from: treasuryCorridorKey(donor.target.corridor),
      to: key,
      amount,
      route: plan.id,
    };
  }

  /**
   * Check and rebalance all configured corridors. Returns one
   * `RebalanceResult` per corridor (in iteration order).
   */
  rebalanceAll(
    liquidityNetwork: LiquidityNetwork,
    reserveMonitor: ReserveMonitor,
  ): RebalanceResult[] {
    const results: RebalanceResult[] = [];
    for (const target of this.targets.values()) {
      // Iterate over a snapshot — `checkAndRebalance` may mutate the target
      // (lastBalancedTs) but won't add/remove targets.
      const r = this.checkAndRebalance(target.corridor, liquidityNetwork, reserveMonitor);
      results.push({ ...r, from: r.from, to: r.to });
    }
    return results;
  }

  /**
   * Identify corridors that are below their `minReserve` (regardless of
   * whether a rebalance was possible). Used by the alert engine to raise
   * `rebalance_needed` alerts.
   */
  underReserved(reserveMonitor: ReserveMonitor): { corridor: TreasuryCorridor; available: number; minReserve: number }[] {
    const out: { corridor: TreasuryCorridor; available: number; minReserve: number }[] = [];
    for (const target of this.targets.values()) {
      const available = reserveMonitor.available(target.corridor.from);
      if (available < target.minReserve) {
        out.push({ corridor: target.corridor, available, minReserve: target.minReserve });
      }
    }
    return out;
  }

  /** Reset all state (test helper). */
  reset(): void {
    this.targets.clear();
  }
}

/** Singleton corridor balancer (on globalThis for Next.js dev-mode safety). */
declare global {
  // eslint-disable-next-line no-var
  var __PAYSWAP_CORRIDOR_BALANCER: CorridorBalancer | undefined;
}

export const corridorBalancer: CorridorBalancer =
  globalThis.__PAYSWAP_CORRIDOR_BALANCER ?? new CorridorBalancer();

if (!globalThis.__PAYSWAP_CORRIDOR_BALANCER) {
  globalThis.__PAYSWAP_CORRIDOR_BALANCER = corridorBalancer;
}

/** Re-export the liquidity-network corridor key helper for convenience. */
export { liquidityCorridorKey };
