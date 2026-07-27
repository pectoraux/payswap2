/**
 * Opportunity Discovery + Recommendations. (Amendment 1 §7B, expanded Amendment 2.)
 *
 * Continuously searches for ways to make the network cheaper, faster, more
 * resilient. Produces Recommendations — first-class, versioned, explainable,
 * actionable **protocol objects** (not notifications). (Amendment 2) expands
 * to 12 kinds + enriches the Recommendation object into a tracked, measured
 * artifact with affected entities + implementation complexity + lifecycle.
 *
 * M-RT-1 ships types + a no-op interface. M-RT-6 implements the real
 * discoverer (operates on the Liquidity Graph + Liquidity Intelligence
 * findings + Runtime Memory).
 */

import type { EvidenceCitation } from '../../types';

export type RecommendationAudience =
  | 'merchant'
  | 'lp'
  | 'treasury'
  | 'ops'
  | 'compliance'
  | 'developer';

/**
 * The 12 opportunity kinds (Amendment 2).
 */
export type RecommendationKind =
  // Amendment 1 kinds (preserved):
  | 'missing_corridor'
  | 'lp_opportunity'
  | 'treasury_opportunity'
  | 'connector_gap'
  // Amendment 2 expanded kinds:
  | 'missing_bridge'              // liquidity link absent → extra settlement hops
  | 'missing_lp_capability'       // LP could add a corridor/rail
  | 'missing_reserve'             // corridor has no backing reserve
  | 'unused_reserve'              // reserve >80% idle
  | 'expensive_corridor'          // avg cost above market
  | 'lp_underpricing'             // fees below market-clearing price
  | 'lp_overpricing'              // fees above market, losing share
  | 'unbalanced_corridor'         // 10× volume asymmetry
  | 'missing_fx_pair'             // traffic hops through an extra FX leg
  | 'unused_connector'            // 0% eligible volume
  | 'slow_connector'              // p99 2× corridor median
  | 'unnecessary_settlement_hop'; // 3 hops where 2 suffice

/**
 * Recommendation lifecycle (Amendment 2: added 'implemented' + 'expired').
 */
export type RecommendationStatus =
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'implemented'
  | 'expired';

export interface RecommendationImpact {
  dimension: string;   // 'cost' | 'speed' | 'volume' | 'revenue' | 'throughput'
  delta: string;       // '-35%' | '+43% volume' | '+$84k/month'
}

/** A measured outcome (filled after a recommendation is implemented). */
export interface ImpactMeasurement {
  recommendationId: string;
  actualVolumeDelta: number;
  actualRevenueDelta: number;
  actualCostDeltaBps: number;
  measuredAt: number;
}

/**
 * A first-class runtime protocol object (Amendment 2: enriched).
 * Tracked across its lifecycle + measured post-implementation.
 */
export interface Recommendation {
  id: string;
  version: number;
  type: RecommendationKind;
  audience: RecommendationAudience;
  title: string;
  description: string;
  subject: string;
  // Quantified estimates:
  estimatedImpact: RecommendationImpact[];
  estimatedRevenue?: number;
  estimatedVolume?: number;
  confidence: number;       // 0..1
  // Affected entities (route to the right advisor):
  affectedLP?: string;
  affectedTreasury?: string;
  affectedCorridor?: string;
  affectedReserve?: string;
  // Actionability:
  requiredAction: string;
  capitalRequired?: number;
  implementationComplexity?: 'low' | 'medium' | 'high';
  // Evidence + lifecycle:
  evidence: EvidenceCitation[];
  status: RecommendationStatus;
  createdAt: number;
  decidedAt?: number;
  implementedAt?: number;
  measuredImpact?: ImpactMeasurement;
}

/** The Opportunity Discovery engine contract. */
export interface OpportunityDiscoveryEngine {
  /** Discover all current opportunities. */
  discover(): Promise<Recommendation[]>;
  /** Recommendations for a specific subject. */
  bySubject(subjectId: string): Promise<Recommendation[]>;
  /** Recommendations for a specific audience. */
  byAudience(audience: RecommendationAudience): Promise<Recommendation[]>;
  /** Track a recommendation's lifecycle. */
  setStatus(id: string, status: RecommendationStatus): void;
  /** (Amendment 2) Measure post-implementation impact. */
  measureImpact(id: string): Promise<ImpactMeasurement | null>;
}

/**
 * NoOpOpportunityDiscoveryEngine — the M-RT-1 placeholder. Returns no
 * recommendations. M-RT-6 replaces this with the real discoverer.
 */
export class NoOpOpportunityDiscoveryEngine implements OpportunityDiscoveryEngine {
  async discover(): Promise<Recommendation[]> { return []; }
  async bySubject(): Promise<Recommendation[]> { return []; }
  async byAudience(): Promise<Recommendation[]> { return []; }
  setStatus(): void { /* no-op */ }
  async measureImpact(): Promise<ImpactMeasurement | null> { return null; }
}
