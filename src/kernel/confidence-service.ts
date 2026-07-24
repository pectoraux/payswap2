/**
 * PaySwap Runtime — Confidence Service.
 *
 * Hides Evidence behind a confidence interface. The Planner consumes confidence
 * (a number 0..1), not evidence sources. This makes replacing evidence sources
 * trivial — Open Banking, PSP, KYC, AI fraud scores, manual review — the
 * planner doesn't care where confidence comes from.
 *
 *   Planner → Confidence Service → Evidence Store
 *
 * The Confidence Service:
 *   - aggregates evidence for an entity
 *   - applies confidence decay (freshness)
 *   - factors in connector health
 *   - factors in reputation (event projection)
 *   - returns a single confidence number
 */
import type { Evidence } from './evidence';
import { computeEvidenceConfidence } from './evidence';
import { ReputationProjection } from './confidence-engine';
import { round } from './support';

export interface ConfidenceQuery {
  entityId: string;
  currency?: string;
  amount?: number;
  now?: number;
}

export interface ConfidenceResult {
  confidence: number;           // 0..1
  effectiveCapacity: number;    // attestedAmount × confidence
  evidenceCount: number;
  bestSource: string | null;
  explanation: string;
}

export class ConfidenceService {
  private evidence: Evidence[] = [];
  private events: { type: string; payload: Record<string, unknown>; ts: number; entityId?: string }[] = [];
  private connectorHealth: Map<string, number> = new Map(); // source → health 0..1

  /** Register evidence (from the evidence store). */
  registerEvidence(evidence: Evidence[]): void {
    this.evidence = evidence;
  }

  /** Register events (for reputation projection). */
  registerEvents(events: { type: string; payload: Record<string, unknown>; ts: number; entityId?: string }[]): void {
    this.events = events;
  }

  /** Set connector health (e.g., Open Banking is 34% healthy). */
  setConnectorHealth(source: string, health: number): void {
    this.connectorHealth.set(source, round(health, 4));
  }

  /** Get confidence for an entity's capacity. */
  getConfidence(query: ConfidenceQuery): ConfidenceResult {
    const { entityId, currency, amount, now = Date.now() } = query;

    // Filter valid evidence for this entity
    const relevant = this.evidence.filter(
      (e) => e.entityId === entityId &&
             (!currency || e.currency === currency) &&
             e.status === 'valid' &&
             e.attestedAmount != null,
    );

    if (relevant.length === 0) {
      return { confidence: 0, effectiveCapacity: 0, evidenceCount: 0, bestSource: null, explanation: 'No valid evidence' };
    }

    // Compute confidence for each evidence item, factoring in connector health
    let bestConfidence = 0;
    let bestAmount = 0;
    let bestSource: string | null = null;

    // Get entity reputation from event projection
    const entityEvents = this.events.filter((e) => e.entityId === entityId || e.payload.entityId === entityId);
    const reputation = ReputationProjection.projectLP(entityEvents);

    for (const ev of relevant) {
      const baseConfidence = computeEvidenceConfidence(ev, now);
      const connectorHealth = this.connectorHealth.get(ev.source) ?? 1.0;
      const adjustedConfidence = baseConfidence * connectorHealth;

      if (adjustedConfidence > bestConfidence) {
        bestConfidence = adjustedConfidence;
        bestAmount = ev.attestedAmount!;
        bestSource = ev.source;
      }
    }

    // Effective capacity = attestedAmount × confidence × reputation
    const effectiveCapacity = round(bestAmount * bestConfidence * (0.5 + reputation * 0.5), 2);

    return {
      confidence: round(bestConfidence, 4),
      effectiveCapacity,
      evidenceCount: relevant.length,
      bestSource,
      explanation: `${bestSource} (${bestConfidence.toFixed(2)} confidence, ${relevant.length} evidence, rep ${reputation.toFixed(2)}, connector ${(this.connectorHealth.get(bestSource ?? '') ?? 1).toFixed(2)})`,
    };
  }

  /** Batch confidence for multiple entities. */
  getBatchConfidence(queries: ConfidenceQuery[]): Map<string, ConfidenceResult> {
    const results = new Map<string, ConfidenceResult>();
    for (const q of queries) {
      results.set(q.entityId, this.getConfidence(q));
    }
    return results;
  }

  reset(): void {
    this.evidence = [];
    this.events = [];
    this.connectorHealth.clear();
  }
}

export const confidenceService = new ConfidenceService();
