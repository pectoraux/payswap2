/**
 * Adaptive Liquidity Intelligence — Types. (M-ECO-31.)
 *
 * The runtime transforms from a transaction processor into an adaptive
 * global liquidity operating system. All intelligence is DETERMINISTIC
 * (no LLM reasoning inside the runtime — only optimization algorithms).
 *
 * Architecture:
 *   LiquidityIntelligenceEngine (the "brain")
 *   ├── ReserveForecastEngine    (predicts future reserve needs)
 *   ├── BandwidthOptimizer       (optimizes LP bandwidth allocation)
 *   ├── CorridorIntelligence     (tracks corridor health + classification)
 *   ├── LPIntelligence           (dynamic LP risk/reliability scoring)
 *   ├── ReserveExpansionPlanner  (recommends reserve growth/shrink)
 *   ├── DynamicTreasuryPolicy    (predictive buy/sell/hold)
 *   └── PredictiveMarketplace    (generates LP opportunities before shortages)
 */

// ─── Reserve Forecast ──────────────────────────────────────────────────────

export interface ReserveForecast {
  country: string;
  currency: string;
  currentReserve: number;
  expectedSettlements: number;      // predicted settlement volume
  expectedRedemptions: number;      // predicted twin token redemptions
  expectedFxDemand: number;         // predicted FX conversion volume
  expectedCorridorGrowth: number;   // predicted corridor growth rate
  expectedLPParticipation: number;  // predicted LP bandwidth available
  predictedDepletion: number;       // predicted reserve depletion (ms to empty)
  confidence: number;               // [0, 1]
  forecastAt: number;
}

// ─── Bandwidth Optimization ────────────────────────────────────────────────

export interface BandwidthOptimization {
  lpId: string;
  country: string;
  assetType: 'twin_token' | 'stablecoin';
  available: number;
  reserved: number;
  escrowed: number;
  utilized: number;
  idle: number;
  expectedYield: number;     // predicted yield (bps)
  riskScore: number;         // [0, 1]
  opportunityCost: number;   // cost of not using this bandwidth
  historicalROI: number;     // historical return on investment (bps)
  recommendation: 'increase' | 'decrease' | 'hold' | 'rebalance';
  reason: string;
}

// ─── Corridor Intelligence ─────────────────────────────────────────────────

export type CorridorHealth = 'healthy' | 'growing' | 'constrained' | 'critical' | 'emerging';

export interface CorridorIntelligenceView {
  fromCountry: string;
  toCountry: string;
  currency: string;
  demand: number;                // current demand volume
  supply: number;                // current supply capacity
  reserveSufficiency: number;    // [0, 1] (1 = fully sufficient)
  stablecoinDependency: number;  // [0, 1] (1 = fully dependent)
  lpDensity: number;             // number of active LPs
  fxVolatility: number;          // [0, 1]
  settlementTime: number;        // average settlement time (ms)
  cost: number;                  // average cost (bps)
  risk: number;                  // [0, 1]
  growth: number;                // growth rate [0, 1]
  health: CorridorHealth;
  recommendations: string[];
}

// ─── LP Intelligence ───────────────────────────────────────────────────────

export interface LPIntelligenceView {
  lpId: string;
  reliabilityScore: number;       // [0, 1]
  settlementSuccessRate: number;  // [0, 1]
  settlementSpeed: number;        // average ms
  disputeRate: number;            // [0, 1]
  escrowUsage: number;            // total escrowed
  bandwidthUsage: number;         // total utilized
  reserveContribution: number;    // total contributed
  historicalROI: number;          // bps
  riskRating: 'low' | 'medium' | 'high';
  dynamicCapacity: number;        // adjusted capacity based on performance
  expectedCost: number;           // expected total cost (spread + failure prob + dispute cost + delay + capital risk)
}

// ─── Reserve Expansion ─────────────────────────────────────────────────────

export type ReserveAction = 'open' | 'increase' | 'close' | 'decrease' | 'hold' | 'reduce_stablecoin';

export interface ReserveExpansionRecommendation {
  country: string;
  currency: string;
  currentReserve: number;
  utilizationRate: number;        // [0, 1]
  targetUtilization: number;      // configurable target
  action: ReserveAction;
  amount: number;                 // recommended amount
  reason: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

// ─── Dynamic Treasury Policy ───────────────────────────────────────────────

export type TreasuryAction = 'buy' | 'sell' | 'hold';

export interface TreasuryPolicyDecision {
  currency: string;
  asset: string;                  // 'USDT', 'USDC', etc.
  currentInventory: number;
  targetInventory: number;
  safetyBuffer: number;
  maxExposure: number;
  action: TreasuryAction;
  amount: number;
  reason: string;
  confidence: number;
}

// ─── Predictive Marketplace ────────────────────────────────────────────────

export interface PredictiveOpportunity {
  opportunityId: string;
  corridor: { from: string; to: string };
  currency: string;
  predictedDemand: number;
  predictedShortfall: number;
  suggestedBandwidth: number;
  suggestedIncentiveBps: number;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  createdAt: number;
}

// ─── Economic Health ───────────────────────────────────────────────────────

export interface CountryEconomicHealth {
  country: string;
  reserveScore: number;           // [0, 1]
  liquidityScore: number;         // [0, 1]
  settlementScore: number;        // [0, 1]
  bandwidthScore: number;         // [0, 1]
  growthScore: number;            // [0, 1]
  riskScore: number;              // [0, 1]
  fxScore: number;                // [0, 1]
  confidenceScore: number;        // [0, 1]
  overallScore: number;           // weighted average
  classification: CorridorHealth;
}

export interface EconomicHealthDashboard {
  countries: CountryEconomicHealth[];
  corridors: CorridorIntelligenceView[];
  lpRankings: LPIntelligenceView[];
  reserveRecommendations: ReserveExpansionRecommendation[];
  treasuryDecisions: TreasuryPolicyDecision[];
  predictiveOpportunities: PredictiveOpportunity[];
  totalReserves: number;
  totalBandwidth: number;
  totalTwinTokens: number;
  stablecoinDependency: number;   // [0, 1] overall
  generatedAt: number;
}

// ─── Policy Configuration ──────────────────────────────────────────────────

export interface IntelligencePolicyConfig {
  // Reserve targets.
  reserveTargetUtilization: number;    // default 0.7 (70%)
  reserveCriticalThreshold: number;    // default 0.9 (90%)
  reserveGrowthTrigger: number;        // utilization above this → recommend growth
  // Stablecoin inventory.
  stablecoinSafetyBuffer: number;      // minimum buffer
  stablecoinMaxExposure: number;       // maximum exposure per asset
  stablecoinMaxCountryExposure: number;
  // LP scoring weights.
  lpSpreadWeight: number;              // weight for spread in expected cost
  lpFailureWeight: number;             // weight for failure probability
  lpDisputeWeight: number;             // weight for dispute cost
  lpDelayWeight: number;               // weight for delay
  lpCapitalRiskWeight: number;         // weight for capital risk
  // Corridor thresholds.
  corridorCriticalThreshold: number;   // reserve sufficiency below this → critical
  corridorConstrainedThreshold: number;
  // Forecast confidence.
  minForecastConfidence: number;       // minimum confidence to act on forecast
}

export const DEFAULT_POLICY: IntelligencePolicyConfig = {
  reserveTargetUtilization: 0.7,
  reserveCriticalThreshold: 0.9,
  reserveGrowthTrigger: 0.8,
  stablecoinSafetyBuffer: 50_000,
  stablecoinMaxExposure: 1_000_000,
  stablecoinMaxCountryExposure: 500_000,
  lpSpreadWeight: 0.4,
  lpFailureWeight: 0.2,
  lpDisputeWeight: 0.15,
  lpDelayWeight: 0.15,
  lpCapitalRiskWeight: 0.1,
  corridorCriticalThreshold: 0.2,
  corridorConstrainedThreshold: 0.5,
  minForecastConfidence: 0.6,
};
