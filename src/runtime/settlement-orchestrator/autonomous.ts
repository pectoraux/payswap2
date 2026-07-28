/**
 * Autonomous Treasury + LP Intelligence. (M-ECO-33 + M-ECO-34.)
 *
 * M-ECO-33: Treasury evolves from recommendation engine into autonomous
 * execution engine operating within governance policies.
 *
 * M-ECO-34: LPs become continuously optimized economic participants with
 * reputation, dynamic risk, incentives, and learning.
 */

import type { IntelligencePolicyConfig } from '../eco-intelligence/types';
import { uid } from '../types';

// ─── M-ECO-33: Autonomous Treasury ─────────────────────────────────────────

/** Treasury governance policies — everything configurable. */
export interface TreasuryGovernancePolicy {
  maxExposurePerCountry: number;
  maxExposurePerAsset: number;
  maxStablecoinPurchase: number;
  minReserveBalance: number;
  emergencyReserveThreshold: number;
  confidenceThreshold: number;       // minimum confidence to auto-execute
  autoExecuteEnabled: boolean;       // if false, all actions require approval
  maxBandwidthPurchase: number;
  rebalanceThreshold: number;        // utilization delta that triggers rebalance
}

export const DEFAULT_GOVERNANCE: TreasuryGovernancePolicy = {
  maxExposurePerCountry: 2_000_000,
  maxExposurePerAsset: 1_000_000,
  maxStablecoinPurchase: 500_000,
  minReserveBalance: 50_000,
  emergencyReserveThreshold: 0.1,
  confidenceThreshold: 0.7,
  autoExecuteEnabled: true,
  maxBandwidthPurchase: 1_000_000,
  rebalanceThreshold: 0.15,
};

/** Autonomous treasury action (ready for execution). */
export interface TreasuryAction {
  actionId: string;
  actionType: 'buy_stablecoin' | 'sell_stablecoin' | 'rebalance_reserve' | 'purchase_bandwidth' | 'open_reserve' | 'close_reserve' | 'convert_stablecoin';
  country: string;
  currency: string;
  amount: number;
  reason: string;
  confidence: number;
  autoExecutable: boolean;           // true if within policy limits
  policyChecked: boolean;
  requiresApproval: boolean;         // true if outside policy limits
}

/** Treasury risk assessment. */
export interface TreasuryRiskAssessment {
  countryExposure: Record<string, number>;
  stablecoinExposure: Record<string, number>;
  lpExposure: number;
  fxExposure: number;
  reserveCoverage: number;           // [0, 1]
  liquidityCoverage: number;         // [0, 1]
  settlementObligations: number;
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * TreasuryDirector — the autonomous treasury execution engine.
 *
 * Takes recommendations from the LiquidityIntelligenceEngine and:
 *   1. Checks them against governance policies
 *   2. Auto-executes if within policy limits
 *   3. Flags for approval if outside limits
 *
 * Never violates governance policies. Never executes without policy check.
 */
export class TreasuryDirector {
  private readonly governance: TreasuryGovernancePolicy;

  constructor(
    private getRecommendations: () => {
      reserveRecommendations: Array<{ country: string; currency: string; action: string; amount: number; reason: string; priority: string }>;
      treasuryDecisions: Array<{ currency: string; asset: string; action: string; amount: number; reason: string; confidence: number }>;
    },
    private getTreasuryState: () => {
      accounts: Array<{ kind: string; currency: string; availableBalance: number; reference: string | null }>;
    },
    governance?: Partial<TreasuryGovernancePolicy>,
  ) {
    this.governance = { ...DEFAULT_GOVERNANCE, ...governance };
  }

  /**
   * Generate autonomous treasury actions (policy-checked).
   *
   * Actions within policy limits are auto-executable.
   * Actions outside limits require approval.
   */
  planActions(): TreasuryAction[] {
    const { reserveRecommendations, treasuryDecisions } = this.getRecommendations();
    const actions: TreasuryAction[] = [];

    // Convert reserve recommendations to actions.
    for (const rec of reserveRecommendations) {
      const autoExecutable = this.governance.autoExecuteEnabled &&
        rec.amount <= this.governance.maxExposurePerCountry &&
        rec.priority !== 'critical'; // critical always requires approval

      actions.push({
        actionId: uid('ta'),
        actionType: rec.action === 'increase' ? 'open_reserve' : rec.action === 'decrease' ? 'close_reserve' : 'rebalance_reserve',
        country: rec.country, currency: rec.currency, amount: rec.amount,
        reason: rec.reason, confidence: 0.8,
        autoExecutable, policyChecked: true,
        requiresApproval: !autoExecutable,
      });
    }

    // Convert treasury decisions to actions.
    for (const dec of treasuryDecisions) {
      const autoExecutable = this.governance.autoExecuteEnabled &&
        dec.amount <= this.governance.maxStablecoinPurchase &&
        dec.confidence >= this.governance.confidenceThreshold;

      actions.push({
        actionId: uid('ta'),
        actionType: dec.action === 'buy' ? 'buy_stablecoin' : dec.action === 'sell' ? 'sell_stablecoin' : 'convert_stablecoin',
        country: 'global', currency: dec.currency, amount: dec.amount,
        reason: dec.reason, confidence: dec.confidence,
        autoExecutable, policyChecked: true,
        requiresApproval: !autoExecutable,
      });
    }

    return actions;
  }

  /**
   * Assess treasury risk.
   */
  assessRisk(): TreasuryRiskAssessment {
    const { accounts } = this.getTreasuryState();
    const reserves = accounts.filter((a) => a.kind === 'reserve');
    const stablecoins = accounts.filter((a) => a.reference?.includes('stablecoin'));

    const countryExposure: Record<string, number> = {};
    for (const r of reserves) {
      const country = r.reference ?? 'unknown';
      countryExposure[country] = (countryExposure[country] ?? 0) + r.availableBalance;
    }

    const stablecoinExposure: Record<string, number> = {};
    for (const s of stablecoins) {
      stablecoinExposure[s.currency] = (stablecoinExposure[s.currency] ?? 0) + s.availableBalance;
    }

    const totalReserves = reserves.reduce((s, r) => s + r.availableBalance, 0);
    const totalStablecoins = stablecoins.reduce((s, r) => s + r.availableBalance, 0);
    const total = totalReserves + totalStablecoins;
    const reserveCoverage = total > 0 ? totalReserves / total : 0;

    const maxCountryExposure = Math.max(...Object.values(countryExposure), 0);
    const overallRisk: TreasuryRiskAssessment['overallRisk'] =
      maxCountryExposure > this.governance.maxExposurePerCountry ? 'critical' :
      reserveCoverage < this.governance.emergencyReserveThreshold ? 'high' :
      reserveCoverage < 0.3 ? 'medium' : 'low';

    return {
      countryExposure, stablecoinExposure,
      lpExposure: 0, fxExposure: 0,
      reserveCoverage, liquidityCoverage: reserveCoverage,
      settlementObligations: 0, overallRisk,
    };
  }

  /** Get the governance policy. */
  getGovernance(): TreasuryGovernancePolicy {
    return { ...this.governance };
  }
}

// ─── M-ECO-34: LP Intelligence & Incentive Engine ──────────────────────────

/** LP reputation score (continuously updated). */
export interface LPReputation {
  lpId: string;
  reputationScore: number;           // [0, 1] — composite
  settlementSuccessRate: number;     // [0, 1]
  failureRate: number;               // [0, 1]
  timeoutRate: number;               // [0, 1]
  disputeRate: number;               // [0, 1]
  averageResponseTime: number;       // ms
  capitalAvailability: number;       // total available bandwidth
  escrowUsageRate: number;           // [0, 1]
  historicalBehavior: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
}

/** LP incentive recommendation. */
export interface LPIncentive {
  lpId: string;
  feeShareAdjustment: number;        // bps adjustment (+/-)
  bonusReward: number;               // bonus in bps
  bandwidthMultiplier: number;       // routing multiplier (e.g., 1.2 = 20% more routing)
  priorityRouting: boolean;          // if true, prefer this LP
  penalty: number;                   // penalty in bps (if poor performance)
  reason: string;
}

/** LP learning update (after each settlement). */
export interface LPLearningUpdate {
  lpId: string;
  expectedCost: number;
  expectedLatency: number;
  expectedFailureProb: number;
  expectedROI: number;
  updatedAt: number;
}

/**
 * LPIntelligenceEngine — continuously optimizes LPs.
 *
 * Tracks reputation, calculates incentives, learns from each settlement,
 * and recommends network-level actions (recruit, retire, adjust incentives).
 */
export class LPIntelligenceEngine {
  private readonly reputations = new Map<string, LPReputation>();
  private readonly learning = new Map<string, LPLearningUpdate>();
  private readonly incentives = new Map<string, LPIncentive>();

  /** Update LP reputation after a settlement event. */
  updateReputation(lpId: string, update: {
    success: boolean;
    timeout: boolean;
    disputed: boolean;
    responseTime: number;
    capitalAvailable: number;
    escrowUsed: number;
  }): LPReputation {
    let rep = this.reputations.get(lpId);
    if (!rep) {
      rep = {
        lpId, reputationScore: 0.5, settlementSuccessRate: 0.5, failureRate: 0.5,
        timeoutRate: 0, disputeRate: 0, averageResponseTime: 5000,
        capitalAvailability: 0, escrowUsageRate: 0, historicalBehavior: 'fair',
      };
      this.reputations.set(lpId, rep);
    }

    // Exponential moving average (deterministic).
    const alpha = 0.1;
    const isSuccess = update.success ? 1 : 0;
    rep.settlementSuccessRate = rep.settlementSuccessRate * (1 - alpha) + isSuccess * alpha;
    rep.failureRate = 1 - rep.settlementSuccessRate;
    rep.timeoutRate = rep.timeoutRate * (1 - alpha) + (update.timeout ? 1 : 0) * alpha;
    rep.disputeRate = rep.disputeRate * (1 - alpha) + (update.disputed ? 1 : 0) * alpha;
    rep.averageResponseTime = rep.averageResponseTime * (1 - alpha) + update.responseTime * alpha;
    rep.capitalAvailability = update.capitalAvailable;
    rep.escrowUsageRate = rep.escrowUsageRate * (1 - alpha) + (update.escrowUsed > 0 ? 1 : 0) * alpha;

    // Composite reputation score.
    rep.reputationScore =
      rep.settlementSuccessRate * 0.4 +
      (1 - rep.timeoutRate) * 0.2 +
      (1 - rep.disputeRate) * 0.2 +
      Math.min(1, rep.capitalAvailability / 100_000) * 0.1 +
      Math.max(0, 1 - rep.averageResponseTime / 10_000) * 0.1;

    // Historical behavior classification.
    rep.historicalBehavior =
      rep.reputationScore > 0.9 ? 'excellent' :
      rep.reputationScore > 0.7 ? 'good' :
      rep.reputationScore > 0.5 ? 'fair' :
      rep.reputationScore > 0.3 ? 'poor' : 'critical';

    return rep;
  }

  /** Calculate incentive for an LP based on reputation. */
  calculateIncentive(lpId: string): LPIncentive {
    const rep = this.reputations.get(lpId);
    if (!rep) {
      return {
        lpId, feeShareAdjustment: 0, bonusReward: 0, bandwidthMultiplier: 1,
        priorityRouting: false, penalty: 0, reason: 'No reputation data — default incentives',
      };
    }

    let feeShareAdjustment = 0;
    let bonusReward = 0;
    let bandwidthMultiplier = 1;
    let priorityRouting = false;
    let penalty = 0;
    let reason = 'Standard incentives';

    if (rep.historicalBehavior === 'excellent') {
      feeShareAdjustment = 10; // +10 bps
      bonusReward = 20; // +20 bps bonus
      bandwidthMultiplier = 1.2; // 20% more routing
      priorityRouting = true;
      reason = 'Excellent reputation — priority routing + bonus';
    } else if (rep.historicalBehavior === 'good') {
      feeShareAdjustment = 5;
      bandwidthMultiplier = 1.1;
      reason = 'Good reputation — slight boost';
    } else if (rep.historicalBehavior === 'poor') {
      feeShareAdjustment = -5;
      bandwidthMultiplier = 0.9;
      reason = 'Poor reputation — reduced routing';
    } else if (rep.historicalBehavior === 'critical') {
      feeShareAdjustment = -10;
      penalty = 50;
      bandwidthMultiplier = 0.5;
      reason = 'Critical reputation — heavy penalty + reduced routing';
    }

    return { lpId, feeShareAdjustment, bonusReward, bandwidthMultiplier, priorityRouting, penalty, reason };
  }

  /** Update LP learning after a settlement. */
  updateLearning(lpId: string, update: {
    cost: number;
    latency: number;
    success: boolean;
    roi: number;
  }): LPLearningUpdate {
    let learn = this.learning.get(lpId);
    if (!learn) {
      learn = { lpId, expectedCost: 200, expectedLatency: 5000, expectedFailureProb: 0.1, expectedROI: 80, updatedAt: Date.now() };
      this.learning.set(lpId, learn);
    }

    const alpha = 0.15;
    learn.expectedCost = learn.expectedCost * (1 - alpha) + update.cost * alpha;
    learn.expectedLatency = learn.expectedLatency * (1 - alpha) + update.latency * alpha;
    learn.expectedFailureProb = learn.expectedFailureProb * (1 - alpha) + (update.success ? 0 : 1) * alpha;
    learn.expectedROI = learn.expectedROI * (1 - alpha) + update.roi * alpha;
    learn.updatedAt = Date.now();

    return learn;
  }

  /** Get reputation for an LP. */
  getReputation(lpId: string): LPReputation | null {
    return this.reputations.get(lpId) ?? null;
  }

  /** Get learning data for an LP. */
  getLearning(lpId: string): LPLearningUpdate | null {
    return this.learning.get(lpId) ?? null;
  }

  /** List all reputations. */
  listReputations(): LPReputation[] {
    return [...this.reputations.values()].sort((a, b) => b.reputationScore - a.reputationScore);
  }

  /** List all learning data. */
  listLearning(): LPLearningUpdate[] {
    return [...this.learning.values()];
  }

  /**
   * Network intelligence — recommend network-level actions.
   */
  recommendNetworkActions(): { action: string; lpId?: string; reason: string; priority: 'low' | 'medium' | 'high' }[] {
    const recommendations: { action: string; lpId?: string; reason: string; priority: 'low' | 'medium' | 'high' }[] = [];
    const reps = this.listReputations();

    for (const rep of reps) {
      if (rep.historicalBehavior === 'critical') {
        recommendations.push({
          action: 'retire_lp', lpId: rep.lpId,
          reason: `LP ${rep.lpId} has critical reputation (score: ${rep.reputationScore.toFixed(2)})`,
          priority: 'high',
        });
      } else if (rep.historicalBehavior === 'excellent') {
        recommendations.push({
          action: 'increase_incentives', lpId: rep.lpId,
          reason: `LP ${rep.lpId} has excellent reputation — increase incentives to retain`,
          priority: 'medium',
        });
      }
    }

    return recommendations;
  }
}
