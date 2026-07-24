/**
 * PaySwap Protocol — Attestation (generalized from FiatProof).
 *
 * FiatProof was too specific. Any verified assertion about the external world
 * is an Attestation. The kernel doesn't know what's being attested — it only
 * knows the evidence type, source, verification level, and confidence.
 *
 * Examples:
 *   - Bank balance attestation ("LP has 50,000 GHS")
 *   - Merchant receipt attestation ("merchant received cash")
 *   - FX quote attestation ("rate is 15.2")
 *   - Identity attestation ("this account belongs to Merchant A")
 *   - Account ownership attestation
 *   - Settlement attestation ("transfer completed")
 *   - Reserve status attestation
 *
 * Different evidence. Same primitive.
 */
import type { Evidence, EvidenceType, EvidenceSource, VerificationLevel } from '@/kernel/evidence';
import { createEvidence, computeEvidenceConfidence } from '@/kernel/evidence';

export type AttestationKind =
  | 'bank_balance'
  | 'merchant_receipt'
  | 'fx_quote'
  | 'identity'
  | 'account_ownership'
  | 'settlement_completion'
  | 'reserve_status'
  | 'lp_liquidity'
  | 'connector_status'
  | 'custom';

export interface Attestation {
  id: string;
  kind: AttestationKind;
  evidence: Evidence;           // the immutable evidence backing this attestation
  attestedValue: string;        // human-readable: "50,000 GHS available"
  attestedAmount?: number;      // numeric value if applicable
  currency?: string;
  entityId: string;             // which entity this attestation is about
  confidence: number;           // derived (computed, never stored on evidence)
}

/** Create an attestation from parameters. */
export function createAttestation(params: {
  kind: AttestationKind;
  entityId: string;
  attestedValue: string;
  attestedAmount?: number;
  currency?: string;
  evidenceType: EvidenceType;
  source: EvidenceSource;
  verificationLevel: VerificationLevel;
  reputation?: number;
  attester: string;
  ttlMs?: number;
  payload?: Record<string, unknown>;
}): Attestation {
  const evidence = createEvidence({
    type: params.evidenceType,
    source: params.source,
    verificationLevel: params.verificationLevel,
    entityId: params.entityId,
    attestedAmount: params.attestedAmount,
    currency: params.currency,
    reputation: params.reputation ?? 0.5,
    attester: params.attester,
    ttlMs: params.ttlMs,
    payload: { kind: params.kind, attestedValue: params.attestedValue, ...params.payload },
  });

  return {
    id: evidence.id,
    kind: params.kind,
    evidence,
    attestedValue: params.attestedValue,
    attestedAmount: params.attestedAmount,
    currency: params.currency,
    entityId: params.entityId,
    confidence: computeEvidenceConfidence(evidence),
  };
}

/** Recompute confidence (confidence is derived, evidence is immutable). */
export function recomputeConfidence(attestation: Attestation, entityReputation: number, now: number = Date.now()): Attestation {
  return {
    ...attestation,
    confidence: computeEvidenceConfidence(attestation.evidence, now),
  };
}

/** Human-readable labels. */
export const ATTESTATION_LABELS: Record<AttestationKind, string> = {
  bank_balance: 'Bank Balance',
  merchant_receipt: 'Merchant Receipt',
  fx_quote: 'FX Quote',
  identity: 'Identity',
  account_ownership: 'Account Ownership',
  settlement_completion: 'Settlement Completion',
  reserve_status: 'Reserve Status',
  lp_liquidity: 'LP Liquidity',
  connector_status: 'Connector Status',
  custom: 'Custom',
};
