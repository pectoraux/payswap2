/**
 * PaySwap Protocol — Expected Cost Routing.
 *
 * Replaces fee-based routing. The solver optimizes Expected Cost, which
 * includes 8 components beyond the nominal fee:
 *
 *   ExpectedCost = fee
 *     + (expected_delay × capital_cost)
 *     + (failure_probability × failure_cost)
 *     + (manual_settlement_risk × manual_cost)
 *     + (fx_risk × fx_volatility)
 *     + (reputation_risk × reputation_penalty)
 *     + (reserve_depletion × depletion_cost)
 *     + (collateral_efficiency × opportunity_cost)
 */
import { round } from '@/kernel/support';

export interface ExpectedCostInput {
  fee: number;                    // nominal fee
  expectedDelayMs: number;        // projected latency
  capitalCostPerMs: number;       // cost of capital per ms (annual rate / year_ms)
  failureProbability: number;     // 0..1
  failureCost: number;            // cost if the settlement fails
  manualSettlementRisk: number;   // 0..1 (probability of manual settlement needed)
  manualCost: number;             // extra cost if manual settlement triggered
  fxRisk: number;                 // 0..1 (FX volatility)
  fxExposure: number;             // amount exposed to FX
  reputationRisk: number;         // 0..1 (LP reputation risk)
  reputationPenalty: number;      // penalty if reputation issue materializes
  reserveDepletion: number;       // 0..1 (how much this depletes reserves)
  depletionCost: number;          // cost of reserve depletion
  collateralEfficiency: number;   // 0..1 (how efficiently collateral is used)
  opportunityCost: number;        // opportunity cost of locked collateral
}

/** Compute the expected cost of a routing candidate. */
export function computeExpectedCost(input: ExpectedCostInput): number {
  const delayCost = input.expectedDelayMs * input.capitalCostPerMs;
  const failureComponent = input.failureProbability * input.failureCost;
  const manualComponent = input.manualSettlementRisk * input.manualCost;
  const fxComponent = input.fxRisk * input.fxExposure;
  const reputationComponent = input.reputationRisk * input.reputationPenalty;
  const depletionComponent = input.reserveDepletion * input.depletionCost;
  const collateralComponent = (1 - input.collateralEfficiency) * input.opportunityCost;

  const total =
    input.fee +
    delayCost +
    failureComponent +
    manualComponent +
    fxComponent +
    reputationComponent +
    depletionComponent +
    collateralComponent;

  return round(total, 6);
}

/** Default expected cost input for a standard LP bridge. */
export function defaultExpectedCost(fee: number, amount: number, delayMs: number, reputation: number): ExpectedCostInput {
  return {
    fee,
    expectedDelayMs: delayMs,
    capitalCostPerMs: 0.000001, // ~3% annual / 31M ms
    failureProbability: 1 - reputation,
    failureCost: amount * 0.02,
    manualSettlementRisk: 0.1,
    manualCost: amount * 0.005,
    fxRisk: 0.02,
    fxExposure: amount,
    reputationRisk: 1 - reputation,
    reputationPenalty: amount * 0.01,
    reserveDepletion: 0.05,
    depletionCost: amount * 0.003,
    collateralEfficiency: 0.8,
    opportunityCost: amount * 0.002,
  };
}
