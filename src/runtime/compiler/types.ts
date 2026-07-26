/**
 * Financial Network Compiler — the unifying abstraction. (v1.4 §7P.)
 *
 * The Runtime is not routing — it is compiling. The Financial Compiler turns
 * a business Intent into an executable Execution Plan through a sequence of
 * optimization passes. Every engine is a compiler optimization pass.
 *
 *   Intent → Compiler → Execution Plan → Runtime → Settlement
 *   Source Code → Compiler → Machine Code → CPU
 *
 * The Execution Plan is the "machine code" the Runtime executes. The Digital
 * Twin is a compiler sandbox — same compiler, different world state.
 *
 * M-RT-1 ships types + a no-op compiler. The payments vertical slice (M-RT-12)
 * compiles through the real Financial Compiler.
 */

import type { Decision } from '../decisions/types';
import type { TypedIntent } from '../intent/types';
import type { Environment } from '../types';
import type { EvidenceCitation } from '../types';
import type { RuntimeClock } from '../clock';
import type { ReserveMarket, ReserveMarketState } from '../engines/reserve-market';
import type { LiquidityStrategyMarketplace } from '../engines/liquidity-market';
import type { EconomicScoreEngine } from '../engines/economic-score';
import type { LPCapability } from '../graphs/capability/types';
import type { FinancialKnowledgeGraph } from '../graphs/knowledge-graph/types';

/** The ordered compiler passes. Every engine is one of these. */
export type CompilationPassName =
  | 'resolve_identities'
  | 'policy'
  | 'compliance'
  | 'fraud'
  | 'reserve_optimization'
  | 'liquidity_optimization'
  | 'fx_optimization'
  | 'settlement_planning';

/** The canonical pass order. */
export const COMPILATION_PASS_ORDER: readonly CompilationPassName[] = [
  'resolve_identities',
  'policy',
  'compliance',
  'fraud',
  'reserve_optimization',
  'liquidity_optimization',
  'fx_optimization',
  'settlement_planning',
] as const;

/** The result of one compiler pass — a Decision + timing. */
export interface CompilationPassResult {
  pass: CompilationPassName;
  decision: Decision;       // the universal explainability record
  durationMs: number;
}

// ─── Execution Plan components (the "machine code") ─────────────────────────

export interface ReserveAllocation {
  reserveId: string;
  amount: number;
  currency: string;
  shadowPriceBps: number;
}

export interface LPAllocation {
  lpId: string;
  capabilityId: string;
  amount: number;
  feeBps: number;
}

export interface FXHop {
  from: string;
  to: string;
  rate: number;
  costBps: number;
}

export interface SettlementLeg {
  legId: string;
  from: string;
  to: string;
  amount: number;
  currency: string;
  connectorId: string;
}

export interface CollateralPlan {
  reserveId: string;
  amount: number;
  currency: string;
}

export interface CapitalAllocation {
  totalCapitalDeployed: number;
  breakdown: { source: string; amount: number }[];
}

export interface ExecutionTiming {
  startAt: number;            // Runtime Clock ms
  settleBy: number;           // deadline
  isImmediate: boolean;
}

export interface ExecutionPlanAlternative {
  description: string;
  estimatedCostBps: number;
  estimatedRisk: number;
  rejectedBecause: string;
}

/**
 * The Execution Plan — the compiler's output. The "machine code" the Runtime
 * executes. A complete, executable financial program.
 */
export interface ExecutionPlan {
  id: string;
  intentId: string;
  // The compiled decisions (one per pass):
  reserveAllocations: ReserveAllocation[];
  lpAllocations: LPAllocation[];
  fxHops: FXHop[];
  settlementLegs: SettlementLeg[];
  collateral: CollateralPlan;
  capitalAllocation: CapitalAllocation;
  executionTiming: ExecutionTiming;
  // The passes that produced this plan (for inspection/replay):
  passes: CompilationPassResult[];
  // Explainability:
  rationale: string;
  alternativesConsidered: ExecutionPlanAlternative[];
  estimatedCostBps: number;
  estimatedRisk: number;
  expectedProfitability: number;
  compiledAt: number;
}

// ─── Compiler context + assumptions ─────────────────────────────────────────

/** Everything the compiler reads at compile time. */
export interface CompilerContext {
  clock: RuntimeClock;
  knowledgeGraph: FinancialKnowledgeGraph;
  reserveMarket: ReserveMarket;
  liquidityStrategyMarketplace: LiquidityStrategyMarketplace;
  economicScore: EconomicScoreEngine;
  runtimeMemory: RuntimeMemoryLike;
  environment: Environment;
}

/** Minimal Runtime Memory surface the compiler needs (avoids a circular import). */
export interface RuntimeMemoryLike {
  recall(query: { subject?: string; kind?: string }): Promise<unknown[]>;
}

/** World-state overrides for Digital Twin compilation (the compiler sandbox). */
export interface WorldAssumptions {
  reserveOverrides?: Record<string, Partial<ReserveMarketState>>;
  capabilityOverrides?: LPCapability[];
  fxOverrides?: Record<string, number>;
  scenarioId?: string;
}

// ─── The Financial Compiler contract ────────────────────────────────────────

export interface FinancialCompiler {
  /** Compile a TypedIntent into an Execution Plan. */
  compile(intent: TypedIntent, ctx: CompilerContext): Promise<ExecutionPlan>;
  /** Re-compile from a given pass (for partial replay / what-if). */
  recompileFrom(plan: ExecutionPlan, fromPass: CompilationPassName, ctx: CompilerContext): Promise<ExecutionPlan>;
  /** Compile under different assumptions (Digital Twin sandbox). */
  compileWithAssumptions(intent: TypedIntent, assumptions: WorldAssumptions, ctx: CompilerContext): Promise<ExecutionPlan>;
}

/**
 * NoOpFinancialCompiler — the M-RT-1 placeholder. Produces an empty Execution
 * Plan with a no-op pass result. M-RT-12 (payments vertical slice) replaces
 * this with the real compiler that runs every engine as a pass.
 */
export class NoOpFinancialCompiler implements FinancialCompiler {
  async compile(intent: TypedIntent): Promise<ExecutionPlan> {
    return this.emptyPlan(intent.id);
  }

  async recompileFrom(plan: ExecutionPlan, _fromPass: CompilationPassName): Promise<ExecutionPlan> {
    return this.emptyPlan(plan.intentId);
  }

  async compileWithAssumptions(intent: TypedIntent, _assumptions: WorldAssumptions): Promise<ExecutionPlan> {
    return this.emptyPlan(intent.id);
  }

  private emptyPlan(intentId: string): ExecutionPlan {
    return {
      id: `plan_${intentId}`,
      intentId,
      reserveAllocations: [],
      lpAllocations: [],
      fxHops: [],
      settlementLegs: [],
      collateral: { reserveId: '', amount: 0, currency: '' },
      capitalAllocation: { totalCapitalDeployed: 0, breakdown: [] },
      executionTiming: { startAt: 0, settleBy: 0, isImmediate: true },
      passes: [],
      rationale: 'M-RT-1 no-op compiler: real compilation lands in M-RT-12.',
      alternativesConsidered: [],
      estimatedCostBps: 0,
      estimatedRisk: 0,
      expectedProfitability: 0,
      compiledAt: 0,
    };
  }
}
