/**
 * PaySwap Protocol — Authorized Exposure.
 *
 * Replaces `authorized = stake × multiplier` with a dynamic computation.
 * Authorized Exposure is calculated continuously from 10 factors. The solver
 * never allocates more than Authorized Exposure.
 *
 *   AuthorizedExposure = f(
 *     collateral, liquidity, completed_settlements, active_disputes,
 *     fraud_history, country_risk, reserve_utilization,
 *     outstanding_obligations, manual_settlement_ratio, protocol_reputation
 *   )
 */
import { round } from '@/kernel/support';

export interface ExposureFactors {
  collateral: number;          // total collateral locked
  liquidity: number;           // available liquidity (Twin Tokens)
  completedSettlements: number; // count of successful settlements
  activeDisputes: number;      // count of open disputes
  fraudHistory: number;        // 0..1 (0 = clean, 1 = repeated fraud)
  countryRisk: number;         // 0..1 (0 = safe, 1 = high risk)
  reserveUtilization: number;  // 0..1 (0 = healthy, 1 = depleted)
  outstandingObligations: number; // amount of pending manual settlements
  manualSettlementRatio: number; // 0..1 (0 = all auto, 1 = all manual)
  protocolReputation: number;  // 0..1 (0 = poor, 1 = excellent)
}

/** Compute dynamic authorized exposure from 10 factors. */
export function computeAuthorizedExposure(f: ExposureFactors): number {
  // Base exposure = collateral + liquidity (the hard backing)
  const base = f.collateral + f.liquidity;

  // Multipliers (0..1) that adjust the base
  const experienceMultiplier = Math.min(1, f.completedSettlements / 100); // cap at 100 settlements
  const disputePenalty = f.activeDisputes * 0.1; // each active dispute reduces 10%
  const fraudPenalty = f.fraudHistory * 0.5; // fraud history reduces up to 50%
  const countryPenalty = f.countryRisk * 0.3;
  const reservePenalty = f.reserveUtilization * 0.2;
  const obligationPenalty = Math.min(0.5, f.outstandingObligations / Math.max(base, 1));
  const manualPenalty = f.manualSettlementRatio * 0.15;
  const reputationMultiplier = 0.5 + f.protocolReputation * 0.5; // 0.5..1.0

  const totalPenalty = disputePenalty + fraudPenalty + countryPenalty + reservePenalty + obligationPenalty + manualPenalty;
  const adjustedMultiplier = Math.max(0.1, (1 - totalPenalty) * experienceMultiplier * reputationMultiplier);

  const exposure = round(base * adjustedMultiplier, 2);
  return Math.max(0, exposure);
}

/** Default factors for a new LP (probationary). */
export function defaultExposureFactors(collateral: number, liquidity: number): ExposureFactors {
  return {
    collateral,
    liquidity,
    completedSettlements: 0,
    activeDisputes: 0,
    fraudHistory: 0,
    countryRisk: 0.2,
    reserveUtilization: 0.1,
    outstandingObligations: 0,
    manualSettlementRatio: 0,
    protocolReputation: 0.5,
  };
}
