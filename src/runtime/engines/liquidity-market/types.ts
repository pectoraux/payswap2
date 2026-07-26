/**
 * Liquidity Strategy Marketplace. (Amendment 1 §7D.)
 *
 * LPs publish programmable strategies evaluated during market clearing. An
 * LP with "only > $1000" is excluded from a $500 clear; an LP with "avoid
 * payroll days" is excluded on the 25th. The Decision explains why.
 *
 * This is the differentiator that makes LPs programmable participants — a
 * capability Stripe/Paystack/Flutterwave/DEXs do not expose.
 *
 * M-RT-1 ships types + a registry. M-RT-5 wires clearing-time evaluation.
 */

/** A utilization-tiered fee tier. */
export interface PricingTier {
  /** [low, high] utilization bounds, e.g. [0.4, 0.6]. */
  utilizationRange: [number, number];
  /** Fee in basis points for this tier. */
  feeBps: number;
}

export type RiskAppetite = 'low' | 'medium' | 'high';

export interface CorridorPreference {
  corridor: string;
  capacity: number;
}

export type Rail = 'mobile_money' | 'bank' | 'card' | 'stablecoin' | 'blockchain';

/** The context a strategy's eligibility predicate is evaluated against. */
export interface ClearingContext {
  amount: number;
  currency: string;
  corridor: string;
  /** reserveId → utilization, for "only when reserve util < X" strategies. */
  reserveUtilization: Record<string, number>;
  isPayrollDay: boolean;
  ts: number;
}

/**
 * A programmable Liquidity Strategy an LP publishes alongside liquidity.
 * The `eligible` predicate gates participation; the pricing curve prices it.
 */
export interface LiquidityStrategy {
  id: string;
  lpId: string;
  name: string;
  /** If false, the LP is excluded from this clear (Decision explains why). */
  eligible: (ctx: ClearingContext) => boolean;
  /** Human-readable eligibility rule (for the Inspector). */
  eligibilityRule: string;
  /** How this LP prefers to be scored (weighting hint, not a guarantee). */
  preference?: { dimension: string; weight: number }[];
  /** Dynamic pricing curve (utilization-tiered fee). */
  pricingCurve: PricingTier[];
  riskAppetite: RiskAppetite;
  corridorPreferences: CorridorPreference[];
  supportedRails: Rail[];
  reserveRequirements: Record<string, number>;
  latencyTarget: number;
  utilizationTarget: number;
  yieldTarget: number;
}

/** The result of evaluating a strategy against a clearing context. */
export interface StrategyEvaluation {
  strategyId: string;
  lpId: string;
  eligible: boolean;
  reason: string;
  quotedFeeBps?: number;
}

/** The marketplace — registers strategies and evaluates them at clearing. */
export interface LiquidityStrategyMarketplace {
  /** An LP publishes (or replaces) their strategy. */
  publish(strategy: LiquidityStrategy): void;
  /** Remove an LP's strategy. */
  withdraw(strategyId: string): void;
  /** All published strategies. */
  strategies(): readonly LiquidityStrategy[];
  /** Evaluate all strategies against a clearing context. */
  evaluate(ctx: ClearingContext): StrategyEvaluation[];
}

/**
 * InMemoryLiquidityStrategyMarketplace — the M-RT-1 implementation.
 */
export class InMemoryLiquidityStrategyMarketplace implements LiquidityStrategyMarketplace {
  private byId: Map<string, LiquidityStrategy> = new Map();

  publish(strategy: LiquidityStrategy): void {
    this.byId.set(strategy.id, strategy);
  }

  withdraw(strategyId: string): void {
    this.byId.delete(strategyId);
  }

  strategies(): readonly LiquidityStrategy[] {
    return [...this.byId.values()];
  }

  evaluate(ctx: ClearingContext): StrategyEvaluation[] {
    return [...this.byId.values()].map((s) => {
      let eligible = false;
      let reason = '';
      try {
        eligible = s.eligible(ctx);
        reason = eligible
          ? `Strategy "${s.name}" satisfied.`
          : `Strategy "${s.name}" not satisfied (${s.eligibilityRule}).`;
      } catch (err) {
        eligible = false;
        reason = `Strategy "${s.name}" threw: ${err instanceof Error ? err.message : String(err)}`;
      }
      const quotedFeeBps = eligible ? quoteFee(s, ctx) : undefined;
      return { strategyId: s.id, lpId: s.lpId, eligible, reason, quotedFeeBps };
    });
  }
}

/** Pick the fee tier matching the LP's current utilization for this corridor. */
function quoteFee(strategy: LiquidityStrategy, ctx: ClearingContext): number {
  const util = ctx.reserveUtilization[strategy.lpId] ?? 0;
  const tier = strategy.pricingCurve.find(
    (t) => util >= t.utilizationRange[0] && util < t.utilizationRange[1],
  );
  return tier?.feeBps ?? strategy.pricingCurve[0]?.feeBps ?? 0;
}
