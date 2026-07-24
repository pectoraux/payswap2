/**
 * PaySwap Runtime — Evidence Primitive.
 *
 * Evidence is a first-class kernel primitive, alongside Entity, Capability,
 * Command, Transition, and Event. The runtime is fundamentally making
 * decisions based on incomplete information — the blockchain side is
 * deterministic, but the fiat side is probabilistic.
 *
 * Every decision should be explainable as:
 *   "Given this evidence, the solver selected this transition."
 *
 * A Transition is not just Entity → Command → New State.
 * It's: Evidence → Constraint Solver → Execution Graph → Transitions → Events → New World.
 *
 * Evidence types:
 *   - FiatProof (bank balance confirmation, webhook, attestation)
 *   - SettlementProof (LP proved fiat was sent)
 *   - MerchantConfirmation (merchant acknowledged receipt)
 *   - DisputeEvidence (evidence in a dispute)
 *   - Attestation (third-party attestation)
 *   - Observation (runtime-observed state)
 *
 * Every Transition cites the Evidence it relied on. This makes every decision
 * auditable: "why did the solver choose LP A? Because it had a high-confidence
 * FiatProof from Open Banking."
 */
import { uid, round } from './support';

export type EvidenceType =
  | 'fiat_proof'
  | 'settlement_proof'
  | 'merchant_confirmation'
  | 'dispute_evidence'
  | 'attestation'
  | 'observation'
  | 'capability_proof'
  | 'reputation_proof';

export type EvidenceSource =
  | 'open_banking'
  | 'bank_webhook'
  | 'psp_confirmation'
  | 'recent_settlement'
  | 'merchant_acknowledgement'
  | 'lp_attestation'
  | 'manual_verification'
  | 'third_party_attestation'
  | 'on_chain_state'
  | 'protocol_observation';

export type VerificationLevel =
  | 'cryptographic'  // highest — on-chain proof
  | 'institutional'  // bank/PSP confirmation
  | 'attested'       // third-party attestation
  | 'historical'     // based on past behavior
  | 'manual'         // human-verified
  | 'none';          // no verification

export interface Evidence {
  id: string;
  type: EvidenceType;
  source: EvidenceSource;
  verificationLevel: VerificationLevel;
  entityId: string;          // which entity this evidence is about
  attestedAmount?: number;   // how much fiat/liquidity is attested
  currency?: string;
  confidence: number;        // 0..1 (computed from source + verification + freshness)
  freshness: number;         // 0..1 (1 = just issued, decays over time)
  reputation: number;        // 0..1 (reputation of the entity this evidence is about)
  jurisdiction?: string;     // regulatory jurisdiction
  issuedAt: number;
  expiresAt: number;         // TTL — evidence expires
  status: 'valid' | 'expired' | 'revoked' | 'disputed';
  evidenceHash: string;      // cryptographic hash for integrity
  attester: string;          // who issued the evidence
  payload: Record<string, unknown>; // type-specific data
}

/** Verification level weights (higher = more trustworthy). */
const VERIFICATION_WEIGHT: Record<VerificationLevel, number> = {
  cryptographic: 1.0,
  institutional: 0.9,
  attested: 0.7,
  historical: 0.6,
  manual: 0.3,
  none: 0.0,
};

/** Default TTL by evidence source (ms). */
const SOURCE_TTL: Record<EvidenceSource, number> = {
  open_banking: 60_000,
  bank_webhook: 120_000,
  psp_confirmation: 90_000,
  recent_settlement: 600_000,
  merchant_acknowledgement: 300_000,
  lp_attestation: 180_000,
  manual_verification: 900_000,
  third_party_attestation: 300_000,
  on_chain_state: Infinity,   // on-chain is permanent
  protocol_observation: 30_000,
};

/** Create a new Evidence entity. */
export function createEvidence(params: {
  type: EvidenceType;
  source: EvidenceSource;
  verificationLevel: VerificationLevel;
  entityId: string;
  attestedAmount?: number;
  currency?: string;
  reputation?: number;
  jurisdiction?: string;
  attester: string;
  ttlMs?: number;
  payload?: Record<string, unknown>;
}): Evidence {
  const now = Date.now();
  const ttl = params.ttlMs ?? SOURCE_TTL[params.source];
  return {
    id: uid('evid'),
    type: params.type,
    source: params.source,
    verificationLevel: params.verificationLevel,
    entityId: params.entityId,
    attestedAmount: params.attestedAmount,
    currency: params.currency,
    confidence: 0, // computed by computeEvidenceConfidence
    freshness: 1.0,
    reputation: params.reputation ?? 0.5,
    jurisdiction: params.jurisdiction,
    issuedAt: now,
    expiresAt: ttl === Infinity ? now + 365 * 24 * 60 * 60 * 1000 : now + ttl,
    status: 'valid',
    evidenceHash: uid('hash'),
    attester: params.attester,
    payload: params.payload ?? {},
  };
}

/**
 * Compute confidence from verification level, freshness, and reputation.
 * Confidence decays over time — evidence issued 5 minutes ago is less
 * trustworthy than evidence issued 5 seconds ago.
 */
export function computeEvidenceConfidence(evidence: Evidence, now: number = Date.now()): number {
  if (evidence.status !== 'valid') return 0;
  if (now >= evidence.expiresAt) {
    evidence.status = 'expired';
    return 0;
  }

  // Freshness: 1.0 at issue, decays linearly to 0 at expiry
  const totalTtl = evidence.expiresAt - evidence.issuedAt;
  const remaining = evidence.expiresAt - now;
  evidence.freshness = Math.max(0, remaining / totalTtl);

  // Confidence = verification × freshness × reputation
  const verificationScore = VERIFICATION_WEIGHT[evidence.verificationLevel];
  const confidence = verificationScore * evidence.freshness * (0.5 + evidence.reputation * 0.5);

  return round(Math.max(0, Math.min(1, confidence)), 4);
}

/**
 * Compute the confidence-weighted effective liquidity from evidence.
 *
 *   effectiveLiquidity = attestedAmount × confidence × freshness × reputation
 *
 * The solver prefers slightly smaller high-confidence liquidity over larger
 * low-confidence liquidity.
 */
export function effectiveLiquidityFromEvidence(
  evidence: Evidence[],
  entityId: string,
  currency: string,
  now: number = Date.now(),
): { amount: number; confidence: number; bestEvidence: Evidence | null } {
  const entityEvidence = evidence.filter(
    (e) => e.entityId === entityId && e.currency === currency && e.status === 'valid' && e.attestedAmount != null,
  );
  if (entityEvidence.length === 0) {
    return { amount: 0, confidence: 0, bestEvidence: null };
  }

  let bestConfidence = 0;
  let bestAmount = 0;
  let bestEvidence: Evidence | null = null;

  for (const ev of entityEvidence) {
    const conf = computeEvidenceConfidence(ev, now);
    if (conf > bestConfidence) {
      bestConfidence = conf;
      bestAmount = ev.attestedAmount!;
      bestEvidence = ev;
    }
  }

  // effectiveLiquidity = attestedAmount × confidence × freshness × reputation
  const fresh = bestEvidence?.freshness ?? 0;
  const rep = bestEvidence?.reputation ?? 0;
  const effective = round(bestAmount * bestConfidence * fresh * rep, 2);

  return { amount: effective, confidence: bestConfidence, bestEvidence };
}

/** Expire all evidence that has passed its TTL. */
export function expireEvidence(evidence: Evidence[], now: number = Date.now()): Evidence[] {
  return evidence.map((e) => {
    if (e.status === 'valid' && now >= e.expiresAt) {
      return { ...e, status: 'expired' as const, freshness: 0 };
    }
    return e;
  });
}

/** Revoke evidence (e.g., after a dispute or fraud). */
export function revokeEvidence(evidence: Evidence): Evidence {
  return { ...evidence, status: 'revoked' as const };
}

/** Get all valid evidence for an entity. */
export function validEvidenceFor(evidence: Evidence[], entityId: string, now: number = Date.now()): Evidence[] {
  return expireEvidence(evidence, now).filter((e) => e.entityId === entityId && e.status === 'valid');
}

/** Evidence store — the kernel's evidence registry. */
export class EvidenceStore {
  private evidence: Map<string, Evidence> = new Map();

  register(evidence: Evidence): Evidence {
    this.evidence.set(evidence.id, evidence);
    return evidence;
  }

  get(evidenceId: string): Evidence | undefined {
    return this.evidence.get(evidenceId);
  }

  all(): Evidence[] {
    return [...this.evidence.values()];
  }

  validFor(entityId: string, now: number = Date.now()): Evidence[] {
    return validEvidenceFor(this.all(), entityId, now);
  }

  confidenceFor(entityId: string, currency: string, now: number = Date.now()): { amount: number; confidence: number; bestEvidence: Evidence | null } {
    return effectiveLiquidityFromEvidence(this.all(), entityId, currency, now);
  }

  revoke(evidenceId: string): void {
    const e = this.evidence.get(evidenceId);
    if (e) this.evidence.set(evidenceId, { ...e, status: 'revoked' });
  }

  reset(): void {
    this.evidence.clear();
  }
}

export const evidenceStore = new EvidenceStore();

/**
 * EvidenceCitation — every Transition cites the evidence it relied on.
 * This makes every decision auditable: "why did the solver choose LP A?
 * Because it cited Evidence #123 (FiatProof, open_banking, 92% confidence)."
 */
export interface EvidenceCitation {
  evidenceId: string;
  evidenceType: EvidenceType;
  confidence: number;
  reliedOn: boolean; // did the solver rely on this evidence for the decision?
}
