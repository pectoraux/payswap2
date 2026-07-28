/**
 * Attestation Service — third-party-verified claims about an identity. (M-ID-41.)
 *
 * An attestation is a claim made by an "attester" identity about a "subject"
 * identity. Example attesters: government identity authorities, audit firms,
 * banks, the platform itself.
 *
 * The service handles create / list / verify / revoke. `verify()` checks
 * that the attester identity exists, is active, and is sufficiently trusted
 * (trustLevel >= 'verified'). Revoked attestations stay in the record for
 * audit purposes — `revokedAt` is the canonical flag.
 */

import type { Attestation, AttestationType } from './types';
import { store } from './store';
import { identityRegistry } from './registry';
import { uid } from '@/runtime/types';

const MIN_ATTESTER_TRUST: Attestation['attestedBy'][] = []; // not used; trust level checked below

export interface CreateAttestationInput {
  type: AttestationType;
  attesterName?: string;
  value: string;
  confidence?: number;
  validFrom?: number;
  validUntil?: number;
  evidence?: string;
}

export class AttestationService {
  /**
   * Create an attestation. The attester must be an existing, active identity
   * with trust level 'verified' or higher.
   */
  async create(
    attesterIdentityId: string,
    subjectIdentityId: string,
    attestation: CreateAttestationInput,
  ): Promise<Attestation> {
    const attester = identityRegistry.getSync(attesterIdentityId);
    if (!attester) throw new Error(`Attester identity ${attesterIdentityId} not found`);
    if (attester.status !== 'active') {
      throw new Error(`Attester ${attesterIdentityId} is not active (status: ${attester.status})`);
    }
    if (attester.trustLevel === 'unverified') {
      throw new Error(`Attester ${attesterIdentityId} is not verified (trust level: ${attester.trustLevel})`);
    }

    const subject = identityRegistry.getSync(subjectIdentityId);
    if (!subject) throw new Error(`Subject identity ${subjectIdentityId} not found`);

    const now = Date.now();
    const full: Attestation = {
      id: uid('att'),
      type: attestation.type,
      attestedBy: attesterIdentityId,
      attesterName: attestation.attesterName ?? attester.name,
      subjectIdentityId,
      value: attestation.value,
      confidence: Math.max(0, Math.min(100, attestation.confidence ?? 80)),
      validFrom: attestation.validFrom ?? now,
      validUntil: attestation.validUntil,
      evidence: attestation.evidence,
      createdAt: now,
    };
    store.attestations.set(full.id, full);
    subject.attestations.push(full);
    subject.updatedAt = now;

    // A high-confidence attestation from a trusted attester nudges the
    // subject's trust score up.
    if (attester.trustLevel === 'trusted' || attester.trustLevel === 'privileged') {
      const bump = Math.round((full.confidence / 100) * 5);
      await identityRegistry.updateTrustScore(subjectIdentityId, subject.trustScore + bump);
    }

    return full;
  }

  /** List attestations for an identity (as the subject). */
  async list(identityId: string): Promise<Attestation[]> {
    const identity = identityRegistry.getSync(identityId);
    return identity ? [...identity.attestations] : [];
  }

  /**
   * Verify an attestation. Returns `{ valid, reason? }`.
   *
   * Validity checks:
   *   1. Attestation exists
   *   2. Not revoked
   *   3. `validFrom` is in the past
   *   4. `validUntil` (if set) is in the future
   *   5. Attester identity is active
   *   6. Attester identity is verified / trusted / privileged
   */
  async verify(attestationId: string): Promise<{ valid: boolean; reason?: string }> {
    const att = store.attestations.get(attestationId);
    if (!att) return { valid: false, reason: 'Attestation not found' };
    if (att.revokedAt) return { valid: false, reason: `Attestation revoked: ${att.revokedReason ?? 'no reason given'}` };
    const now = Date.now();
    if (att.validFrom > now) return { valid: false, reason: 'Attestation not yet valid' };
    if (att.validUntil && att.validUntil < now) return { valid: false, reason: 'Attestation expired' };
    const attester = identityRegistry.getSync(att.attestedBy);
    if (!attester) return { valid: false, reason: 'Attester identity not found' };
    if (attester.status !== 'active') return { valid: false, reason: `Attester is ${attester.status}` };
    if (attester.trustLevel === 'unverified') return { valid: false, reason: 'Attester is unverified' };
    return { valid: true };
  }

  /** Revoke an attestation. */
  async revoke(attestationId: string, reason: string): Promise<void> {
    const att = store.attestations.get(attestationId);
    if (!att) return;
    att.revokedAt = Date.now();
    att.revokedReason = reason;
    // Drop the attestation from the subject's list (we keep the canonical
    // record in `store.attestations` for audit).
    const subject = identityRegistry.getSync(att.subjectIdentityId);
    if (subject) {
      const idx = subject.attestations.findIndex((a) => a.id === attestationId);
      if (idx >= 0) subject.attestations.splice(idx, 1);
      subject.updatedAt = Date.now();
    }
  }

  /** Lookup by ID. */
  getSync(attestationId: string): Attestation | null {
    return store.attestations.get(attestationId) ?? null;
  }

  /** All attestations (for the admin overview). */
  listAll(): Attestation[] {
    return Array.from(store.attestations.values());
  }
}

// Suppress unused-var warning for the placeholder constant.
void MIN_ATTESTER_TRUST;

export const attestationService = new AttestationService();
