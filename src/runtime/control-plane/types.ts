/**
 * Economic Control Plane — Types. (M-ECO-34.5.)
 *
 * The strategic layer that governs all existing economic components.
 * Not another runtime — it's the decision layer that decides HOW the
 * runtime should evolve while remaining deterministic, replay-safe,
 * explainable, and governed.
 *
 *   Economic Constitution (immutable rules)
 *   ↓
 *   Liquidity Digital Twin (simulation before execution)
 *   ↓
 *   Treasury Director (autonomous within governance)
 *   ↓
 *   Capital Allocation (where should capital go?)
 *   ↓
 *   Settlement Orchestrator (durable workflow actors)
 *   ↓
 *   Marketplace (LP auction)
 *   ↓
 *   LP Network (optimized as a graph)
 *   ↓
 *   Settlement (blockchain adapters)
 */

// ─── 1. Economic Constitution ──────────────────────────────────────────────

/** A constitutional rule — immutable during runtime execution. */
export interface ConstitutionalRule {
  ruleId: string;
  name: string;
  description: string;
  /** The rule evaluator. Returns { passed, violations }. */
  evaluate: (context: ConstitutionContext) => { passed: boolean; violations: string[] };
}

/** Context for constitutional evaluation. */
export interface ConstitutionContext {
  twinTokenSupply: number;
  totalReserves: number;
  fiatReserves: number;
  stablecoinReserves: number;
  reserveCoverage: number;
  lpExposure: number;
  countryExposure: Record<string, number>;
  stablecoinExposure: number;
  escrowLocked: boolean;
  recipientConfirmed: boolean;
  settlementRailSupported: boolean;
  viaTransactionCoordinator: boolean;
  viaSettlementContract: boolean;
}

/** Result of constitutional validation. */
export interface ConstitutionResult {
  passed: boolean;
  violations: string[];
  evaluatedRules: number;
}

/** Constitutional configuration (configurable but immutable during execution). */
export interface ConstitutionConfig {
  minBackingRatio: number;             // twin token backing ≥ this (default 1.0)
  minReserveCoverage: number;          // reserve coverage ≥ this (default 0.05)
  maxLPExposurePercent: number;        // LP exposure ≤ this % of total (default 20)
  maxCountryConcentrationPercent: number; // country exposure ≤ this % (default 30)
  maxStablecoinExposurePercent: number; // stablecoin ≤ this % (default 50)
  requireEscrowBeforeRelease: boolean; // escrow must be locked before release
  requireRecipientConfirmation: boolean; // recipient must confirm before release
  requireSupportedRail: boolean;      // settlement must use supported rail
  requireTransactionCoordinator: boolean; // must go through coordinator
  requireSettlementContract: boolean;  // must use settlement contract
}

export const DEFAULT_CONSTITUTION: ConstitutionConfig = {
  minBackingRatio: 1.0,
  minReserveCoverage: 0.05,
  maxLPExposurePercent: 20,
  maxCountryConcentrationPercent: 30,
  maxStablecoinExposurePercent: 50,
  requireEscrowBeforeRelease: true,
  requireRecipientConfirmation: true,
  requireSupportedRail: true,
  requireTransactionCoordinator: true,
  requireSettlementContract: true,
};

// ─── 2. Liquidity Digital Twin ─────────────────────────────────────────────

export interface CountryDigitalTwin {
  country: string;
  currency: string;
  // Current state.
  fiatReserves: number;
  stablecoinReserves: number;
  twinTokenSupply: number;
  bandwidth: number;
  activeLPs: number;
  settlementLatency: number;
  demand: number;
  fxRate: number;
  // Derived.
  reserveCoverage: number;
  stablecoinDependency: number;
  backingRatio: number;
  health: 'healthy' | 'growing' | 'constrained' | 'critical' | 'emerging';
  // Forecasts.
  forecastDemand: number;
  forecastDepletion: number;
  // Maturity level.
  maturity: ReserveMaturity;
}

export type ReserveMaturity = 'stablecoin_only' | 'hybrid' | 'mostly_fiat' | 'fully_fiat' | 'reserve_exporter';

export interface LiquidityDigitalTwin {
  countries: CountryDigitalTwin[];
  corridors: Array<{
    from: string; to: string; demand: number; supply: number;
    cost: number; latency: number; health: string;
  }>;
  totalReserves: number;
  totalBandwidth: number;
  totalTwinTokens: number;
  totalStablecoins: number;
  stablecoinDependency: number;
  generatedAt: number;
}

// ─── 3. Scenario Simulator ────────────────────────────────────────────────

export type ScenarioType =
  | 'reserve_depletion' | 'bank_outage' | 'stripe_outage' | 'mobile_money_outage'
  | 'stablecoin_depeg' | 'fx_volatility' | 'lp_failure' | 'lp_fraud'
  | 'mass_redemption' | 'demand_spike' | 'country_shutdown' | 'reserve_expansion'
  | 'bandwidth_shortage';

export interface Scenario {
  scenarioId: string;
  type: ScenarioType;
  description: string;
  affectedCountries: string[];
  parameters: Record<string, number>;
}

export interface ScenarioResult {
  scenarioId: string;
  type: ScenarioType;
  risk: 'low' | 'medium' | 'high' | 'critical';
  recoveryTime: number;       // ms
  cost: number;               // bps
  affectedReserves: string[];
  affectedLPs: string[];
  affectedCorridors: string[];
  recommendedActions: string[];
  twinSnapshot: LiquidityDigitalTwin;
  simulatedAt: number;
}

// ─── 4. Capital Allocation ────────────────────────────────────────────────

export type CapitalAction =
  | 'increase_reserve' | 'decrease_reserve' | 'open_reserve' | 'close_reserve'
  | 'purchase_stablecoin' | 'sell_stablecoin' | 'burn_twin_tokens' | 'mint_twin_tokens'
  | 'increase_lp_incentive' | 'decrease_lp_incentive' | 'recruit_lps'
  | 'invest_in_corridor' | 'move_bandwidth' | 'rebalance_inventory';

export interface CapitalAllocation {
  allocationId: string;
  action: CapitalAction;
  country: string;
  currency: string;
  amount: number;
  reason: string;
  expectedROI: number;
  expectedRisk: number;
  confidence: number;
  affectedCountries: string[];
  affectedReserves: string[];
  affectedLPs: string[];
  affectedCorridors: string[];
  approvalClass: ApprovalClass;
}

// ─── 5. Inventory Management ──────────────────────────────────────────────

export interface InventoryState {
  fiatInventory: Record<string, number>;
  stablecoinInventory: Record<string, number>;
  twinTokenSupply: Record<string, number>;
  fxInventory: Record<string, number>;
  escrowInventory: number;
  settlementInventory: number;
  liquidityInventory: number;
}

export interface InventoryRecommendation {
  asset: string;
  action: 'buy' | 'sell' | 'convert' | 'hold' | 'transfer' | 'expand' | 'reduce';
  amount: number;
  reason: string;
  targetInventory: number;
  currentInventory: number;
}

// ─── 6. Reserve Evolution ─────────────────────────────────────────────────

export interface ReserveEvolutionPlan {
  country: string;
  currentMaturity: ReserveMaturity;
  targetMaturity: ReserveMaturity;
  fiatRatio: number;
  stablecoinRatio: number;
  recommendedActions: string[];
  evolutionProgress: number; // [0, 1]
}

// ─── 7. Network Optimization ──────────────────────────────────────────────

export interface NetworkOptimization {
  totalLPs: number;
  totalBandwidth: number;
  networkDensity: number;       // LPs per corridor
  averageSettlementSuccess: number;
  averageLatency: number;
  capitalEfficiency: number;    // [0, 1]
  bandwidthDistribution: Record<string, number>; // country → bandwidth
  recommendations: string[];
}

// ─── 8. Governance Engine ─────────────────────────────────────────────────

export type ApprovalClass = 'automatic' | 'operator_approval' | 'treasury_approval' | 'governance_vote' | 'constitution_forbidden';

export interface GovernanceDecision {
  action: string;
  approvalClass: ApprovalClass;
  reason: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  autoExecutable: boolean;
}

// ─── 9. Economic Explainability ───────────────────────────────────────────

export interface EconomicExplanation {
  recommendationId: string;
  reason: string;
  alternatives: string[];
  expectedROI: number;
  expectedRisk: number;
  confidence: number;
  economicImpact: string;
  affectedCountries: string[];
  affectedReserves: string[];
  affectedLPs: string[];
  affectedCorridors: string[];
  constitutionalCompliance: ConstitutionResult;
}

// ─── 10. Economic Control Plane Report ────────────────────────────────────

export interface ControlPlaneReport {
  constitution: ConstitutionResult;
  digitalTwin: LiquidityDigitalTwin;
  capitalAllocations: CapitalAllocation[];
  inventoryRecommendations: InventoryRecommendation[];
  reserveEvolution: ReserveEvolutionPlan[];
  networkOptimization: NetworkOptimization;
  governanceQueue: GovernanceDecision[];
  explanations: EconomicExplanation[];
  generatedAt: number;
}
