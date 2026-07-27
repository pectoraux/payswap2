/**
 * Recommendations — first-class runtime objects. (Amendment 1 §12.)
 *
 * Recommendations are produced by Opportunity Discovery and stored here so
 * they are queryable, versioned, and tracked across their lifecycle
 * (proposed → accepted/declined/superseded). Every actor role can query its
 * own recommendations.
 */

import type { Recommendation, RecommendationAudience, RecommendationStatus } from '../engines/opportunity-discovery/types';

/** A queryable store of Recommendations. */
export interface RecommendationStore {
  add(rec: Recommendation): void;
  get(id: string): Recommendation | undefined;
  all(): Recommendation[];
  byAudience(audience: RecommendationAudience): Recommendation[];
  bySubject(subjectId: string): Recommendation[];
  setStatus(id: string, status: RecommendationStatus): void;
}

/** In-memory Recommendation store (M-RT-1). */
export class InMemoryRecommendationStore implements RecommendationStore {
  private byId: Map<string, Recommendation> = new Map();

  add(rec: Recommendation): void {
    this.byId.set(rec.id, rec);
  }

  get(id: string): Recommendation | undefined {
    return this.byId.get(id);
  }

  all(): Recommendation[] {
    return [...this.byId.values()];
  }

  byAudience(audience: RecommendationAudience): Recommendation[] {
    return this.all().filter((r) => r.audience === audience);
  }

  bySubject(subjectId: string): Recommendation[] {
    return this.all().filter((r) => r.subject === subjectId);
  }

  setStatus(id: string, status: RecommendationStatus): void {
    const rec = this.byId.get(id);
    if (rec) this.byId.set(id, { ...rec, status });
  }
}
