/**
 * Identity Registry — the canonical source of truth for identities. (M-ID-41.)
 *
 * The registry is the entry point for the Identity OS. Every other service
 * (CredentialManager, AttestationService, DelegationManager, RecoveryManager,
 * IdentityProofService) goes through the registry to resolve an identity by
 * ID, by entity, or by search.
 *
 * The registry is a singleton instance — same pattern as the SDK and the
 * Trust Engine.
 */

import type { Identity, IdentityType, TrustLevel, IdentityStatus } from './types';
import { store } from './store';
import { uid } from '@/runtime/types';

export function trustLevelFromScore(score: number): TrustLevel {
  if (score >= 90) return 'privileged';
  if (score >= 70) return 'trusted';
  if (score >= 40) return 'verified';
  return 'unverified';
}

export class IdentityRegistry {
  /**
   * Register a new identity for an existing entity. If an identity already
   * exists for the (entityType, entityId) pair, return the existing one
   * (idempotent — same behaviour as the SDK loader's `register`).
   */
  async register(
    type: IdentityType,
    entityId: string,
    entityType: string,
    name: string,
    opts?: { trustScore?: number; metadata?: Record<string, unknown> },
  ): Promise<Identity> {
    const existing = this.findByEntitySync(entityId, entityType);
    if (existing) return existing;

    const now = Date.now();
    const trustScore = opts?.trustScore ?? 0;
    const identity: Identity = {
      id: uid('id'),
      type,
      name,
      entityId,
      entityType,
      trustScore,
      trustLevel: trustLevelFromScore(trustScore),
      credentials: [],
      attestations: [],
      delegations: [],
      status: 'active',
      metadata: opts?.metadata,
      createdAt: now,
      updatedAt: now,
    };
    store.identities.set(identity.id, identity);
    store.entityIndex.set(`${entityType}:${entityId}`, identity.id);
    return identity;
  }

  /** Get an identity by ID. */
  async get(identityId: string): Promise<Identity | null> {
    return store.identities.get(identityId) ?? null;
  }

  /** Sync variant — used internally by other identity services. */
  getSync(identityId: string): Identity | null {
    return store.identities.get(identityId) ?? null;
  }

  /** Find an identity by its underlying entity (e.g., a merchant row). */
  async findByEntity(entityId: string, entityType: string): Promise<Identity | null> {
    return this.findByEntitySync(entityId, entityType);
  }

  findByEntitySync(entityId: string, entityType: string): Identity | null {
    const id = store.entityIndex.get(`${entityType}:${entityId}`);
    if (!id) return null;
    return store.identities.get(id) ?? null;
  }

  /** List identities by type. */
  async listByType(type: IdentityType): Promise<Identity[]> {
    return Array.from(store.identities.values()).filter((i) => i.type === type);
  }

  /** List all identities (optionally filtered). */
  list(filter?: {
    type?: IdentityType;
    trustLevel?: TrustLevel;
    status?: IdentityStatus;
  }): Identity[] {
    const all = Array.from(store.identities.values());
    if (!filter) return all;
    return all.filter((i) => {
      if (filter.type && i.type !== filter.type) return false;
      if (filter.trustLevel && i.trustLevel !== filter.trustLevel) return false;
      if (filter.status && i.status !== filter.status) return false;
      return true;
    });
  }

  /** Search identities by name (case-insensitive substring match). */
  async search(query: string): Promise<Identity[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return Array.from(store.identities.values()).filter((i) =>
      i.name.toLowerCase().includes(q),
    );
  }

  /** Update trust score (called by the Trust Engine). */
  async updateTrustScore(identityId: string, score: number): Promise<void> {
    const identity = store.identities.get(identityId);
    if (!identity) return;
    identity.trustScore = Math.max(0, Math.min(100, score));
    identity.trustLevel = trustLevelFromScore(identity.trustScore);
    identity.updatedAt = Date.now();
  }

  /** Suspend an identity (e.g., by compliance / risk escalation). */
  async suspend(identityId: string, reason: string): Promise<void> {
    const identity = store.identities.get(identityId);
    if (!identity) return;
    identity.status = 'suspended';
    identity.suspendedAt = Date.now();
    identity.suspendedReason = reason;
    identity.updatedAt = Date.now();
  }

  /** Revoke an identity (terminal state — needs explicit reactivate). */
  async revoke(identityId: string, reason: string): Promise<void> {
    const identity = store.identities.get(identityId);
    if (!identity) return;
    identity.status = 'revoked';
    identity.revokedAt = Date.now();
    identity.revokedReason = reason;
    identity.updatedAt = Date.now();
  }

  /** Reactivate a suspended / revoked identity. */
  async reactivate(identityId: string): Promise<void> {
    const identity = store.identities.get(identityId);
    if (!identity) return;
    identity.status = 'active';
    identity.suspendedAt = undefined;
    identity.suspendedReason = undefined;
    identity.revokedAt = undefined;
    identity.revokedReason = undefined;
    identity.updatedAt = Date.now();
  }
}

export const identityRegistry = new IdentityRegistry();
