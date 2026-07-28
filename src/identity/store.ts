/**
 * Identity OS — in-memory store. (M-ID-41.)
 *
 * Single process-wide singleton that holds the identity, credential,
 * attestation, delegation, recovery-method, recovery-session, and proof
 * records. Mirrors the SDK / Trust Engine pattern: stored on
 * `globalThis.__PAYSWAP_IDENTITY_STORE__` so Next.js dev-mode module
 * re-instantiation does not lose data.
 *
 * We deliberately do NOT touch the Prisma schema (constraint: do not modify
 * `prisma/schema.prisma`). Identity records are an in-memory index OVER the
 * existing User / Merchant / LPProfile / Organization tables — `entityId`
 * points back to the underlying row.
 */

import type {
  Identity,
  IdentityType,
  Credential,
  Attestation,
  Delegation,
  RecoveryMethod,
  RecoverySession,
  IdentityProof,
} from './types';
import { uid } from '@/runtime/types';

// ─── Hash helper (lightweight, non-cryptographic) ──────────────────────────
//
// We never store plaintext secrets. This is a simple hash for demo / dev use.
// In production this would be replaced by argon2 / bcrypt.

function simpleHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Add a second pass for a longer hash
  let h2 = 0xcbf29ce4;
  for (let i = input.length - 1; i >= 0; i--) {
    h2 ^= input.charCodeAt(i);
    h2 = Math.imul(h2, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function hashSecret(secret: string): string {
  return `sh_${simpleHash(secret)}`;
}

export function verifySecret(secret: string, hash: string): boolean {
  return hashSecret(secret) === hash;
}

// ─── Store shape ────────────────────────────────────────────────────────────

export interface IdentityStore {
  identities: Map<string, Identity>;
  // credentialId → credential (also referenced from Identity.credentials)
  credentials: Map<string, Credential>;
  // attestationId → attestation (also referenced from Identity.attestations)
  attestations: Map<string, Attestation>;
  // delegationId → delegation (also referenced from Identity.delegations)
  delegations: Map<string, Delegation>;
  // recoveryMethodId → method
  recoveryMethods: Map<string, RecoveryMethod>;
  // recoveryId → session (transient recovery flows)
  recoverySessions: Map<string, RecoverySession>;
  // proofId → proof
  proofs: Map<string, IdentityProof>;
  // entity key (`${entityType}:${entityId}`) → identityId (for findByEntity)
  entityIndex: Map<string, string>;
}

function createStore(): IdentityStore {
  return {
    identities: new Map(),
    credentials: new Map(),
    attestations: new Map(),
    delegations: new Map(),
    recoveryMethods: new Map(),
    recoverySessions: new Map(),
    proofs: new Map(),
    entityIndex: new Map(),
  };
}

const globalForIdentity = globalThis as unknown as {
  __PAYSWAP_IDENTITY_STORE__?: IdentityStore;
  __PAYSWAP_IDENTITY_SEEDED__?: boolean;
};

export const store: IdentityStore =
  globalForIdentity.__PAYSWAP_IDENTITY_STORE__ ?? createStore();

if (!globalForIdentity.__PAYSWAP_IDENTITY_STORE__) {
  globalForIdentity.__PAYSWAP_IDENTITY_STORE__ = store;
}

// ─── Seed ─────────────────────────────────────────────────────────────────
//
// Seed the Identity OS with a representative mix of identity types so the
// admin UI has something to show out of the box. We DON'T require any
// existing Prisma rows — the seed creates standalone identities (with
// `entityType: 'seed'`) for demo purposes. When the Identity OS is wired
// into actual onboarding flows, real identities will be registered via the
// `IdentityRegistry.register()` method with `entityType: 'User'` /
// `'Merchant'` / etc.

function trustLevelFromScore(score: number): Identity['trustLevel'] {
  if (score >= 90) return 'privileged';
  if (score >= 70) return 'trusted';
  if (score >= 40) return 'verified';
  return 'unverified';
}

export function seedIdentityStore(): void {
  if (globalForIdentity.__PAYSWAP_IDENTITY_SEEDED__) return;
  globalForIdentity.__PAYSWAP_IDENTITY_SEEDED__ = true;

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const seeds: Array<{
    type: IdentityType;
    name: string;
    entityId: string;
    entityType: string;
    trustScore: number;
    status?: Identity['status'];
    emailCred?: string;
    apiKey?: string;
    recoveryEmail?: string;
    attestation?: { type: Attestation['type']; value: string; confidence: number; attester: string };
    delegation?: { to: string; scope: string[] };
  }> = [
    {
      type: 'person',
      name: 'Ama Mensah',
      entityId: 'seed-person-1',
      entityType: 'User',
      trustScore: 82,
      emailCred: 'ama@payswap.demo',
      recoveryEmail: 'ama@payswap.demo',
      attestation: { type: 'identity', value: 'Ghana National ID verified', confidence: 95, attester: 'identity-gov-gh' },
    },
    {
      type: 'person',
      name: 'Kwame Boateng',
      entityId: 'seed-person-2',
      entityType: 'User',
      trustScore: 48,
      emailCred: 'kwame@payswap.demo',
      recoveryEmail: 'kwame@payswap.demo',
    },
    {
      type: 'merchant',
      name: 'Accra Coffee Roasters',
      entityId: 'seed-merchant-1',
      entityType: 'Merchant',
      trustScore: 76,
      emailCred: 'ops@accracoffee.gh',
      attestation: { type: 'business', value: 'Ghana Business Registration verified', confidence: 90, attester: 'identity-gov-gh' },
    },
    {
      type: 'merchant',
      name: 'Kente Emporium',
      entityId: 'seed-merchant-2',
      entityType: 'Merchant',
      trustScore: 64,
      emailCred: 'hello@kente.gh',
    },
    {
      type: 'lp',
      name: 'Sahara Liquidity Pool',
      entityId: 'seed-lp-1',
      entityType: 'LPProfile',
      trustScore: 88,
      emailCred: 'treasury@sahara-lp.io',
      attestation: { type: 'income', value: 'Quarterly reserve audit confirmed', confidence: 92, attester: 'audit-firm-big4' },
    },
    {
      type: 'lp',
      name: 'Volta Capital',
      entityId: 'seed-lp-2',
      entityType: 'LPProfile',
      trustScore: 71,
      emailCred: 'ops@volta.gh',
    },
    {
      type: 'organization',
      name: 'PaySwap Foundation',
      entityId: 'seed-org-1',
      entityType: 'Organization',
      trustScore: 95,
      emailCred: 'foundation@payswap.io',
      attestation: { type: 'business', value: 'Organization registered as non-profit', confidence: 99, attester: 'identity-gov-gh' },
    },
    {
      type: 'government',
      name: 'Bank of Ghana (Regulator)',
      entityId: 'seed-gov-1',
      entityType: 'Regulator',
      trustScore: 99,
      emailCred: 'fintech@bog.gov.gh',
      attestation: { type: 'identity', value: 'Central bank authority recognized', confidence: 100, attester: 'identity-gov-gh' },
    },
    {
      type: 'wallet',
      name: 'Treasury Hot Wallet #1',
      entityId: 'seed-wallet-1',
      entityType: 'Wallet',
      trustScore: 55,
      apiKey: 'wlt_live_xxxxxxxxxxxxxxxx',
    },
    {
      type: 'ai_agent',
      name: 'Treasury Optimization Agent',
      entityId: 'seed-ai-1',
      entityType: 'AIAgent',
      trustScore: 60,
      apiKey: 'ai_agent_key_yyyyyyyyyy',
      // AI agent is delegated by the Foundation org (created above).
      delegation: { to: 'seed-org-1', scope: ['treasury:read', 'treasury:rebalance:write'] },
    },
    {
      type: 'device',
      name: 'POS Terminal — Accra Mall #14',
      entityId: 'seed-device-1',
      entityType: 'Device',
      trustScore: 50,
      apiKey: 'device_pos_zzzzzzzzzzzz',
    },
    {
      type: 'device',
      name: 'ATM — Kumasi Branch #3',
      entityId: 'seed-device-2',
      entityType: 'Device',
      trustScore: 45,
      status: 'suspended',
      apiKey: 'device_atm_aaaaaaaaaa',
    },
  ];

  // First pass — create identities so we can reference their IDs.
  const createdIdentities: Identity[] = [];
  for (const seed of seeds) {
    const id = uid('id');
    const identity: Identity = {
      id,
      type: seed.type,
      name: seed.name,
      entityId: seed.entityId,
      entityType: seed.entityType,
      trustScore: seed.trustScore,
      trustLevel: trustLevelFromScore(seed.trustScore),
      credentials: [],
      attestations: [],
      delegations: [],
      status: seed.status ?? 'active',
      createdAt: now - Math.floor(Math.random() * 30) * day,
      updatedAt: now,
      suspendedAt: seed.status === 'suspended' ? now - day : undefined,
      suspendedReason: seed.status === 'suspended' ? 'Suspicious activity flagged by Trust Engine' : undefined,
    };
    store.identities.set(id, identity);
    store.entityIndex.set(`${seed.entityType}:${seed.entityId}`, id);
    createdIdentities.push(identity);
  }

  // Second pass — credentials, attestations, recovery, proofs, delegations.
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const identity = createdIdentities[i];

    if (seed.emailCred) {
      const cred: Credential = {
        id: uid('cred'),
        type: seed.apiKey ? 'api_key' : 'password',
        identifier: seed.emailCred,
        verified: true,
        createdAt: identity.createdAt,
        lastUsedAt: now - Math.floor(Math.random() * 7) * day,
        secretHash: hashSecret(seed.apiKey ?? 'demo-password-123'),
      };
      store.credentials.set(cred.id, cred);
      identity.credentials.push(cred);
    }

    if (seed.attestation) {
      const att: Attestation = {
        id: uid('att'),
        type: seed.attestation.type,
        attestedBy: seed.attestation.attester,
        attesterName: seed.attestation.attester === 'identity-gov-gh' ? 'Ghana Identity Authority'
          : seed.attestation.attester === 'audit-firm-big4' ? 'Big4 Audit Partners'
          : seed.attestation.attester,
        subjectIdentityId: identity.id,
        value: seed.attestation.value,
        confidence: seed.attestation.confidence,
        validFrom: identity.createdAt,
        validUntil: identity.createdAt + 365 * day,
        createdAt: identity.createdAt,
      };
      store.attestations.set(att.id, att);
      identity.attestations.push(att);
    }

    if (seed.recoveryEmail) {
      const rm: RecoveryMethod = {
        id: uid('rec'),
        identityId: identity.id,
        type: 'email',
        identifier: seed.recoveryEmail,
        verified: true,
        createdAt: identity.createdAt,
        verifiedAt: identity.createdAt,
      };
      store.recoveryMethods.set(rm.id, rm);
    }

    if (seed.delegation) {
      const fromIdentity = createdIdentities.find(
        (idnt) => idnt.entityId === seed.delegation!.to,
      );
      if (fromIdentity) {
        const dlg: Delegation = {
          id: uid('dlg'),
          fromIdentityId: fromIdentity.id,
          toIdentityId: identity.id,
          scope: seed.delegation.scope,
          limits: { maxAmount: 10000, currency: 'USD', dailyLimit: 5000 },
          validFrom: identity.createdAt,
          validUntil: identity.createdAt + 90 * day,
          createdAt: identity.createdAt,
        };
        store.delegations.set(dlg.id, dlg);
        // Store delegation on both identities (the from-side for "who I delegated to",
        // the to-side for "who can act on my behalf"). The listFrom/listTo helpers
        // filter accordingly — so we attach it to the from-identity only.
        fromIdentity.delegations.push(dlg);
      }
    }
  }

  // Add a few identity proofs for the privileged identities.
  for (const identity of createdIdentities) {
    if (identity.trustLevel === 'privileged' || identity.trustLevel === 'trusted') {
      const proof: IdentityProof = {
        id: uid('proof'),
        identityId: identity.id,
        proofType: 'signature',
        data: `sig:${identity.id}:${identity.trustScore}`,
        verified: true,
        verifiedBy: 'identity-gov-gh',
        createdAt: identity.createdAt,
        verifiedAt: identity.createdAt,
      };
      store.proofs.set(proof.id, proof);
    }
  }
}

// Auto-seed on first import (mirrors the SDK pattern where built-ins are
// registered automatically on singleton creation).
seedIdentityStore();
