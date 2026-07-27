/**
 * The real Financial Compiler — M-RT-8 (Full pass pipeline).
 *
 * M-RT-7 established the contract: TypedIntent → FinancialCompiler → ExecutionPlan.
 * M-RT-8 deepens the implementation by replacing placeholder passes with real
 * ones and adding the remaining passes (reserve_allocation, reserve_aware_routing,
 * liquidity_optimization, fx_optimization). The public contract stays stable.
 *
 * The compiler is now a COMPOSABLE PASS PIPELINE:
 *   ExecutionPlan → Pass.execute() → Updated ExecutionPlan + CompilationPassResult
 *
 * PROPERTIES (non-negotiable, preserved from M-RT-7):
 *   - PURE: same intent + same input snapshots → same ExecutionPlan. No side effects.
 *   - READ-ONLY: reads projections but mutates NONE of them.
 *   - INSPECTABLE: every pass leaves an explicit CompilationPassResult artifact.
 *   - EMITS NOTHING: returns the plan (or a compile result) — no events.
 *   - ADDITIVE: cost components preserved individually, not collapsed.
 */

import type { TypedIntent } from '../intent/types';
import type { RuntimeClock } from '../clock';
import type { Environment } from '../types';
import type { Decision } from '../decisions/types';
import { decision } from '../decisions/types';
import type {
  ExecutionPlan,
  ExecutionPlanAlternative,
  CompilationPassResult,
  CompilationPassName,
  ReserveAllocation,
  LPAllocation,
  FXHop,
  SettlementLeg,
  CollateralPlan,
  CapitalAllocation,
  ExecutionTiming,
} from './types';
import type { RouteScoringEngine } from '../engines/routing/engine';
import type { RoutingResult } from '../engines/routing/types';
import type { ReserveMarketEngine } from '../engines/reserve-market-v2/engine';
import type { LiquidityMarketplaceService } from '../engines/liquidity-marketplace/service';
import type { CapabilityGraph } from '../graphs/capability/types';
import type { CompilerPass } from './passes';
import { FULL_PASS_PIPELINE } from './passes';

/** The result of compilation — either a plan or an explicit failure. */
export interface CompileResult {
  plan: ExecutionPlan | null;
  routing: RoutingResult | null;
  success: boolean;
  error?: string;
}

/** Everything the real compiler reads. All lower-layer projections. */
export interface RealCompilerContext {
  clock: RuntimeClock;
  environment: Environment;
  capabilityGraph: CapabilityGraph;
  routeScoringEngine: RouteScoringEngine;
  reserveMarket: ReserveMarketEngine;
  liquidityMarketplace: LiquidityMarketplaceService;
}

/**
 * FinancialCompiler — the real implementation.
 *
 * M-RT-7: established the contract (TypedIntent → ExecutionPlan) with minimal passes.
 * M-RT-8: deepens the implementation via a composable pass pipeline (all 9 passes).
 * The public contract stays stable — only the internal reasoning becomes richer.
 */
export class FinancialCompiler {
  /** The pass pipeline (M-RT-8: all 9 passes). */
  private pipeline: CompilerPass[] = FULL_PASS_PIPELINE;

  /**
   * Compile a TypedIntent into an ExecutionPlan using the FULL pass pipeline.
   * (M-RT-8: replaces the M-RT-7 minimal compile with the full pipeline.)
   * Pure, deterministic, no side effects.
   */
  async compile(intent: TypedIntent, ctx: RealCompilerContext): Promise<CompileResult> {
    const passes: CompilationPassResult[] = [];
    const compiledAt = ctx.clock.now();

    // Start with an empty plan.
    let plan: ExecutionPlan = {
      id: `plan_${intent.id}`,
      intentId: intent.id,
      reserveAllocations: [],
      lpAllocations: [],
      fxHops: [],
      settlementLegs: [],
      collateral: { reserveId: '', amount: 0, currency: '' },
      capitalAllocation: { totalCapitalDeployed: 0, breakdown: [] },
      executionTiming: { startAt: compiledAt, settleBy: compiledAt, isImmediate: true },
      passes: [],
      rationale: '',
      alternativesConsidered: [],
      estimatedCostBps: 0,
      estimatedRisk: 0,
      expectedProfitability: 0,
      compiledAt,
    };

    // Execute each pass in order.
    for (const pass of this.pipeline) {
      const result = await pass.execute(plan, ctx, intent);
      plan = result.plan;
      passes.push(result.result);

      if (!result.continue) {
        // Pass rejected the plan — compilation stops.
        return {
          plan: null,
          routing: (plan as ExecutionPlan & { routing?: RoutingResult }).routing ?? null,
          success: false,
          error: result.rejectionReason,
        };
      }
    }

    // Finalize the plan.
    plan.passes = passes;

    return {
      plan,
      routing: (plan as ExecutionPlan & { routing?: RoutingResult }).routing ?? null,
      success: true,
    };
  }
}
