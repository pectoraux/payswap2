/**
 * PaySwap Runtime — Confidence Engine.
 *
 * Evidence is immutable historical truth. Confidence is current belief —
 * it changes over time. This separation is critical:
 *
 *   Evidence: { source, timestamp, signature, provenance } → never changes
 *   Confidence: computed by this engine → always derived
 *
 * The ConfidenceEngine computes confidence from:
 *   - verification level (cryptographic > institutional > manual)
 *   - freshness (decays over time)
 *   - reputation of the entity (fold of historical events)
 *   - source reliability
 *
 * This means confidence is always reproducible — given the same evidence
 * and the same event history, the confidence is always the same.
 */
import type { Evidence, VerificationLevel, EvidenceSource } from './evidence';
import { round } from './support';

/** Verification level weights (higher = more trustworthy). */
const VERIFICATION_WEIGHT: Record<VerificationLevel, number> = {
  cryptographic: 1.0,
  institutional: 0.9,
  attested: 0.7,
  historical: 0.6,
  manual: 0.3,
  none: 0.0,
};

/** Source reliability weights (based on historical data). */
const SOURCE_RELIABILITY: Record<EvidenceSource, number> = {
  open_banking: 0.95,
  bank_webhook: 0.90,
  psp_confirmation: 0.88,
  third_party_attestation: 0.80,
  merchant_acknowledgement: 0.75,
  recent_settlement: 0.70,
  lp_attestation: 0.55,
  manual_verification: 0.40,
  on_chain_state: 1.0,    // on-chain is deterministic truth
  protocol_observation: 0.85,
};

export interface ConfidenceInput {
  evidence: Evidence;
  entityReputation: number;  // 0..1 (fold of historical events)
  now?: number;
}

export interface ConfidenceResult {
  confidence: number;        // 0..1
  verificationScore: number;
  freshnessScore: number;
  reputationScore: number;
  sourceReliability: number;
  explanation: string;
}

/**
 * Compute confidence from immutable evidence + current state.
 * Confidence is NEVER stored — always derived.
 */
export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const { evidence, entityReputation, now = Date.now() } = input;

  // If evidence is expired/revoked, confidence is 0
  if (evidence.status !== 'valid' || now >= evidence.expiresAt) {
    return {
      confidence: 0,
      verificationScore: 0,
      freshnessScore: 0,
      reputationScore: 0,
      sourceReliability: 0,
      explanation: 'Evidence expired or revoked',
    };
  }

  // Verification score (from evidence's verification level — immutable)
  const verificationScore = VERIFICATION_WEIGHT[evidence.verificationLevel];

  // Freshness score (decays linearly from 1.0 to 0 over TTL)
  const totalTtl = evidence.expiresAt - evidence.issuedAt;
  const remaining = evidence.expiresAt - now;
  const freshnessScore = Math.max(0, remaining / totalTtl);

  // Source reliability (from source type — deterministic)
  const sourceReliability = SOURCE_RELIABILITY[evidence.source];

  // Reputation score (from entity's event history — derived, not stored)
  const reputationScore = 0.5 + entityReputation * 0.5; // 0.5..1.0

  // Aggregate confidence
  const confidence = round(
    verificationScore * freshnessScore * sourceReliability * reputationScore,
    4,
  );

  const explanation = `${evidence.source} (${evidence.verificationLevel}): ` +
    `verification ${verificationScore.toFixed(2)} × freshness ${freshnessScore.toFixed(2)} × ` +
    `reliability ${sourceReliability.toFixed(2)} × reputation ${reputationScore.toFixed(2)} = ${confidence.toFixed(4)}`;

  return {
    confidence: Math.max(0, Math.min(1, confidence)),
    verificationScore,
    freshnessScore,
    reputationScore,
    sourceReliability,
    explanation,
  };
}

/**
 * Compute aggregate confidence from multiple evidence items.
 * Used when a claim is supported by multiple pieces of evidence.
 */
export function aggregateConfidence(
  evidenceItems: Evidence[],
  entityReputation: number,
  now: number = Date.now(),
): { confidence: number; evidenceCount: number; bestConfidence: number; explanation: string } {
  if (evidenceItems.length === 0) {
    return { confidence: 0, evidenceCount: 0, bestConfidence: 0, explanation: 'No evidence' };
  }

  const results = evidenceItems.map((e) => computeConfidence({ evidence: e, entityReputation, now }));
  const confidences = results.map((r) => r.confidence);
  const bestConfidence = Math.max(...confidences);
  const avgConfidence = confidences.reduce((s, c) => s + c, 0) / confidences.length;

  // Aggregate: weighted toward best evidence, but boosted by corroboration
  const corroborationBoost = evidenceItems.length > 1 ? 0.05 * (evidenceItems.length - 1) : 0;
  const aggregate = Math.min(1, bestConfidence * 0.7 + avgConfidence * 0.3 + corroborationBoost);

  return {
    confidence: round(aggregate, 4),
    evidenceCount: evidenceItems.length,
    bestConfidence: round(bestConfidence, 4),
    explanation: `${evidenceItems.length} evidence item(s), best ${bestConfidence.toFixed(2)}, avg ${avgConfidence.toFixed(2)}, boost +${corroborationBoost.toFixed(2)}`,
  };
}

/**
 * Reputation Projection — computes reputation as fold(events).
 * Reputation is never stored — always derived from the event history.
 */
export class ReputationProjection {
  /**
   * Compute LP reputation from event history.
   * fold(events) → reputation score (0..1)
   */
  static projectLP(events: { type: string; payload: Record<string, unknown>; ts: number }[]): number {
    if (events.length === 0) return 0.5; // neutral for new LPs

    let successCount = 0;
    let failCount = 0;
    let disputeLossCount = 0;
    let latencySum = 0;
    let latencyCount = 0;

    for (const evt of events) {
      switch (evt.type) {
        case 'bridge.drawn':
        case 'reserve.debited':
        case 'settlement.completed':
          successCount++;
          if (evt.payload.latencyMs) {
            latencySum += evt.payload.latencyMs as number;
            latencyCount++;
          }
          break;
        case 'settlement.failed':
        case 'bridge.failed':
          failCount++;
          break;
        case 'dispute.resolved':
          if (evt.payload.outcome === 'merchant_wins' || evt.payload.outcome === 'collateral_slash') {
            disputeLossCount++;
          }
          break;
      }
    }

    const total = successCount + failCount + disputeLossCount;
    if (total === 0) return 0.5;

    const successRate = successCount / total;
    const disputePenalty = disputeLossCount * 0.1;
    const avgLatencyScore = latencyCount > 0 ? Math.max(0, 1 - (latencySum / latencyCount) / 120000) : 0.8;

    const reputation = round(
      successRate * 0.5 + avgLatencyScore * 0.3 + (1 - disputePenalty) * 0.2,
      4,
    );

    return Math.max(0, Math.min(1, reputation));
  }

  /**
   * Compute merchant reputation from event history.
   */
  static projectMerchant(events: { type: string; payload: Record<string, unknown>; ts: number }[]): number {
    if (events.length === 0) return 0.5;

    let confirmationCount = 0;
    let disputeWinCount = 0;
    let disputeLossCount = 0;
    let fraudFlagCount = 0;

    for (const evt of events) {
      switch (evt.type) {
        case 'merchant.confirmed':
          confirmationCount++;
          break;
        case 'dispute.resolved':
          if (evt.payload.outcome === 'merchant_wins') disputeWinCount++;
          if (evt.payload.outcome === 'lp_wins') disputeLossCount++;
          break;
        case 'merchant.fraud_flagged':
          fraudFlagCount++;
          break;
      }
    }

    const total = confirmationCount + disputeWinCount + disputeLossCount + fraudFlagCount;
    if (total === 0) return 0.5;

    const confirmationRate = confirmationCount / total;
    const fraudPenalty = fraudFlagCount * 0.15;

    return Math.max(0, Math.min(1, round(confirmationRate * 0.6 + (disputeWinCount / Math.max(1, disputeWinCount + disputeLossCount)) * 0.3 - fraudPenalty + 0.1, 4)));
  }
}
