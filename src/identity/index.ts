/**
 * Identity OS — public entry point. (M-ID-41.)
 *
 * Wires together the Identity Registry, Credential Manager, Attestation
 * Service, Delegation Manager, Recovery Manager, and Identity Proof Service
 * into a single Identity Engine.
 *
 * The Identity OS is a NEW layer parallel to `src/runtime/`, `src/trust/`,
 * and `src/sdk/`. It does NOT modify the frozen kernel. It maintains an
 * in-memory index OVER the existing User / Merchant / LPProfile /
 * Organization tables — every Identity record carries an `entityId` +
 * `entityType` that points back to the underlying Prisma row.
 */

export * from './types';
export { IdentityRegistry, identityRegistry, trustLevelFromScore } from './registry';
export { CredentialManager, credentialManager } from './credentials';
export { AttestationService, attestationService } from './attestations';
export { DelegationManager, delegationManager } from './delegation';
export { RecoveryManager, recoveryManager } from './recovery';
export { IdentityProofService, identityProofService } from './proofs';
export { store, hashSecret, verifySecret, seedIdentityStore } from './store';
export type { IdentityStore } from './store';

import { identityRegistry } from './registry';
import { credentialManager } from './credentials';
import { attestationService } from './attestations';
import { delegationManager } from './delegation';
import { recoveryManager } from './recovery';
import { identityProofService } from './proofs';
import { store } from './store';
import type {
  Identity,
  IdentityType,
  IdentityStatus,
  TrustLevel,
  IdentityOverview,
} from './types';

/**
 * The Identity Engine is the unified handle for the entire Identity OS.
 * Each sub-service is independently accessible (e.g., `identityEngine.registry`
 * is the same instance as the exported `identityRegistry` singleton).
 */
export interface IdentityEngine {
  registry: typeof identityRegistry;
  credentials: typeof credentialManager;
  attestations: typeof attestationService;
  delegation: typeof delegationManager;
  recovery: typeof recoveryManager;
  proofs: typeof identityProofService;
  /** Convenience: get an identity by ID (delegates to registry). */
  get(identityId: string): Promise<Identity | null>;
  /** Convenience: register a new identity (delegates to registry). */
  register(
    type: IdentityType,
    entityId: string,
    entityType: string,
    name: string,
    opts?: { trustScore?: number; metadata?: Record<string, unknown> },
  ): Promise<Identity>;
  /** Compute a dashboard overview. */
  overview(): IdentityOverview;
}

export const identityEngine: IdentityEngine = {
  registry: identityRegistry,
  credentials: credentialManager,
  attestations: attestationService,
  delegation: delegationManager,
  recovery: recoveryManager,
  proofs: identityProofService,

  async get(identityId) {
    return identityRegistry.get(identityId);
  },

  async register(type, entityId, entityType, name, opts) {
    return identityRegistry.register(type, entityId, entityType, name, opts);
  },

  overview(): IdentityOverview {
    const identities = Array.from(store.identities.values());
    const byType = {
      person: 0, merchant: 0, lp: 0, organization: 0,
      government: 0, wallet: 0, ai_agent: 0, device: 0,
    } as Record<IdentityType, number>;
    const byTrustLevel = {
      unverified: 0, verified: 0, trusted: 0, privileged: 0,
    } as Record<TrustLevel, number>;
    const byStatus = {
      active: 0, suspended: 0, revoked: 0,
    } as Record<IdentityStatus, number>;

    let trustSum = 0;
    for (const idnt of identities) {
      byType[idnt.type] += 1;
      byTrustLevel[idnt.trustLevel] += 1;
      byStatus[idnt.status] += 1;
      trustSum += idnt.trustScore;
    }

    return {
      total: identities.length,
      byType,
      byTrustLevel,
      byStatus,
      credentials: store.credentials.size,
      attestations: store.attestations.size,
      delegations: store.delegations.size,
      recoveryMethods: store.recoveryMethods.size,
      proofs: store.proofs.size,
      averageTrustScore: identities.length > 0 ? Math.round(trustSum / identities.length) : 0,
    };
  },
};
