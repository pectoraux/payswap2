/**
 * Global Economic Directorate — Types. (M-ECO-36.)
 *
 * The Directorate is a network director — not a runtime component.
 * It coordinates specialized autonomous directors that propose strategic
 * actions. None execute directly. Everything goes through:
 *
 *   Economic Constitution → Digital Twin → Economic Ledger
 *   → Transaction Coordinator → Runtime
 *
 * The Directorate thinks in decades, not transactions:
 *   "Should Ghana become a reserve country?"
 *   "Should stablecoins disappear from West Africa over 18 months?"
 *   "Should we recruit 20 LPs in Kenya?"
 */

import type { LiquidityDigitalTwin, CountryDigitalTwin, ReserveMaturity } from '../control-plane/types';

// ─── Strategic Recommendations ─────────────────────────────────────────────

export type StrategicAction =
  | 'open_reserve' | 'close_reserve' | 'increase_reserve' | 'decrease_reserve'
  | 'replace_stablecoins' | 'increase_stablecoins' | 'reduce_stablecoins'
  | 'recruit_lps' | 'retire_lps' | 'increase_lp_incentive' | 'decrease_lp_incentive'
  | 'open_corridor' | 'close_corridor' | 'adjust_corridor_pricing'
  | 'adjust_fx_inventory' | 'hedge_fx_exposure'
  | 'switch_settlement_rail' | 'optimize_settlement_latency'
  | 'expand_to_country' | 'launch_country'
  | 'adjust_bandwidth_pricing' | 'rebalance_network';

export type TimeHorizon = 'immediate' | 'short_term' | 'medium_term' | 'long_term' | 'strategic';

export interface StrategicRecommendation {
  recommendationId: string;
  director: DirectorType;
  action: StrategicAction;
  description: string;
  targetCountries: string[];
  targetCorridors: Array<{ from: string; to: string }>;
  amount?: number;
  currency?: string;
  timeHorizon: TimeHorizon;
  expectedROI: number;
  expectedRisk: number;
  confidence: number;
  rationale: string;
  alternatives: string[];
  affectedEntities: AffectedEntities;
  approvalClass: 'automatic' | 'operator' | 'treasury' | 'governance' | 'constitution_forbidden';
}

export type DirectorType =
  | 'treasury' | 'corridor' | 'lp' | 'fx' | 'settlement' | 'country' | 'global_planner';

export interface AffectedEntities {
  countries: string[];
  reserves: string[];
  lpIds: string[];
  corridors: Array<{ from: string; to: string }>;
}

// ─── Director Reports ──────────────────────────────────────────────────────

export interface DirectorReport {
  director: DirectorType;
  recommendations: StrategicRecommendation[];
  healthScore: number;        // [0, 1]
  activeStrategies: number;
  lastUpdated: number;
}

// ─── Global Plan ───────────────────────────────────────────────────────────

export interface GlobalPlan {
  planId: string;
  generatedAt: number;
  timeHorizon: TimeHorizon;
  recommendations: StrategicRecommendation[];
  globalHealthScore: number;
  expectedNetworkROI: number;
  expectedNetworkRisk: number;
  capitalReallocation: CapitalReallocation[];
  expansionPlans: ExpansionPlan[];
}

export interface CapitalReallocation {
  fromCountry: string;
  toCountry: string;
  amount: number;
  currency: string;
  reason: string;
}

export interface ExpansionPlan {
  country: string;
  expectedDemand: number;
  expectedReserve: number;
  expectedLPCount: number;
  expectedProfitability: number;
  recommendedLaunchDate: number;
  readiness: 'ready' | 'preparing' | 'not_ready';
}

// ─── Strategic Simulation ──────────────────────────────────────────────────

export interface StrategicSimulation {
  simulationId: string;
  scenario: string;
  yearsProjected: number;
  startingState: LiquidityDigitalTwin;
  projectedState: LiquidityDigitalTwin;
  projectedROI: number;
  projectedRisk: number;
  projectedTwinTokenGrowth: number;
  projectedStablecoinReduction: number;
  projectedReserveGrowth: number;
  yearByYear: YearProjection[];
  recommendation: string;
  confidence: number;
  simulatedAt: number;
}

export interface YearProjection {
  year: number;
  projectedReserves: number;
  projectedTwinTokens: number;
  projectedStablecoins: number;
  projectedBandwidth: number;
  projectedLPs: number;
  projectedProfit: number;
}

// ─── Economic Memory ───────────────────────────────────────────────────────

export interface EconomicMemoryEntry {
  memoryId: string;
  timestamp: number;
  action: StrategicAction;
  country: string;
  description: string;
  outcome: 'success' | 'partial' | 'failure' | 'pending';
  actualROI?: number;
  actualRisk?: number;
  lessonsLearned: string[];
  applicableTo: string[];  // countries/corridors this lesson applies to
}

// ─── Directorate Report ────────────────────────────────────────────────────

export interface DirectorateReport {
  directors: DirectorReport[];
  globalPlan: GlobalPlan;
  strategicSimulations: StrategicSimulation[];
  economicMemory: EconomicMemoryEntry[];
  globalHealthScore: number;
  networkStatus: 'optimal' | 'healthy' | 'constrained' | 'critical' | 'expanding';
  generatedAt: number;
}
