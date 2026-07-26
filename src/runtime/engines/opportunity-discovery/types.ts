/**
 * Opportunity Discovery + Recommendations. (Amendment 1 §7B + §12.)
 *
 * Continuously searches for ways to make the network cheaper, faster, more
 * resilient. Produces Recommendations — first-class, versioned, explainable,
 * actionable runtime objects advising merchants / LPs / treasury / ops /
 * compliance / developers.
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

export type RecommendationKind =
  | 'missing_corridor'
  | 'lp_opportunity'
  | 'treasury_opportunity'
  | 'connector_gap';

export type RecommendationStatus =
  | 'proposed'
  | 'accepted'
  | 'declined'
  | 'superseded';

export interface RecommendationImpact {
  dimension: string;   // 'cost' | 'speed' | 'volume' | 'revenue' | 'throughput'
  delta: string;       // '-35%' | '+43% volume' | '+$84k/month'
}

/**
 * A first-class runtime object advising an actor to act. Versioned, so the
 * network's improvement history is auditable.
 */
export interface Recommendation {
  id: string;
  version: number;
  audience: RecommendationAudience;
  subject: string;
  kind: RecommendationKind;
  title: string;
  rationale: string;
  expectedImpact: RecommendationImpact[];
  requiredAction: string;
  capitalRequired?: number;
  evidence: EvidenceCitation[];
  confidence: number;
  status: RecommendationStatus;
  createdAt: number;
}

/** The Opportunity Discovery engine contract. */
export interface OpportunityDiscoveryEngine {
  /** Discover all current opportunities. */
  discover(): Promise<Recommendation[]>;
  /** Recommendations for a specific subject. */
  bySubject(subjectId: string): Promise<Recommendation[]>;
  /** Recommendations for a specific audience. */
  byAudience(audience: RecommendationAudience): Promise<Recommendation[]>;
  /** Track a recommendation's lifecycle (accept / decline / supersede). */
  setStatus(id: string, status: RecommendationStatus): void;
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
}
