/**
 * PaySwap Protocol — Reputation System.
 *
 * Continuously updated reputation scores for LPs and merchants. Derived from
 * multiple independent signals. Routing optimizes Expected Cost, not fee.
 */
import { round } from '@/kernel/support';

export interface LPReputationFactors {
  successRate: number;       // 0..1
  avgLatencyMs: number;      // lower is better
  proofQuality: number;      // 0..1
  disputeLossRate: number;   // 0..1 (fraction of disputes lost)
  settlementConsistency: number; // 0..1
  uptime: number;            // 0..1
  liquidityAvailability: number; // 0..1
}

/** Compute LP reputation score (0..1). */
export function computeLPReputation(f: LPReputationFactors): number {
  const latencyScore = Math.max(0, 1 - f.avgLatencyMs / 120000); // 2 min = 0
  const score =
    f.successRate * 0.25 +
    latencyScore * 0.15 +
    f.proofQuality * 0.15 +
    (1 - f.disputeLossRate) * 0.15 +
    f.settlementConsistency * 0.10 +
    f.uptime * 0.10 +
    f.liquidityAvailability * 0.10;
  return round(Math.max(0, Math.min(1, score)), 4);
}

export interface MerchantReputationFactors {
  claimSuccessRate: number;  // 0..1
  disputeWinRate: number;    // 0..1
  fraudFlagRate: number;     // 0..1
  bondAmount: number;        // higher bond = more trustworthy
  transactionVolume: number; // higher volume = more established
}

/** Compute merchant reputation score (0..1). */
export function computeMerchantReputation(f: MerchantReputationFactors): number {
  const bondScore = Math.min(1, f.bondAmount / 50000);
  const volumeScore = Math.min(1, f.transactionVolume / 1000000);
  const score =
    f.claimSuccessRate * 0.25 +
    f.disputeWinRate * 0.15 +
    (1 - f.fraudFlagRate) * 0.25 +
    bondScore * 0.20 +
    volumeScore * 0.15;
  return round(Math.max(0, Math.min(1, score)), 4);
}

/** Default LP reputation factors (probationary). */
export function defaultLPReputation(): LPReputationFactors {
  return {
    successRate: 0.95,
    avgLatencyMs: 50000,
    proofQuality: 0.7,
    disputeLossRate: 0,
    settlementConsistency: 0.8,
    uptime: 0.95,
    liquidityAvailability: 0.9,
  };
}

/** Default merchant reputation factors. */
export function defaultMerchantReputation(bond: number): MerchantReputationFactors {
  return {
    claimSuccessRate: 0.9,
    disputeWinRate: 0.5,
    fraudFlagRate: 0,
    bondAmount: bond,
    transactionVolume: 0,
  };
}
