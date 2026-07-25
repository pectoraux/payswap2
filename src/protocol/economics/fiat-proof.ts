/**
 * PaySwap Protocol — FiatProof Entity.
 *
 * PaySwap cannot custody or continuously verify fiat in LP bank accounts.
 * Every routing decision must be based on EVIDENCE, not assumptions.
 *
 * A FiatProof represents:
 *   - Open Banking balance confirmation
 *   - Recent successful settlement history
 *   - Bank webhook confirmation
 *   - Manual proof with expiration
 *   - Third-party attestation
 *   - Time decay of confidence
 *
 * The solver doesn't ask "Does LP A have GHS 50,000?"
 * It asks "What is the confidence that LP A can complete GHS 50,000 right now?"
 */
import { uid, round } from '@/kernel/support';

export type ProofType =
  | 'open_banking_balance'
  | 'recent_settlement'
  | 'bank_webhook'
  | 'manual_proof'
  | 'third_party_attestation'
  | 'lp_attestation';

export type ProofStatus = 'valid' | 'expired' | 'revoked' | 'disputed';

export interface FiatProof {
  id: string;
  lpId: string;
  proofType: ProofType;
  currency: string;
  attestedAmount: number;
  confidence: number;          // 0..1 (computed from proof quality + recency)
  proofQuality: number;        // 0..1 (open_banking=1.0, manual=0.3)
  bankConnectivity: number;    // 0..1 (is the bank API healthy?)
  manualConfirmation: boolean; // was a human confirmation involved?
  expectedAvailability: number; // 0..1 (probability the fiat is actually there)
  issuedAt: number;
  expiresAt: number;           // TTL — proofs expire
  status: ProofStatus;
  evidenceHash: string;        // cryptographic hash of the proof
  attester: string;            // who issued the proof
}

/** Proof quality by type (higher = more trustworthy). */
const PROOF_QUALITY: Record<ProofType, number> = {
  open_banking_balance: 1.0,
  bank_webhook: 0.9,
  third_party_attestation: 0.8,
  recent_settlement: 0.7,
  lp_attestation: 0.5,
  manual_proof: 0.3,
};

/** Default TTL per proof type (ms). */
const PROOF_TTL: Record<ProofType, number> = {
  open_banking_balance: 60_000,   // 1 minute
  bank_webhook: 120_000,          // 2 minutes
  third_party_attestation: 300_000, // 5 minutes
  recent_settlement: 600_000,     // 10 minutes
  lp_attestation: 180_000,        // 3 minutes
  manual_proof: 900_000,          // 15 minutes
};

/** Create a new FiatProof. */
export function createFiatProof(
  lpId: string,
  proofType: ProofType,
  currency: string,
  attestedAmount: number,
  bankConnectivity: number = 0.9,
  manualConfirmation: boolean = false,
  attester: string = 'system',
): FiatProof {
  const now = Date.now();
  const ttl = PROOF_TTL[proofType];
  const proofQuality = PROOF_QUALITY[proofType];

  return {
    id: uid('proof'),
    lpId,
    proofType,
    currency,
    attestedAmount,
    confidence: 0, // computed below
    proofQuality,
    bankConnectivity,
    manualConfirmation,
    expectedAvailability: 0, // computed below
    issuedAt: now,
    expiresAt: now + ttl,
    status: 'valid',
    evidenceHash: uid('hash'),
    attester,
  };
}

/**
 * Compute confidence from proof quality, recency, and bank connectivity.
 * Confidence decays over time — a proof issued 5 minutes ago is less
 * trustworthy than one issued 5 seconds ago.
 */
export function computeConfidence(proof: FiatProof, now: number = Date.now()): number {
  if (proof.status !== 'valid') return 0;
  if (now >= proof.expiresAt) {
    proof.status = 'expired';
    return 0;
  }

  // Recency factor: 1.0 at issue, decays linearly to 0 at expiry
  const totalTtl = proof.expiresAt - proof.issuedAt;
  const remaining = proof.expiresAt - now;
  const recency = Math.max(0, remaining / totalTtl);

  // Confidence = quality × recency × bankConnectivity × expectedAvailability
  const confidence = proof.proofQuality * recency * proof.bankConnectivity * (0.5 + proof.expectedAvailability * 0.5);
  return round(Math.max(0, Math.min(1, confidence)), 4);
}

/**
 * Compute the effective available liquidity for an LP based on its proofs.
 * This is what the solver uses — NOT the raw attested amount.
 *
 *   effectiveLiquidity = min(attestedAmount, attestedAmount × confidence)
 *
 * If confidence is 0.8 and the LP attests 50,000, the solver sees 40,000.
 */
export function effectiveLiquidity(proofs: FiatProof[], lpId: string, currency: string, now: number = Date.now()): number {
  const lpProofs = proofs.filter((p) => p.lpId === lpId && p.currency === currency && p.status === 'valid');
  if (lpProofs.length === 0) return 0;

  // Use the highest-confidence proof
  let bestConfidence = 0;
  let bestAmount = 0;
  for (const proof of lpProofs) {
    const conf = computeConfidence(proof, now);
    if (conf > bestConfidence) {
      bestConfidence = conf;
      bestAmount = proof.attestedAmount;
    }
  }

  return round(bestAmount * bestConfidence, 2);
}

/** Expire all proofs that have passed their TTL. */
export function expireProofs(proofs: FiatProof[], now: number = Date.now()): FiatProof[] {
  return proofs.map((p) => {
    if (p.status === 'valid' && now >= p.expiresAt) {
      return { ...p, status: 'expired' as ProofStatus };
    }
    return p;
  });
}

/** Revoke a proof (e.g., after a dispute). */
export function revokeProof(proof: FiatProof): FiatProof {
  return { ...proof, status: 'revoked' as ProofStatus };
}

/** Get all valid proofs for an LP. */
export function validProofs(proofs: FiatProof[], lpId: string, now: number = Date.now()): FiatProof[] {
  return expireProofs(proofs, now).filter((p) => p.lpId === lpId && p.status === 'valid');
}

/** Summary of an LP's fiat confidence. */
export function confidenceSummary(proofs: FiatProof[], lpId: string, currency: string, now: number = Date.now()): {
  bestConfidence: number;
  effectiveLiquidity: number;
  attestedAmount: number;
  proofCount: number;
  bestProofType: string | null;
} {
  const lpProofs = validProofs(proofs, lpId, now).filter((p) => p.currency === currency);
  if (lpProofs.length === 0) {
    return { bestConfidence: 0, effectiveLiquidity: 0, attestedAmount: 0, proofCount: 0, bestProofType: null };
  }
  let best = lpProofs[0];
  let bestConf = computeConfidence(best, now);
  for (const p of lpProofs) {
    const conf = computeConfidence(p, now);
    if (conf > bestConf) {
      best = p;
      bestConf = conf;
    }
  }
  return {
    bestConfidence: bestConf,
    effectiveLiquidity: round(best.attestedAmount * bestConf, 2),
    attestedAmount: best.attestedAmount,
    proofCount: lpProofs.length,
    bestProofType: best.proofType,
  };
}
