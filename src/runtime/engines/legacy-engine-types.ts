/**
 * Legacy v1 engine type definitions.
 *
 * These types were originally defined inside the v1 engine dirs
 * (`engines/opportunity-discovery/`, `engines/reserve-market/`,
 * `engines/recommendation-lifecycle/`). The v1 *implementations*
 * (NoOpOpportunityDiscoveryEngine, InMemoryReserveMarket,
 * InMemoryRecommendationLifecycle) were deleted in P5-2 — they were
 * superseded by the v2 engines and were never called at runtime.
 *
 * The v1 *type definitions* are preserved here because they remain part
 * of the public Runtime interface contract (e.g. `CompilerContext`'s
 * `reserveMarket: ReserveMarket` field, `RuntimeMemoryLike`'s
 * recommendation fields, and the `Runtime` interface's legacy
 * `recommendationLifecycle` field). They are structurally distinct from
 * the v2 types (which use different names: `OpportunityRecommendation`
 * vs `Recommendation`, `ReserveMarketEngine` vs `ReserveMarket`,
 * `RecommendationLifecycleService` vs `RecommendationLifecycle`).
 *
 * Migration path: callers should gradually move to the v2 types. This
 * file is the bridge that lets them do so incrementally without breaking
 * the build.
 */

import type { Environment } from '../types';
import type { EvidenceCitation } from '../types';

// ─── Opportunity Discovery (v1) ─────────────────────────────────────────────

export type RecommendationAudience =
  | 'merchant'
  | 'lp'
  | 'treasury'
  | 'ops'
  | 'compliance'
  | 'developer';

export type RecommendationKind =
  // Amendment 1 kinds (preserved):
  | 'missing_corridor'
  | 'lp_opportunity'
  | 'treasury_opportunity'
  | 'connector_gap'
  // Amendment 2 expanded kinds:
  | 'missing_bridge'
  | 'missing_lp_capability'
  | 'missing_reserve'
  | 'unused_reserve'
  | 'expensive_corridor'
  | 'lp_underpricing'
  | 'lp_overpricing'
  | 'unbalanced_corridor'
  | 'missing_fx_pair'
  | 'unused_connector'
  | 'slow_connector'
  | 'unnecessary_settlement_hop';

export type RecommendationStatus =
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'implemented'
  | 'expired';

export interface RecommendationImpact {
  dimension: string;
  delta: string;
}

export interface ImpactMeasurement {
  recommendationId: string;
  actualVolumeDelta: number;
  actualRevenueDelta: number;
  actualCostDeltaBps: number;
  measuredAt: number;
}

export interface Recommendation {
  id: string;
  version: number;
  type: RecommendationKind;
  audience: RecommendationAudience;
  title: string;
  description: string;
  subject: string;
  estimatedImpact: RecommendationImpact[];
  estimatedRevenue?: number;
  estimatedVolume?: number;
  confidence: number;
  affectedLP?: string;
  affectedTreasury?: string;
  affectedCorridor?: string;
  affectedReserve?: string;
  requiredAction: string;
  capitalRequired?: number;
  implementationComplexity?: 'low' | 'medium' | 'high';
  evidence: EvidenceCitation[];
  status: RecommendationStatus;
  createdAt: number;
  decidedAt?: number;
  implementedAt?: number;
  measuredImpact?: ImpactMeasurement;
}

/** The Opportunity Discovery engine contract (v1 — superseded by v2). */
export interface OpportunityDiscoveryEngine {
  discover(): Promise<Recommendation[]>;
  bySubject(subjectId: string): Promise<Recommendation[]>;
  byAudience(audience: RecommendationAudience): Promise<Recommendation[]>;
  setStatus(id: string, status: RecommendationStatus): void;
  measureImpact(id: string): Promise<ImpactMeasurement | null>;
}

// ─── Reserve Market (v1) ─────────────────────────────────────────────────────

export interface ReserveMarketState {
  reserveId: string;
  currency: string;
  environment: Environment;
  available: number;
  locked: number;
  /** 0..1 — locked / (available + locked). */
  utilization: number;
  forecastDepletionMs?: number;
  refillRate: number;
  capitalCostBps: number;
  risk: number;
  confidence: number;
  /** The optimization signal — opportunity cost of one more unit, in bps. */
  shadowPriceBps: number;
  ts: number;
}

/** The reserve market — queryable surface for the published states (v1). */
export interface ReserveMarket {
  state(reserveId: string): ReserveMarketState | undefined;
  states(environment?: Environment): ReserveMarketState[];
  shadowPrice(reserveId: string): number | undefined;
  publish(state: ReserveMarketState): void;
}

// ─── Recommendation Lifecycle (v1) ──────────────────────────────────────────

export type RecommendationLifecycleStage =
  | 'detected'
  | 'scored'
  | 'simulated'
  | 'recommended'
  | 'accepted'
  | 'implemented'
  | 'observed'
  | 'measured'
  | 'learned';

export interface RecommendationLifecycleEvent {
  recommendationId: string;
  stage: RecommendationLifecycleStage;
  ts: number;
  evidence: EvidenceCitation[];
  note?: string;
}

export interface RecommendationLifecycle {
  transition(
    id: string,
    to: RecommendationLifecycleStage,
    evidence?: EvidenceCitation[],
    note?: string,
  ): void;
  history(id: string): RecommendationLifecycleEvent[];
  current(id: string): RecommendationLifecycleStage | undefined;
}
