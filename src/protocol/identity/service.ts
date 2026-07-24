/**
 * PaySwap Protocol — Identity Module.
 *
 * Manages identity verification for all protocol actors (buyers, merchants, LPs).
 * Identity is established through evidence (KYC, bank verification, etc.).
 * No direct state mutation — identity is a projection of verification events.
 */
import { type Entity, createEntity } from '@/kernel';
import { uid } from '@/kernel/support';
import { merchantRegistry } from '../merchant-registry';

export type IdentityState = 'unverified' | 'pending' | 'verified' | 'suspended' | 'revoked';
export type IdentityType = 'individual' | 'business' | 'lp';

export interface Identity {
  id: string;
  type: IdentityType;
  externalId: string;
  name: string;
  country: string;
  state: IdentityState;
  kycLevel: number;
  verificationEvidence: string[];
  createdAt: number;
  verifiedAt: number | null;
}

export class IdentityService {
  private identities: Map<string, Identity> = new Map();

  register(params: {
    type: IdentityType;
    externalId: string;
    name: string;
    country: string;
  }): Identity {
    const identity: Identity = {
      id: uid('identity'),
      type: params.type,
      externalId: params.externalId,
      name: params.name,
      country: params.country,
      state: 'unverified',
      kycLevel: 0,
      verificationEvidence: [],
      createdAt: Date.now(),
      verifiedAt: null,
    };
    this.identities.set(identity.id, identity);
    return identity;
  }

  submitVerification(identityId: string, evidenceId: string, kycLevel: number): Identity | null {
    const identity = this.identities.get(identityId);
    if (!identity) return null;
    if (identity.state === 'unverified' || identity.state === 'pending') {
      identity.state = 'pending';
      identity.verificationEvidence.push(evidenceId);
      identity.kycLevel = Math.max(identity.kycLevel, kycLevel);
    }
    return identity;
  }

  verify(identityId: string): Identity | null {
    const identity = this.identities.get(identityId);
    if (!identity || identity.state !== 'pending') return null;
    identity.state = 'verified';
    identity.verifiedAt = Date.now();

    // If this is a merchant identity, register in merchant registry
    if (identity.type === 'business') {
      const bond = identity.kycLevel >= 3 ? 20000 : identity.kycLevel >= 2 ? 5000 : identity.kycLevel >= 1 ? 1000 : 0;
      merchantRegistry.register(identity.externalId, identity.name, identity.country, '', bond);
    }

    return identity;
  }

  suspend(identityId: string, reason: string): Identity | null {
    const identity = this.identities.get(identityId);
    if (!identity) return null;
    identity.state = 'suspended';
    return identity;
  }

  revoke(identityId: string, reason: string): Identity | null {
    const identity = this.identities.get(identityId);
    if (!identity) return null;
    identity.state = 'revoked';
    return identity;
  }

  get(identityId: string): Identity | undefined { return this.identities.get(identityId); }
  getByExternalId(externalId: string): Identity | undefined {
    return [...this.identities.values()].find((i) => i.externalId === externalId);
  }
  all(): Identity[] { return [...this.identities.values()]; }
  verified(): Identity[] { return this.all().filter((i) => i.state === 'verified'); }

  reset(): void { this.identities.clear(); }
}

export const identityService = new IdentityService();
