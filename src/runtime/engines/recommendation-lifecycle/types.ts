/**
 * Recommendation Lifecycle. (Final Amendment §7O.)
 *
 * Recommendations are protocol objects with a 9-stage lifecycle. The Runtime
 * learns which recommendation types create real value (the "learned" stage
 * feeds Runtime Memory).
 *
 *   Detected → Scored → Simulated → Recommended → Accepted →
 *   Implemented → Observed → Measured → Learning stored
 *
 * M-RT-1 ships types + an in-memory lifecycle tracker. M-RT-6+ wires the
 * real transitions.
 */

import type { EvidenceCitation } from '../../types';

export type RecommendationLifecycleStage =
  | 'detected'    // Opportunity Discovery found it
  | 'scored'      // Economic Score + confidence assigned
  | 'simulated'   // Counterfactual run
  | 'recommended' // Presented to the audience
  | 'accepted'    // Actor accepted
  | 'implemented' // Action taken
  | 'observed'    // Post-implementation observation window
  | 'measured'    // ImpactMeasurement recorded
  | 'learned';    // Learning stored in Runtime Memory

export interface RecommendationLifecycleEvent {
  recommendationId: string;
  stage: RecommendationLifecycleStage;
  ts: number;
  evidence: EvidenceCitation[];
  note?: string;
}

export interface RecommendationLifecycle {
  /** Transition a recommendation to a new stage (with optional evidence). */
  transition(id: string, to: RecommendationLifecycleStage, evidence?: EvidenceCitation[], note?: string): void;
  /** Full lifecycle history for a recommendation. */
  history(id: string): RecommendationLifecycleEvent[];
  /** Current stage of a recommendation. */
  current(id: string): RecommendationLifecycleStage | undefined;
}

/** In-memory Recommendation Lifecycle tracker (M-RT-1). */
export class InMemoryRecommendationLifecycle implements RecommendationLifecycle {
  private events: RecommendationLifecycleEvent[] = [];

  transition(id: string, to: RecommendationLifecycleStage, evidence: EvidenceCitation[] = [], note?: string): void {
    this.events.push({ recommendationId: id, stage: to, ts: Date.now(), evidence, note });
  }

  history(id: string): RecommendationLifecycleEvent[] {
    return this.events.filter((e) => e.recommendationId === id);
  }

  current(id: string): RecommendationLifecycleStage | undefined {
    const events = this.history(id);
    return events.length > 0 ? events[events.length - 1].stage : undefined;
  }
}
