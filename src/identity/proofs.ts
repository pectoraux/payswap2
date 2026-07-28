/**
 * Identity Proof Service — verifiable claims. (M-ID-41.)
 *
 * An Identity Proof is a verifiable claim tied to an identity. Four proof
 * types are supported:
 *   - signature           (the identity signed some payload with their key)
 *   - zero_knowledge      (a ZK proof attesting to some property without
 *                          revealing the underlying data)
 *   - attestation_chain   (a chain of attestations, each signed by the
 *                          previous attester)
 *   - document_hash       (a hash of an off-chain document, verifiable
 *                          against the original)
 *
 * The service stores the opaque proof `data` (the actual signature / ZK
 * proof JSON / hash) and tracks whether it has been verified.
 */

import type { Identity, IdentityProof, IdentityProofType } from './types';
import { store } from './store';
import { identityRegistry } from './registry';
import { uid } from '@/runtime/types';

export class IdentityProofService {
  /**
   * Create a proof. `data` is the opaque proof payload — its semantics
   * depend on `proofType`.
   *
   * `verifiedBy` is optional — if omitted, the proof is created unverified
   * and must be verified separately (e.g., by a verifier identity).
   */
  async create(
    identityId: string,
    proofType: IdentityProofType,
    data: string,
    opts?: { verifiedBy?: string },
  ): Promise<IdentityProof> {
    const identity = identityRegistry.getSync(identityId);
    if (!identity) throw new Error(`Identity ${identityId} not found`);

    const now = Date.now();
    const proof: IdentityProof = {
      id: uid('proof'),
      identityId,
      proofType,
      data,
      verified: !!opts?.verifiedBy,
      verifiedBy: opts?.verifiedBy,
      createdAt: now,
      verifiedAt: opts?.verifiedBy ? now : undefined,
    };
    store.proofs.set(proof.id, proof);
    return proof;
  }

  /**
   * Verify a proof. In this simplified implementation, "verification"
   * means: the proof exists, the identity exists and is active, and (if a
   * verifier is provided) the verifier identity is verified or trusted.
   *
   * Real ZK / signature verification would happen here in production.
   */
  async verify(
    proofId: string,
    opts?: { verifierIdentityId?: string },
  ): Promise<{ valid: boolean; identity?: Identity; reason?: string }> {
    const proof = store.proofs.get(proofId);
    if (!proof) return { valid: false, reason: 'Proof not found' };
    const identity = identityRegistry.getSync(proof.identityId);
    if (!identity) return { valid: false, reason: 'Subject identity not found' };
    if (identity.status !== 'active') {
      return { valid: false, reason: `Identity is ${identity.status}`, identity };
    }

    // If a verifier is provided, check the verifier is trusted.
    if (opts?.verifierIdentityId) {
      const verifier = identityRegistry.getSync(opts.verifierIdentityId);
      if (!verifier) return { valid: false, reason: 'Verifier not found' };
      if (verifier.status !== 'active') return { valid: false, reason: `Verifier is ${verifier.status}` };
      if (verifier.trustLevel === 'unverified') return { valid: false, reason: 'Verifier is unverified' };
      proof.verifiedBy = opts.verifierIdentityId;
    }

    proof.verified = true;
    proof.verifiedAt = Date.now();
    return { valid: true, identity };
  }

  /** List proofs for an identity. */
  async list(identityId: string): Promise<IdentityProof[]> {
    return Array.from(store.proofs.values()).filter((p) => p.identityId === identityId);
  }

  /** Lookup by ID. */
  getSync(proofId: string): IdentityProof | null {
    return store.proofs.get(proofId) ?? null;
  }

  /** All proofs (admin overview). */
  listAll(): IdentityProof[] {
    return Array.from(store.proofs.values());
  }
}

export const identityProofService = new IdentityProofService();
