/**
 * PaySwap Runtime — Claims Primitive.
 *
 * A Claim is a statement by an entity that it can do something. Evidence
 * supports claims. The solver reasons over claims.
 *
 *   LP claims: "I can settle 40,000 GHS."
 *   Evidence: FiatProof from Open Banking (92% confidence)
 *   Solver: reasons over the claim + evidence to decide if it's reliable
 *
 *   Claim → supported by → Evidence → validated by → Constitution
 *        → executed as → Transition
 *
 * This distinction is important: a claim is not truth, it's an assertion.
 * Evidence gives it weight. The solver decides.
 */
import { uid, round } from './support';
import type { Evidence, EvidenceCitation } from './evidence';
import { computeEvidenceConfidence } from './evidence';

export type ClaimType =
  | 'settlement_capacity'   // "I can settle X amount"
  | 'fiat_liquidity'        // "I have X fiat available"
  | 'bridge_capability'     // "I can bridge from A to B"
  | 'manual_completion'     // "I will manually complete settlement"
  | 'replacement_capacity'  // "I can replace LP X for this settlement"
  | 'evidence_of_settlement' // "I have proof that I settled"
  | 'dispute_evidence'      // "I have evidence for this dispute"
  | 'exposure_capacity';    // "I have X exposure available"

export type ClaimState =
  | 'asserted'    // LP made the claim
  | 'supported'   // evidence attached
  | 'validated'   // solver accepted
  | 'executed'    // claim was used in a transition
  | 'expired'     // claim timed out
  | 'rejected'    // solver rejected (insufficient evidence)
  | 'breached';   // claim was made but not fulfilled

export interface Claim {
  id: string;
  type: ClaimType;
  state: ClaimState;
  claimantId: string;        // entity making the claim
  claimText: string;         // human-readable: "I can settle 40,000 GHS"
  claimedAmount?: number;
  currency?: string;

  // Evidence supporting this claim
  supportingEvidence: EvidenceCitation[];
  confidence: number;        // 0..1 — aggregate confidence from evidence

  // Validation
  validatedAt: number | null;
  executedAt: number | null;
  expiredAt: number;

  // Resolution
  transitionId?: string;     // which transition executed this claim
  rejectionReason?: string;
}

/** Create a new Claim. */
export function createClaim(params: {
  type: ClaimType;
  claimantId: string;
  claimText: string;
  claimedAmount?: number;
  currency?: string;
  ttlMs?: number;
}): Claim {
  const now = Date.now();
  return {
    id: uid('claim'),
    type: params.type,
    state: 'asserted',
    claimantId: params.claimantId,
    claimText: params.claimText,
    claimedAmount: params.claimedAmount,
    currency: params.currency,
    supportingEvidence: [],
    confidence: 0,
    validatedAt: null,
    executedAt: null,
    expiredAt: now + (params.ttlMs ?? 60_000),
  };
}

/** Attach evidence to support a claim. Updates confidence. */
export function supportClaim(claim: Claim, evidence: Evidence[], now: number = Date.now()): Claim {
  const citations: EvidenceCitation[] = [];
  let totalConfidence = 0;
  let count = 0;

  for (const ev of evidence) {
    if (ev.status !== 'valid') continue;
    const conf = computeEvidenceConfidence(ev, now);
    if (conf > 0) {
      citations.push({
        evidenceId: ev.id,
        evidenceType: ev.type,
        confidence: conf,
        reliedOn: true,
      });
      totalConfidence += conf;
      count++;
    }
  }

  const avgConfidence = count > 0 ? totalConfidence / count : 0;
  return {
    ...claim,
    supportingEvidence: citations,
    confidence: round(avgConfidence, 4),
    state: 'supported',
  };
}

/** Validate a claim (solver accepts it). */
export function validateClaim(claim: Claim, minConfidence: number): Claim {
  if (claim.confidence >= minConfidence) {
    return { ...claim, state: 'validated', validatedAt: Date.now() };
  }
  return {
    ...claim,
    state: 'rejected',
    rejectionReason: `Confidence ${claim.confidence.toFixed(2)} below minimum ${minConfidence}`,
  };
}

/** Execute a claim (used in a transition). */
export function executeClaim(claim: Claim, transitionId: string): Claim {
  return { ...claim, state: 'executed', executedAt: Date.now(), transitionId };
}

/** Breach a claim (claimed but not fulfilled). */
export function breachClaim(claim: Claim, reason: string): Claim {
  return { ...claim, state: 'breached', rejectionReason: reason };
}

/**
 * Claims Store — tracks all claims in the world.
 * The solver queries claims (not raw balances) to decide routing.
 */
export class ClaimsStore {
  private claims: Map<string, Claim> = new Map();

  register(claim: Claim): Claim {
    this.claims.set(claim.id, claim);
    return claim;
  }

  get(id: string): Claim | undefined {
    return this.claims.get(id);
  }

  update(id: string, claim: Claim): void {
    this.claims.set(id, claim);
  }

  all(): Claim[] {
    return [...this.claims.values()];
  }

  validated(): Claim[] {
    return this.all().filter((c) => c.state === 'validated' || c.state === 'executed');
  }

  byClaimant(entityId: string): Claim[] {
    return this.all().filter((c) => c.claimantId === entityId);
  }

  /** Get validated settlement capacity claims for an entity. */
  settlementCapacity(entityId: string, currency: string, now: number = Date.now()): { totalCapacity: number; avgConfidence: number } {
    const claims = this.byClaimant(entityId)
      .filter((c) => c.type === 'settlement_capacity' && c.currency === currency && (c.state === 'validated' || c.state === 'executed') && c.expiredAt > now);
    if (claims.length === 0) return { totalCapacity: 0, avgConfidence: 0 };
    const total = claims.reduce((s, c) => s + (c.claimedAmount ?? 0), 0);
    const avgConf = claims.reduce((s, c) => s + c.confidence, 0) / claims.length;
    return { totalCapacity: total, avgConfidence: round(avgConf, 4) };
  }

  reset(): void {
    this.claims.clear();
  }
}

export const claimsStore = new ClaimsStore();

/** Human-readable labels. */
export const CLAIM_LABELS: Record<ClaimType, string> = {
  settlement_capacity: 'Settlement Capacity',
  fiat_liquidity: 'Fiat Liquidity',
  bridge_capability: 'Bridge Capability',
  manual_completion: 'Manual Completion',
  replacement_capacity: 'Replacement Capacity',
  evidence_of_settlement: 'Evidence of Settlement',
  dispute_evidence: 'Dispute Evidence',
  exposure_capacity: 'Exposure Capacity',
};
