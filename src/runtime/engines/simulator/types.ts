/**
 * Simulator Integration — sim = prod. (M-RT-13.)
 *
 * THE KEY INVARIANT: production and simulation invoke the SAME runtime.
 * The only differences are:
 *   - the execution context (production vs simulation)
 *   - side-effect adapters (real vs simulated)
 *   - clock/environment configuration
 *
 * Everything else — compiler passes, execution pipeline stages, routing,
 * reserve allocation, and trace structure — is IDENTICAL.
 *
 * The most valuable validation artifact is a TRACE EQUIVALENCE CHECK:
 *   Compiler Passes     ✓ identical order
 *   Execution Stages    ✓ identical order
 *   ExecutionPlan       ✓ structurally equivalent
 *   Events              ✓ same semantic sequence
 *   Differences         • settlement adapter, external network calls, timestamps
 *
 * If that invariant holds, the Digital Twin executes the SAME operating system
 * under a different environment rather than maintaining a separate simulation
 * engine. This minimizes long-term drift between simulation and production.
 */

import type { ExecutionPlan } from '../../compiler/types';
import type { TypedIntent } from '../../intent/types';
import type { RealCompilerContext } from '../../compiler/real-compiler';
import type { RouteScoringEngine } from '../routing/engine';
import type { RouteCompiler } from '../routing/compiler';
import type { CapabilityGraph } from '../../graphs/capability/types';
import type { ReserveLedgerService } from '../reserve-ledger/service';
import type { ReserveMarketEngine } from '../reserve-market-v2/engine';
import type { LiquidityMarketplaceService } from '../liquidity-marketplace/service';
import type { ExecutionPipeline } from '../execution-pipeline/pipeline';
import type { RuntimeClock } from '../../clock';
import type { Environment } from '../../types';

// ─── Runtime Context (isolates execution mode) ──────────────────────────────

/** Execution mode — production or simulation. */
export type ExecutionMode = 'production' | 'simulation';

/** Side-effect policy — what the pipeline is allowed to do. */
export type SideEffectPolicy =
  | 'real'           // production: real reserve locks, real settlement, real events
  | 'simulated'      // simulation: no real side effects, but same code path
  | 'dry-run';       // dry-run: compile only, no execution

/** The runtime context that isolates execution mode. */
export interface RuntimeContext {
  mode: ExecutionMode;
  environment: Environment;
  clock: RuntimeClock;
  sideEffectPolicy: SideEffectPolicy;
  /** In simulation mode, the world state overrides (for what-if). */
  worldStateOverrides?: WorldStateOverrides;
}

/** World state overrides for simulation (what-if scenarios). */
export interface WorldStateOverrides {
  /** Override reserve balances (reserveId → available amount). */
  reserveOverrides?: Record<string, number>;
  /** Override LP availability (lpId → online). */
  lpAvailability?: Record<string, boolean>;
  /** Override fees (lpId → feeBps override). */
  feeOverrides?: Record<string, number>;
}

// ─── Trace Equivalence Check ────────────────────────────────────────────────

/** The result of comparing a production trace against a simulation trace. */
export interface TraceEquivalenceResult {
  equivalent: boolean;
  compilerPasses: {
    productionCount: number;
    simulationCount: number;
    identicalOrder: boolean;
    identicalChoices: boolean;
  };
  pipelineStages: {
    productionCount: number;
    simulationCount: number;
    identicalOrder: boolean;
    identicalStatuses: boolean;
  };
  executionPlan: {
    productionLpId: string | null;
    simulationLpId: string | null;
    identicalLp: boolean;
    productionCostBps: number;
    simulationCostBps: number;
    costDelta: number;
    identicalCost: boolean;
  };
  events: {
    productionEvents: string[];
    simulationEvents: string[];
    identicalSequence: boolean;
  };
  /** Explicitly reported differences (not bugs — expected mode differences). */
  differences: TraceDifference[];
}

/** A difference between production and simulation (expected, not a bug). */
export interface TraceDifference {
  dimension: string;        // e.g. 'settlement_adapter', 'timestamps'
  production: string;
  simulation: string;
  expected: boolean;        // true = this difference is expected/acceptable
}

// ─── Simulation Result ──────────────────────────────────────────────────────

/** The result of running a simulation and comparing it to production. */
export interface SimulationComparison {
  production: {
    success: boolean;
    planId: string | null;
    paymentId: string | null;
    compilerPasses: number;
    pipelineStages: number;
    events: string[];
    estimatedCostBps: number;
    lpId: string | null;
  };
  simulation: {
    success: boolean;
    planId: string | null;
    paymentId: string | null;
    compilerPasses: number;
    pipelineStages: number;
    events: string[];
    estimatedCostBps: number;
    lpId: string | null;
  };
  equivalence: TraceEquivalenceResult;
  summary: string;
}
