/**
 * Digital Twin — pure simulation layer. (M-RT-11.)
 *
 * STRICTLY a simulation layer. It does NOT modify the runtime, emit events,
 * or mutate projections. It is a PURE FUNCTION:
 *
 *   (Current Runtime Snapshot, Recommendation, Configuration)
 *       ↓
 *   Simulation Result
 *
 * Five responsibilities:
 *   1. Counterfactual simulation — "what would happen if Recommendation X were implemented?"
 *   2. Prediction — estimate latency, fees, reserve utilization, liquidity, resilience
 *   3. Comparison — current network vs simulated network (explicit deltas)
 *   4. Confidence estimation — confidence score with explicit assumptions
 *   5. Explanation — return WHY the prediction changed, not just the result
 *
 * DEPENDENCY DIRECTION: reads projections + recommendations; writes nothing.
 * The Recommendation Lifecycle owns state transitions (Scored → Digital Twin → Simulated).
 *
 * DETERMINISM: identical inputs → identical outputs. No randomness.
 */

// ─── Network Snapshot (the current state, captured read-only) ───────────────

/** A point-in-time snapshot of the network — all derived metrics. */
export interface NetworkSnapshot {
  // Capability metrics:
  capabilityCount: number;
  routeCount: number;
  uniqueAssets: number;
  // Liquidity metrics:
  offerCount: number;
  totalOfferCapacity: number;
  medianFeeBps: number;
  // Reserve metrics:
  reserveCount: number;
  totalReserveAvailable: number;
  totalReserveLocked: number;
  averageUtilization: number;
  // Risk metrics:
  singleProviderRoutes: number;   // routes with only 1 LP
  criticalReserves: number;       // reserves at CRITICAL scarcity
  // Economic metrics:
  estimatedThroughputPerHour: number;
}

// ─── Prediction (what the simulated network would look like) ────────────────

/** A predicted metric in the simulated network. */
export interface PredictedMetric {
  metric: string;              // e.g. 'medianFeeBps', 'averageUtilization'
  currentValue: number;
  predictedValue: number;
  delta: number;               // predictedValue - currentValue
  deltaPercent: number;        // (delta / currentValue) * 100, or 0 if current=0
  rationale: string;           // WHY this metric changed
}

/** The comparison between current and simulated networks. */
export interface NetworkComparison {
  metrics: PredictedMetric[];
  improvements: string[];      // human-readable list of improvements
  regressions: string[];       // human-readable list of regressions
  netAssessment: 'positive' | 'neutral' | 'negative';
}

// ─── Simulation Result ──────────────────────────────────────────────────────

/** A simulation assumption. */
export interface SimulationAssumption {
  assumption: string;
  impact: string;              // how this assumption affects the prediction
}

/** The full simulation result — pure output, never stored as state. */
export interface SimulationResult {
  recommendationId: string;
  recommendationKind: string;
  recommendationTitle: string;
  // The counterfactual:
  baseline: NetworkSnapshot;       // current network
  simulated: NetworkSnapshot;      // simulated network (after applying the recommendation)
  // The comparison:
  comparison: NetworkComparison;
  // Confidence:
  confidence: number;              // 0..1
  assumptions: SimulationAssumption[];
  // Explanation:
  explanation: string;             // human-readable summary of why the prediction changed
  // Meta:
  generatedAt: number;
  success: boolean;
  error?: string;
}

// ─── Configuration ──────────────────────────────────────────────────────────

/** Configuration for the Digital Twin simulation. */
export interface TwinConfig {
  /** How much volume to assume for a new route (per hour). */
  assumedVolumePerRoute: number;
  /** How much fee reduction to assume from competition (second provider). */
  competitionFeeReductionPercent: number;
  /** How much utilization improvement from reserve replenishment. */
  replenishmentUtilizationImprovement: number;
  /** Base confidence before adjustments. */
  baseConfidence: number;
}

export const DEFAULT_TWIN_CONFIG: TwinConfig = {
  assumedVolumePerRoute: 5000,
  competitionFeeReductionPercent: 15,
  replenishmentUtilizationImprovement: 0.3,
  baseConfidence: 0.7,
};

// ─── The recommendation input (from M-RT-9 Opportunity Discovery) ──────────

/** A recommendation to simulate (subset of OpportunityRecommendation). */
export interface SimulatableRecommendation {
  id: string;
  kind: string;
  title: string;
  description: string;
  confidence: number;
  expectedValue: { dimension: string; delta: string }[];
  graphDiff: {
    addNodes: { id: string; type: string; label: string }[];
    addEdges: { from: string; to: string; relationship: string }[];
    description: string;
  };
}
