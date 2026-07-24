/**
 * PaySwap Financial Kernel — Developer API.
 *
 * Developers think in terms of INTENTS, not engines. Every financial operation
 * — payment, loan, treasury rebalance, LP withdrawal, insurance payout,
 * stablecoin conversion, reserve replenishment — is an Intent that converges
 * the world toward a target state.
 *
 *   await kernel.intent.payment({ ... })
 *   await kernel.intent.loan({ ... })
 *   await kernel.intent.rebalance({ ... })
 *   await kernel.intent.withdrawLP({ ... })
 *   await kernel.intent.insurancePayout({ ... })
 *   await kernel.intent.convertStablecoin({ ... })
 *
 * Internally they all call: Optimization Engine → Execution Graph → Executor.
 * Developers never touch routing logic. Exactly like Stripe.
 */
import type {
  SimulationScenario,
  SimulationResult,
  LiquidityExecutionPlan,
  WorldState,
  CurrencyCode,
  RoutingPriority,
  FailureInjection,
  OptimizationWeights,
  LiquidityProvider,
  FinancialOperator,
} from './types';
import { OptimizationEngine } from './optimization-engine';
import { PlanExecutor } from './plan-executor';
import { SimulationEngine } from './simulation';
import { WorldStore, buildWorldFromScenario, type WorldState as CanonicalWorldState } from './world-store';
import { treasuryEngine } from './treasury';
import { insuranceEngine } from './insurance';
import { buildGraph, FinancialGraph } from './financial-graph';
import { evaluateConstitution, type ConstitutionVerdict, type InvariantContext } from './constitution';
import { eventEngine } from './event';
import { auditEngine } from './audit';

/** A Liquidity Intent — the universal input for world-state convergence. */
export interface LiquidityIntent {
  type: IntentType;
  amount: number;
  currency: CurrencyCode;
  origin: { country: string; currency: CurrencyCode; method: string };
  destination: { country: string; currency: CurrencyCode; method: string };
  objective: RoutingPriority;
  policy?: Partial<SimulationScenario['policies']>;
  aiWeights?: Partial<OptimizationWeights>;
  failures?: FailureInjection[];
  metadata?: Record<string, unknown>;
}

export type IntentType =
  | 'payment'
  | 'loan'
  | 'rebalance'
  | 'withdrawLP'
  | 'insurancePayout'
  | 'convertStablecoin'
  | 'reserveReplenish'
  | 'lpStake';

/** Convert a Liquidity Intent into a full SimulationScenario. */
export function intentToScenario(
  intent: LiquidityIntent,
  world: { reserves: SimulationScenario['treasury']; liquidityProviders: LiquidityProvider[]; financialOperators: FinancialOperator[] },
): SimulationScenario {
  return {
    name: `${intent.type}: ${intent.origin.country} → ${intent.destination.country} (${intent.objective})`,
    description: `Generated from ${intent.type} intent`,
    transaction: {
      type: intent.origin.country === intent.destination.country ? 'domestic' : 'cross_border',
      buyer: { country: intent.origin.country, currency: intent.origin.currency, method: intent.origin.method },
      merchant: { country: intent.destination.country, currency: intent.destination.currency, method: intent.destination.method },
      amount: intent.amount,
      currency: intent.currency,
      merchantType: 'merchant',
      customerType: 'customer',
      priority: intent.objective,
    },
    treasury: world.reserves,
    liquidityProviders: world.liquidityProviders,
    financialOperators: world.financialOperators,
    policies: {
      reservePolicy: intent.policy?.reservePolicy ?? 'hybrid',
      maxLpShare: intent.policy?.maxLpShare ?? 0.7,
      maxCostPercent: intent.policy?.maxCostPercent ?? 5,
      maxRiskScore: intent.policy?.maxRiskScore ?? 0.6,
      requireInsurance: intent.policy?.requireInsurance ?? false,
    },
    failures: intent.failures ?? [],
    aiWeights: {
      cost: 0.25, speed: 0.25, safety: 0.25, liquidityPreservation: 0.25,
      merchantSatisfaction: 0.25, communityImpact: 0.15, carbonImpact: 0.15, treasuryHealth: 0.25,
      ...intent.aiWeights,
    } as OptimizationWeights,
  };
}

/** Intent builders — the developer-facing API. */
export class IntentBuilder {
  constructor(private world: { reserves: SimulationScenario['treasury']; liquidityProviders: LiquidityProvider[]; financialOperators: FinancialOperator[] }) {}

  /** Move value from buyer to merchant. */
  payment(params: {
    amount: number; currency: CurrencyCode;
    origin: { country: string; currency: CurrencyCode; method: string };
    destination: { country: string; currency: CurrencyCode; method: string };
    objective?: RoutingPriority;
    failures?: FailureInjection[];
    aiWeights?: Partial<OptimizationWeights>;
  }): LiquidityIntent {
    return { type: 'payment', ...params, objective: params.objective ?? 'cheapest' };
  }

  /** Issue a loan backed by liquidity. */
  loan(params: {
    amount: number; currency: CurrencyCode;
    origin: { country: string; currency: CurrencyCode; method: string };
    destination: { country: string; currency: CurrencyCode; method: string };
    objective?: RoutingPriority;
  }): LiquidityIntent {
    return { type: 'loan', ...params, objective: params.objective ?? 'safest' };
  }

  /** Rebalance reserves across countries. */
  rebalance(params: {
    amount: number; currency: CurrencyCode;
    origin: { country: string; currency: CurrencyCode; method: string };
    destination: { country: string; currency: CurrencyCode; method: string };
    objective?: RoutingPriority;
  }): LiquidityIntent {
    return { type: 'rebalance', ...params, objective: params.objective ?? 'balanced' };
  }

  /** LP withdraws its stake. */
  withdrawLP(params: {
    amount: number; currency: CurrencyCode;
    origin: { country: string; currency: CurrencyCode; method: string };
    destination: { country: string; currency: CurrencyCode; method: string };
  }): LiquidityIntent {
    return { type: 'withdrawLP', ...params, objective: 'safest' };
  }

  /** Pay out an insurance claim. */
  insurancePayout(params: {
    amount: number; currency: CurrencyCode;
    origin: { country: string; currency: CurrencyCode; method: string };
    destination: { country: string; currency: CurrencyCode; method: string };
  }): LiquidityIntent {
    return { type: 'insurancePayout', ...params, objective: 'safest' };
  }

  /** Convert stablecoin to fiat. */
  convertStablecoin(params: {
    amount: number; currency: CurrencyCode;
    origin: { country: string; currency: CurrencyCode; method: string };
    destination: { country: string; currency: CurrencyCode; method: string };
  }): LiquidityIntent {
    return { type: 'convertStablecoin', ...params, objective: 'cheapest' };
  }

  /** Replenish a reserve. */
  reserveReplenish(params: {
    amount: number; currency: CurrencyCode;
    origin: { country: string; currency: CurrencyCode; method: string };
    destination: { country: string; currency: CurrencyCode; method: string };
  }): LiquidityIntent {
    return { type: 'reserveReplenish', ...params, objective: 'balanced' };
  }

  /** LP stakes twin tokens. */
  lpStake(params: {
    amount: number; currency: CurrencyCode;
    origin: { country: string; currency: CurrencyCode; method: string };
    destination: { country: string; currency: CurrencyCode; method: string };
  }): LiquidityIntent {
    return { type: 'lpStake', ...params, objective: 'safest' };
  }
}

class KernelAPI {
  private optimizer = new OptimizationEngine();
  private sim = new SimulationEngine();

  /** The intent builder — developers use this. */
  intent(world: { reserves: SimulationScenario['treasury']; liquidityProviders: LiquidityProvider[]; financialOperators: FinancialOperator[] }): IntentBuilder {
    return new IntentBuilder(world);
  }

  /** Execute an intent — converges the world toward the target state. */
  async execute(intent: LiquidityIntent, world: { reserves: SimulationScenario['treasury']; liquidityProviders: LiquidityProvider[]; financialOperators: FinancialOperator[] }): Promise<SimulationResult> {
    const scenario = intentToScenario(intent, world);
    return this.sim.run(scenario);
  }

  /** Plan a liquidity movement from a scenario (low-level). */
  plan(scenario: SimulationScenario): LiquidityExecutionPlan {
    const canonicalWorld = buildWorldFromScenario(scenario);
    return this.optimizer.optimize({ scenario, world: canonicalWorld, objectives: scenario.aiWeights }).plan;
  }

  /** Run a full Digital Twin simulation. */
  simulate(scenario: SimulationScenario): SimulationResult {
    return this.sim.run(scenario);
  }

  /** Execute a plan against a world state. */
  execute_plan(plan: LiquidityExecutionPlan, world: WorldState, scenario: SimulationScenario): SimulationResult {
    return this.sim.run(scenario);
  }

  /** Replay a simulation result frame by frame. */
  replay(result: SimulationResult) {
    return result.replay;
  }

  /** Validate a plan against the Constitution. */
  validate(plan: LiquidityExecutionPlan, ctx: Partial<InvariantContext>): ConstitutionVerdict {
    return evaluateConstitution({
      plan,
      ledger: ctx.ledger ?? [],
      twinTokens: ctx.twinTokens ?? [],
      reserves: ctx.reserves ?? [],
      world: ctx.world ?? { accounts: new Map(), reserves: [], liquidityProviders: [], financialOperators: [], treasury: { positions: [] }, twinTokens: [], wallets: [] },
    });
  }

  /** Get the treasury state. */
  treasury() {
    return { positions: treasuryEngine.all() };
  }

  /** Get the insurance engine. */
  insurance() {
    return insuranceEngine;
  }

  /** Build and return the Financial Graph for a scenario. */
  graph(scenario: SimulationScenario): FinancialGraph {
    return buildGraph({
      reserves: [
        { id: `reserve:${scenario.treasury.originReserve.country}`, country: scenario.treasury.originReserve.country, currency: scenario.treasury.originReserve.currency, available: scenario.treasury.originReserve.available, minThreshold: scenario.treasury.originReserve.minThreshold },
        { id: `reserve:${scenario.treasury.destinationReserve.country}`, country: scenario.treasury.destinationReserve.country, currency: scenario.treasury.destinationReserve.currency, available: scenario.treasury.destinationReserve.available, minThreshold: scenario.treasury.destinationReserve.minThreshold },
      ],
      liquidityProviders: scenario.liquidityProviders,
      treasury: { stablecoinBalance: scenario.treasury.stablecoinBalance, emergencyBalance: scenario.treasury.emergencyTreasury },
      financialOperators: scenario.financialOperators,
      scenario,
    });
  }

  /** Get the event stream. */
  events() {
    return eventEngine.read();
  }

  /** Get the audit log. */
  audit() {
    return auditEngine.all();
  }
}

/** The singleton kernel API — the developer entry point. */
export const kernel = new KernelAPI();
