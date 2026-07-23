/**
 * Routing Engine — the path-finding core of the kernel.
 *
 * Given a scenario, the Routing Engine computes the optimal settlement path
 * from buyer to merchant, selecting Liquidity Providers according to the
 * merchant's preference (fastest / cheapest / safest). The simulator calls
 * the *exact same* engine production would use — there is no separate
 * "simulation" routing implementation.
 *
 * Routing model
 * -------------
 *  1. The buyer pays in their local currency; this funds the source reserve.
 *  2. The FX Engine quotes the cross-currency bridge (source -> target).
 *  3. Cross-currency payments always draw bridge liquidity from LPs (they are
 *     the inter-currency bridge). Total draw equals the merchant obligation.
 *  4. The destination reserve pays the merchant; the twin token is burned.
 *
 * Preference -> LP selection strategy:
 *   - cheapest : LPs by fee rate ascending (lowest cost)
 *   - fastest  : LPs by capacity descending (fewest hops / fewest LPs)
 *   - safest   : LPs diversified across providers (lowest concentration)
 */
import type {
  SimulationScenario,
  PlanHop,
  LpUsage,
  CurrencyCode,
  WorldState,
} from './types';
import { fxEngine } from './fx';
import { round } from './support';

export interface RoutingResult {
  hops: PlanHop[];
  lpUsage: LpUsage[];
  sourceAmount: number; // buyer debit, in source currency
  sourceCurrency: CurrencyCode;
  fxQuote: ReturnType<FxEngine['quote']>;
  feasible: boolean;
  notes: string[];
}

type FxEngine = typeof fxEngine;

export class RoutingEngine {
  constructor(private world: WorldState) {}

  route(scenario: SimulationScenario): RoutingResult {
    const notes: string[] = [];
    const sourceCurrency = scenario.buyer.currency;
    const targetCurrency = scenario.merchant.currency;

    // 1. FX quote: how much source currency buys `amount` of target currency.
    const fxQuote = fxEngine.quote(scenario.amount, sourceCurrency, targetCurrency);
    // buyer pays source currency so that the kernel receives `amount` target.
    const sourceAmount = round(scenario.amount / fxQuote.effectiveRate, 2);

    // 2. Select & draw LPs (the cross-currency bridge), total = merchant amount.
    const candidateLps = this.world.liquidityProviders.filter(
      (lp) => lp.country === scenario.buyer.country,
    );
    const lpUsage = this.selectLps(candidateLps, scenario.amount, scenario.preference, notes);

    const totalDrawn = lpUsage.reduce((s, u) => s + u.drawn, 0);
    const feasible = totalDrawn + 1e-6 >= scenario.amount;
    if (!feasible) {
      notes.push(
        `Insufficient liquidity: drew ${round(totalDrawn, 2)} of ${scenario.amount} ${targetCurrency}`,
      );
    }

    // 3. Build the visual path.
    const hops: PlanHop[] = [];
    let idx = 0;

    hops.push({
      index: idx++,
      type: 'source',
      label: scenario.buyer.label,
      country: scenario.buyer.country,
      currency: sourceCurrency,
      amount: sourceAmount,
      detail: scenario.buyer.method,
      meta: { role: 'buyer' },
    });

    hops.push({
      index: idx++,
      type: 'payment',
      label: scenario.buyer.method,
      country: scenario.buyer.country,
      currency: sourceCurrency,
      amount: sourceAmount,
      detail: 'Payment channel',
    });

    hops.push({
      index: idx++,
      type: 'reserve',
      label: `PaySwap Reserve`,
      country: scenario.buyer.country,
      currency: sourceCurrency,
      amount: sourceAmount,
      detail: 'Source reserve receives buyer funds',
    });

    if (sourceCurrency !== targetCurrency) {
      hops.push({
        index: idx++,
        type: 'fx',
        label: 'FX Bridge',
        currency: targetCurrency,
        amount: scenario.amount,
        detail: `${sourceCurrency} → ${targetCurrency} @ ${round(fxQuote.effectiveRate, 6)} (${fxQuote.spreadBps} bps)`,
        meta: { midRate: fxQuote.midRate, spreadBps: fxQuote.spreadBps },
      });
    }

    for (const u of lpUsage) {
      hops.push({
        index: idx++,
        type: 'liquidity',
        label: `LP ${u.lpId}`,
        country: scenario.buyer.country,
        currency: targetCurrency,
        amount: u.drawn,
        detail: `${u.rate}% fee${u.exhausted ? ' • exhausted' : ''}`,
        meta: { rate: u.rate, fee: u.fee, remaining: u.remaining },
      });
    }

    hops.push({
      index: idx++,
      type: 'reserve',
      label: `PaySwap Reserve`,
      country: scenario.merchant.country,
      currency: targetCurrency,
      amount: scenario.amount,
      detail: 'Destination reserve pays merchant',
    });

    hops.push({
      index: idx++,
      type: 'destination',
      label: scenario.merchant.label,
      country: scenario.merchant.country,
      currency: targetCurrency,
      amount: scenario.amount,
      detail: 'Settled to merchant',
      meta: { role: 'merchant' },
    });

    return {
      hops,
      lpUsage,
      sourceAmount,
      sourceCurrency,
      fxQuote,
      feasible,
      notes,
    };
  }

  /** Select LPs and compute per-LP draw according to preference. */
  private selectLps(
    lps: { id: string; capacity: number; rate: number; speedMs: number }[],
    amount: number,
    preference: SimulationScenario['preference'],
    notes: string[],
  ): LpUsage[] {
    if (lps.length === 0) {
      notes.push('No LPs registered for the buyer corridor');
      return [];
    }

    let ordered: typeof lps;
    if (preference === 'cheapest') {
      ordered = [...lps].sort((a, b) => a.rate - b.rate);
      notes.push('Strategy: minimize cost — LPs ordered by fee rate ascending');
    } else if (preference === 'fastest') {
      // Fewest LPs = fewest hops. Rank by capacity descending so a single
      // large LP can cover the whole draw when available.
      ordered = [...lps].sort((a, b) => b.capacity - a.capacity);
      notes.push('Strategy: minimize hops — LPs ordered by capacity descending');
    } else {
      // Safest: diversify. Draw proportionally to capacity, capped per LP so
      // no single provider dominates the bridge.
      return this.diversify(lps, amount, notes);
    }

    // Greedy fill for cheapest / fastest.
    const usage: LpUsage[] = [];
    let remaining = amount;
    for (const lp of ordered) {
      if (remaining <= 1e-6) break;
      const drawn = Math.min(remaining, lp.capacity);
      if (drawn <= 0) continue;
      const fee = round((drawn * lp.rate) / 100, 6);
      const left = round(lp.capacity - drawn, 6);
      usage.push({
        lpId: lp.id,
        drawn: round(drawn, 6),
        rate: lp.rate,
        fee,
        exhausted: left <= 1e-6,
        remaining: left,
      });
      remaining -= drawn;
    }
    return usage;
  }

  /** Diversified draw: spread across all LPs by capacity share, capped at 60%. */
  private diversify(
    lps: { id: string; capacity: number; rate: number; speedMs: number }[],
    amount: number,
    notes: string[],
  ): LpUsage[] {
    notes.push('Strategy: minimize concentration — liquidity diversified across LPs');
    const totalCapacity = lps.reduce((s, lp) => s + lp.capacity, 0) || 1;
    const cap = amount * 0.6; // no single LP carries more than 60%
    const usage: LpUsage[] = [];
    let remaining = amount;

    // First pass: proportional allocation capped at `cap`.
    for (const lp of lps) {
      if (remaining <= 1e-6) break;
      const share = (lp.capacity / totalCapacity) * amount;
      const drawn = Math.min(remaining, share, cap, lp.capacity);
      if (drawn <= 0) continue;
      const fee = round((drawn * lp.rate) / 100, 6);
      const left = round(lp.capacity - drawn, 6);
      usage.push({
        lpId: lp.id,
        drawn: round(drawn, 6),
        rate: lp.rate,
        fee,
        exhausted: left <= 1e-6,
        remaining: left,
      });
      remaining -= drawn;
    }

    // Second pass: mop up any remainder greedily by cheapest rate.
    if (remaining > 1e-6) {
      const byRate = [...lps].sort((a, b) => a.rate - b.rate);
      for (const lp of byRate) {
        if (remaining <= 1e-6) break;
        const existing = usage.find((u) => u.lpId === lp.id);
        const already = existing?.drawn ?? 0;
        const avail = lp.capacity - already;
        if (avail <= 0) continue;
        const drawn = Math.min(remaining, avail);
        const fee = round(((already + drawn) * lp.rate) / 100, 6);
        const left = round(lp.capacity - already - drawn, 6);
        if (existing) {
          existing.drawn = round(already + drawn, 6);
          existing.fee = fee;
          existing.exhausted = left <= 1e-6;
          existing.remaining = left;
        } else {
          usage.push({
            lpId: lp.id,
            drawn: round(drawn, 6),
            rate: lp.rate,
            fee,
            exhausted: left <= 1e-6,
            remaining: left,
          });
        }
        remaining -= drawn;
      }
    }
    return usage;
  }
}
