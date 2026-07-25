/**
 * PaySwap Protocol — Production Wallet Infrastructure Types.
 *
 * Central type registry for the protocol-layer wallet module
 * (`src/protocol/wallets-v2/`). Every wallet service (HD wallets, MPC,
 * custodial, non-custodial, key rotation, encrypted storage, recovery,
 * policies, withdrawals) imports its public types from here — this keeps
 * the dependency graph flat (no service imports another service's types)
 * and makes the surface trivially auditable by a security officer.
 *
 * Design notes:
 *  - All identifiers are opaque strings (`walletId`, `accountId`,
 *    `delegationId`, …). They are minted by upstream services and passed
 *    in. The wallet layer never assumes their format.
 *  - Every gate-style method (`enforcePolicy`, `requireMnemonic`,
 *    `requireActiveWallet`) returns void on success and throws a
 *    `WalletError` on failure.
 *  - Timestamps are epoch milliseconds (`Date.now()`).
 *  - All status / state unions are string-literal types so the audit
 *    trail is self-describing.
 *
 * The kernel is FROZEN — this module only imports `uid`, `nowTs`, and
 * `eventEngine` from `@/kernel/*`. No kernel files are modified.
 */

// ---------------------------------------------------------------------------
// Wallet classification
// ---------------------------------------------------------------------------

/**
 * Wallet custody model.
 *  - `custodial`      — PaySwap holds the encrypted seed and signs.
 *  - `non_custodial`  — Customer holds the key; PaySwap only sees the
 *                       public address and may be granted delegated
 *                       signing authority for specific operations.
 *  - `hybrid`         — MPC custody: key split across PaySwap + customer
 *                       (or PaySwap + custodian). Neither party alone can
 *                       sign.
 */
export type WalletType = 'custodial' | 'non_custodial' | 'hybrid';

/**
 * Wallet lifecycle state.
 *  - `pending_activation` — created but not yet usable (KYC pending,
 *                            initial funding pending, etc.).
 *  - `active`             — fully operational.
 *  - `frozen`             — temporarily suspended (compliance hold,
 *                            suspected compromise, …). Funds are safe;
 *                            signing is blocked.
 *  - `closed`             — permanently shut. Funds swept out; the
 *                            encrypted seed is wiped.
 */
export type WalletState = 'active' | 'frozen' | 'closed' | 'pending_activation';

// ---------------------------------------------------------------------------
// HD wallet
// ---------------------------------------------------------------------------

/**
 * HD (Hierarchical Deterministic) wallet record.
 *
 * The encrypted seed is stored with `encryptedKeyStore`. Only the public
 * key + address are kept in this record (which is safe to log/project).
 * The seed is decrypted transiently inside `signWithWallet` and wiped
 * immediately after signing — it never leaves the encrypted store
 * unencrypted in steady state.
 */
export interface HDWallet {
  id: string;
  accountId: string;
  /** BIP-44 derivation path (e.g. `m/44'/148'/0'`). */
  derivationPath: string;
  /** Hex-encoded public key (safe to expose). */
  publicKey: string;
  /** Ciphertext blob from `encryptedKeyStore.store()`. */
  encryptedSeed: string;
  /** On-chain address derived from the public key. */
  address: string;
  /** Chain id (`stellar`, `ethereum`, `base`, …). */
  chain: string;
  /** Whether this is a custodial / non-custodial / hybrid wallet. */
  type: WalletType;
  state: WalletState;
  createdAt: number;
  /** Last key-rotation timestamp (if any). */
  keyRotatedAt?: number;
}

// ---------------------------------------------------------------------------
// Wallet policy
// ---------------------------------------------------------------------------

/**
 * Spending & access policy attached to a wallet. Enforced by
 * `WalletPolicyService.enforcePolicy()` before every withdrawal / signed
 * transaction. A transaction that violates any constraint throws
 * `WalletError('policy.violation')`.
 */
export interface WalletPolicy {
  walletId: string;
  /** Per-transaction spending cap (in the wallet's native asset units). */
  spendingLimitPerTx: number;
  /** Aggregate spending cap over a rolling 24h window. */
  dailySpendingLimit: number;
  /** Aggregate spending cap over a rolling 30d window. */
  monthlySpendingLimit: number;
  /** Whitelist of chain ids this wallet may transact on. */
  allowedChains: string[];
  /** Whitelist of asset codes this wallet may hold / send. */
  allowedAssets: string[];
  /** Whether MFA is required before every withdrawal. */
  requireMFA: boolean;
  /** Withdrawals above this amount require explicit approver sign-off. */
  requireApprovalAbove: number;
  /** Whitelist of permitted destination addresses. Empty = unrestricted. */
  whitelistedAddresses: string[];
  /** When the policy was last updated. */
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Withdrawal request
// ---------------------------------------------------------------------------

export type WithdrawalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'failed';

/**
 * Withdrawal request — created by the account holder, approved by an
 * authorised approver (when amount > policy.requireApprovalAbove),
 * executed by `WithdrawalService.executeWithdrawal` via the chain
 * adapter.
 */
export interface WithdrawalRequest {
  id: string;
  walletId: string;
  amount: number;
  asset: string;
  /** Destination on-chain address. */
  destination: string;
  requestedAt: number;
  status: WithdrawalStatus;
  /** Approver who signed off (set when status moves to approved). */
  approvedBy?: string;
  approvedAt?: number;
  /** Rejection reason (set when status moves to rejected). */
  rejectionReason?: string;
  rejectedBy?: string;
  rejectedAt?: number;
  /** Set when the chain adapter confirms the withdrawal transaction. */
  executedAt?: number;
  /** On-chain transaction hash (set on success). */
  txHash?: string;
  /** Execution failure reason (set when status moves to failed). */
  failureReason?: string;
}

// ---------------------------------------------------------------------------
// Key rotation
// ---------------------------------------------------------------------------

/**
 * Audit record for a key-rotation event. The old key is never retained
 * in plaintext — only its hash is kept so the audit trail can prove
 * "the old key was X" without being able to use X.
 */
export interface KeyRotationRecord {
  id: string;
  walletId: string;
  rotatedAt: number;
  rotatedBy: string;
  reason: string;
  /** SHA-256 hash of the previous seed (hex). */
  oldKeyHash: string;
  /** SHA-256 hash of the new seed (hex). */
  newKeyHash: string;
}

// ---------------------------------------------------------------------------
// Delegated signing
// ---------------------------------------------------------------------------

/**
 * Delegated signing grant — a non-custodial wallet owner authorises
 * PaySwap (or another delegatee) to sign specific operations on their
 * behalf for a bounded time. The wallet's private key never leaves the
 * owner's custody; the delegation is a logical authorisation, not a key
 * transfer.
 */
export interface DelegatedSigning {
  id: string;
  walletId: string;
  /** Entity granted signing authority. */
  delegateeId: string;
  /** Operation codes this delegation covers (e.g. `withdraw.usd`, `trade.*`). */
  permissions: string[];
  /** Grant start timestamp. */
  signedAt: number;
  /** Grant expiry timestamp. */
  expiresAt: number;
  /** Set when the delegation is revoked early. */
  revokedAt?: number;
  /** Optional revocation reason. */
  revocationReason?: string;
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export type RecoveryMethod = 'mnemonic' | 'social' | 'admin';
export type RecoveryStatus = 'pending' | 'verified' | 'completed' | 'rejected';

/**
 * Wallet recovery request. Three recovery paths are supported:
 *  - `mnemonic` — customer re-enters their 24-word seed phrase.
 *  - `social`   — M-of-N guardian signatures (e.g. 3 of 5 friends).
 *  - `admin`    — admin override (audited, used only when the other
 *                 two paths are unavailable).
 *
 * On `completed`, a new key is rotated in and the old key is wiped.
 */
export interface RecoveryRequest {
  id: string;
  walletId: string;
  method: RecoveryMethod;
  status: RecoveryStatus;
  initiatedAt: number;
  /** Set when the recovery completes (new key rotated in). */
  completedAt?: number;
  /** Set when the recovery is rejected (e.g. failed guardian M-of-N). */
  rejectedAt?: number;
  rejectionReason?: string;
  /** For `admin` recovery: the admin who authorised. */
  adminId?: string;
  /** For `admin` recovery: the reason given. */
  adminReason?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Error thrown by any wallet gate when the check fails. Carries a
 * structured `code` so the API layer can render a meaningful response.
 */
export class WalletError extends Error {
  readonly code: string;
  readonly walletId?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    opts?: { walletId?: string; details?: Record<string, unknown> } & Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WalletError';
    this.code = code;
    this.walletId = opts?.walletId;
    this.details = opts as Record<string, unknown> | undefined;
  }
}

// ---------------------------------------------------------------------------
// Transaction shape consumed by the policy engine
// ---------------------------------------------------------------------------

/**
 * Minimal transaction shape consumed by the wallet policy engine. The
 * upstream payment / withdrawal flow projects its richer transaction
 * type into this shape before calling `enforcePolicy`.
 */
export interface WalletTx {
  walletId: string;
  amount: number;
  asset: string;
  chain: string;
  destination: string;
  ts: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of words in a BIP-39 mnemonic (24 = 256 bits of entropy). */
export const MNEMONIC_WORD_COUNT = 24;

/** Entropy bytes for a 24-word mnemonic (256 bits / 8 = 32 bytes). */
export const MNEMONIC_ENTROPY_BYTES = 32;

/** scrypt parameters for master-key derivation (N=2^17 is production-grade). */
export const SCRYPT_PARAMS = {
  N: 131_072, // 2^17
  r: 8,
  p: 1,
  keylen: 32, // 256-bit master key
} as const;

/** AES-256-GCM auth tag length (bytes). */
export const GCM_AUTH_TAG_BYTES = 16;

/** AES-256-GCM IV length (bytes) — 96-bit IV is the GCM standard. */
export const GCM_IV_BYTES = 12;

/** Default per-tx spending limit if no policy is set. */
export const DEFAULT_SPENDING_LIMIT_PER_TX = 10_000;

/** Default daily spending limit if no policy is set. */
export const DEFAULT_DAILY_SPENDING_LIMIT = 50_000;

/** Default monthly spending limit if no policy is set. */
export const DEFAULT_MONTHLY_SPENDING_LIMIT = 500_000;

/** Default `requireApprovalAbove` threshold if no policy is set. */
export const DEFAULT_REQUIRE_APPROVAL_ABOVE = 5_000;

/** Default M-of-N threshold for social recovery. */
export const DEFAULT_SOCIAL_RECOVERY_THRESHOLD = 3;

/** Default number of guardians for social recovery. */
export const DEFAULT_SOCIAL_RECOVERY_GUARDIANS = 5;

/** Rolling window lengths (ms) used by the policy engine. */
export const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MONTHLY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
