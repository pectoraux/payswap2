/**
 * Identity OS — Core Types. (M-ID-41.)
 *
 * Identity is the substrate of every PaySwap participant. Today identities are
 * mostly users; eventually identities become people, merchants, LPs,
 * organizations, governments, wallets, AI agents, devices — all with
 * credentials, attestations, permissions, delegation, recovery, and trust
 * scores.
 *
 * The Identity OS sits ABOVE the runtime kernel and BESIDE the Trust Engine.
 * It does NOT modify the frozen kernel. It manages:
 *   - Identity registration (one record per entity across 8 identity types)
 *   - Credentials (passwords, API keys, OAuth, certificates, biometrics,
 *     hardware keys)
 *   - Attestations (third-party-verified claims about an identity)
 *   - Delegation (who can act on behalf of an identity, with scope + limits)
 *   - Recovery (email / phone / backup codes / social / hardware key /
 *     trusted contact)
 *   - Proofs (verifiable claims — signatures, zero-knowledge proofs,
 *     attestation chains, document hashes)
 *
 * The Identity OS uses in-memory maps (consistent with the rest of the
 * runtime layer singletons) and persists summary data through the existing
 * Prisma models where appropriate. The constraint is: do NOT modify the
 * Prisma schema.
 */

// ─── Identity Types ────────────────────────────────────────────────────────

/**
 * Every participant in PaySwap is an Identity. The 8 supported identity types
 * cover the full lifecycle of the platform: from individual humans to
 * programmatic AI agents and physical devices.
 */
export type IdentityType =
  | 'person' // individual human
  | 'merchant' // business that accepts payments
  | 'lp' // liquidity provider
  | 'organization' // organization (can own merchants, LPs, etc.)
  | 'government' // government entity (regulator, central bank)
  | 'wallet' // a wallet identity (for programmatic payments)
  | 'ai_agent' // AI agent with delegated authority
  | 'device'; // IoT device (POS terminal, ATM)

export type TrustLevel = 'unverified' | 'verified' | 'trusted' | 'privileged';
export type IdentityStatus = 'active' | 'suspended' | 'revoked';

/**
 * An Identity is the unified record for any PaySwap participant.
 *
 * `entityId` / `entityType` point back to the underlying Prisma model
 * (User, Merchant, LPProfile, Organization, etc.) so the Identity OS is
 * a unified index OVER the existing data model — not a duplicate.
 */
export interface Identity {
  id: string;
  type: IdentityType;
  name: string;
  // The underlying entity (User, Merchant, LPProfile, Organization, etc.)
  entityId: string;
  entityType: string;
  // Trust score (from the Trust Engine; higher = more trusted)
  trustScore: number;
  trustLevel: TrustLevel;
  // Credentials
  credentials: Credential[];
  // Attestations (claims verified by third parties)
  attestations: Attestation[];
  // Delegation (who can act on behalf of this identity)
  delegations: Delegation[];
  // Status
  status: IdentityStatus;
  // Free-form metadata
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  // Lifecycle timestamps
  suspendedAt?: number;
  suspendedReason?: string;
  revokedAt?: number;
  revokedReason?: string;
}

// ─── Credentials ────────────────────────────────────────────────────────────

export type CredentialType =
  | 'password'
  | 'api_key'
  | 'oauth'
  | 'certificate'
  | 'biometric'
  | 'hardware_key';

export interface Credential {
  id: string;
  type: CredentialType;
  identifier: string; // e.g., email, key fingerprint
  verified: boolean;
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
  // Opaque secret hash (we never store plaintext). Only set for password /
  // api_key / hardware_key credentials. Other types use external verification.
  secretHash?: string;
}

// ─── Attestations ───────────────────────────────────────────────────────────

export type AttestationType =
  | 'identity'
  | 'address'
  | 'income'
  | 'business'
  | 'sanctions_clear'
  | 'pep_clear'
  | 'credit_score'
  | 'custom';

export interface Attestation {
  id: string;
  type: AttestationType;
  attestedBy: string; // identity ID of the attester
  attesterName: string;
  // The identity this attestation is about (set when the attestation is
  // attached to a subject identity record).
  subjectIdentityId: string;
  value: string; // the attested value
  confidence: number; // 0-100
  validFrom: number;
  validUntil?: number;
  evidence?: string; // URL or hash of evidence
  revokedAt?: number;
  revokedReason?: string;
  createdAt: number;
}

// ─── Delegation ─────────────────────────────────────────────────────────────

/**
 * Delegation lets one identity act on behalf of another. The scope is a list
 * of dotted permission strings (e.g. `payments:write`, `payouts:read`).
 * Limits cap the financial exposure of a delegation.
 */
export interface Delegation {
  id: string;
  fromIdentityId: string; // who is delegating
  toIdentityId: string; // who receives the delegation
  scope: string[]; // what they can do (e.g., ['payments:write', 'payouts:read'])
  limits?: {
    maxAmount?: number;
    currency?: string;
    dailyLimit?: number;
  };
  validFrom: number;
  validUntil?: number;
  revokedAt?: number;
  revokedReason?: string;
  createdAt: number;
}

// ─── Recovery ───────────────────────────────────────────────────────────────

export type RecoveryMethodType =
  | 'email'
  | 'phone'
  | 'backup_codes'
  | 'social'
  | 'hardware_key'
  | 'trusted_contact';

export interface RecoveryMethod {
  id: string;
  identityId: string;
  type: RecoveryMethodType;
  identifier: string; // email address, phone number, contact handle, etc.
  verified: boolean;
  createdAt: number;
  verifiedAt?: number;
  // For backup_codes — the set of remaining codes (hashed). For other types
  // a single pending verification code is stored here transiently.
  pendingCode?: string;
  backupCodes?: string[]; // hashed backup codes
}

export interface RecoverySession {
  recoveryId: string;
  identityId: string;
  initiatedAt: number;
  expiresAt: number;
  completedAt?: number;
  resetToken?: string;
}

// ─── Identity Proofs ────────────────────────────────────────────────────────

export type IdentityProofType =
  | 'signature'
  | 'zero_knowledge'
  | 'attestation_chain'
  | 'document_hash';

/**
 * A verifiable claim tied to an identity. The proof data is opaque — its
 * semantics depend on `proofType`. The Identity OS only tracks the proof's
 * existence, verification status, and verifier.
 */
export interface IdentityProof {
  id: string;
  identityId: string;
  proofType: IdentityProofType;
  data: string; // the proof data (signature, ZK proof JSON, hash, etc.)
  verified: boolean;
  verifiedBy?: string; // identity ID of the verifier
  createdAt: number;
  verifiedAt?: number;
}

// ─── Overview ───────────────────────────────────────────────────────────────

export interface IdentityOverview {
  total: number;
  byType: Record<IdentityType, number>;
  byTrustLevel: Record<TrustLevel, number>;
  byStatus: Record<IdentityStatus, number>;
  // Aggregate counts for the dashboard
  credentials: number;
  attestations: number;
  delegations: number;
  recoveryMethods: number;
  proofs: number;
  averageTrustScore: number;
}
