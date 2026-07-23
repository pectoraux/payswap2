/**
 * PaySwap Kernel — Developer API.
 *
 * Exposes financial primitives the way AWS exposes infrastructure primitives
 * and Stripe exposes developer APIs. Every operation is composable, typed and
 * deterministic. Extensions, services and products call these — they never
 * touch engines directly.
 *
 *   kernel.plan(intent)      → LiquidityExecutionPlan
 *   kernel.simulate(scenario) → SimulationResult
 *   kernel.execute(plan)      → ExecutionOutput
 *   kernel.replay(result)     → ReplayFrame[]
 *   kernel.validate(plan)     → ConstitutionVerdict
 *   kernel.world()            → WorldState
 *   kernel.treasury()         → Treasury
 *   kernel.insurance()        → InsuranceEngine
 *   kernel.graph(scenario)    → FinancialGraph
 *
 * Extensions request a "Liquidity Intent" and receive a plan. They never
 * execute liquidity movements themselves — the kernel does.
 */
import type {
  SimulationScenario,
  SimulationResult,
  LiquidityExecutionPlan,
  WorldState,
  Treasury,
  ReplayFrame,
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

/** A Liquidity Intent — what extensions submit to request liquidity movement. */
export interface LiquidityIntent {
  amount: number;
  currency: import('./types').CurrencyCode;
  origin: { country: string; currency: import('./types').CurrencyCode; method: string };
  destination: { country: string; currency: import('./types').CurrencyCode; method: string };
  objective: import('./types').RoutingPriority;
  policy?: Partial<import('./types').SimulationScenario['policies']>;
  aiWeights?: Partial<import('./types').OptimizationWeights>;
  failures?: import('./types').FailureInjection[];
}

/** Convert a Liquidity Intent into a full SimulationScenario (the kernel's input). */
export function intentToScenario(intent: LiquidityIntent, world: { reserves: import('./types').SimulationScenario['treasury']; liquidityProviders: import('./types').LiquidityProvider[]; financialOperators: import('./types').FinancialOperator[] }): SimulationScenario {
  return {
    name: `${intent.origin.country} → ${intent.destination.country} (${intent.objective})`,
    description: 'Generated from Liquidity Intent',
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
    } as import('./types').OptimizationWeights,
  };
}

class KernelAPI {
  private optimizer = new OptimizationEngine();
  private sim = new SimulationEngine();

  /** Plan a liquidity movement from a Liquidity Intent. */
  plan(scenario: SimulationScenario, world: { reserves: import('./types').Reserve[]; liquidityProviders: import('./types').LiquidityProvider[]; financialOperators: import('./types').FinancialOperator[] }): LiquidityExecutionPlan {
    const canonicalWorld = buildWorldFromScenario(scenario);
    return this.optimizer.optimize({ scenario, world: canonicalWorld, objectives: scenario.aiWeights }).plan;
  }

  /** Run a full Digital Twin simulation. */
  simulate(scenario: SimulationScenario): SimulationResult {
    return this.sim.run(scenario);
  }

  /** Execute a plan against a world state (production + sim same code). */
  execute(plan: LiquidityExecutionPlan, world: WorldState, scenario: SimulationScenario): import('./types').SimulationResult {
    return this.sim.run(scenario);
  }

  /** Replay a simulation result frame by frame. */
  replay(result: SimulationResult): ReplayFrame[] {
    return result.replay;
  }

  /** Validate a plan against the Kernel Constitution (non-overridable invariants). */
  validate(plan: LiquidityExecutionPlan, ctx: Partial<InvariantContext>): ConstitutionVerdict {
    return evaluateConstitution({
      plan,
      ledger: ctx.ledger ?? [],
      twinTokens: ctx.twinTokens ?? [],
      reserves: ctx.reserves ?? [],
      world: ctx.world ?? { accounts: new Map(), reserves: [], liquidityProviders: [], financialOperators: [], treasury: { positions: [] }, twinTokens: [], wallets: [] },
    });
  }

  /** Get the current world state. */
  world(): WorldState {
    return { accounts: new Map(), reserves: [], liquidityProviders: [], financialOperators: [], treasury: { positions: [] }, twinTokens: [], wallets: [] };
  }

  /** Get the treasury state. */
  treasury(): Treasury {
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
