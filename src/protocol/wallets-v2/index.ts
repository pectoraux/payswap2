/**
 * PaySwap Protocol — Production Wallet Infrastructure (wallets-v2).
 *
 * Drop-in production wallet module for a regulated financial
 * institution:
 *  - HD wallets (BIP-39 mnemonic + BIP-32 derivation, Ed25519)
 *  - MPC (threshold-ECDSA / threshold-Ed25519) abstraction
 *  - Custodial + non-custodial + hybrid wallet custody models
 *  - Key rotation (scheduled + on-demand, old keys wiped)
 *  - Encrypted at-rest storage (AES-256-GCM + scrypt)
 *  - Recovery flows (mnemonic / social M-of-N / admin override)
 *  - Delegated signing (non-custodial wallets)
 *  - Wallet policies (spending limits, chain/asset/destination
 *    whitelists, MFA, approval thresholds)
 *  - Withdrawal approval flow (request → approve → execute)
 *
 * DESIGN PRINCIPLE — **private keys never leave the encrypted store
 * unencrypted**:
 *
 *   - The HD wallet seed is encrypted with AES-256-GCM under a master
 *     key derived (scrypt, N=2^17) from an environment secret. The
 *     encrypted blob is the only persistent representation.
 *   - `signWithWallet` decrypts the seed in-memory, signs, then
 *     zeroes the seed buffer. The seed is never logged, never
 *     persisted in plaintext, never returned from any API.
 *   - Key rotation generates a fresh seed, re-encrypts it, wipes the
 *     old encrypted record, and retains only the SHA-256 hash of the
 *     old key for audit.
 *   - MPC custody: the full private key is NEVER materialised —
 *     shares are kept by separate parties and combined only into a
 *     signature (never into the key itself).
 *
 * PUBLIC CONTRACT (stable, drop-in ready):
 *  - HD: `hdWalletService.createHDWallet / signWithWallet / deriveChild`
 *  - MPC: `mpcService.initiateKeyGeneration / completeKeyGeneration / initiateSigning / completeSigning`
 *  - Custodial: `custodialWalletService.createCustodialWallet / freezeWallet / closeWallet`
 *  - Non-custodial: `nonCustodialWalletService.registerExternalWallet / requestDelegatedSigning / revokeDelegation`
 *  - Key rotation: `keyRotationService.rotateKey / scheduleRotation`
 *  - Recovery: `recoveryService.initiateRecovery / verifyMnemonic / verifySocial / adminRecover / completeRecovery`
 *  - Policies: `walletPolicyService.setPolicy / enforcePolicy / addToWhitelist`
 *  - Withdrawals: `withdrawalService.requestWithdrawal / approveWithdrawal / executeWithdrawal`
 *
 * PROVIDER-READINESS:
 *  - HD: replace `ed25519FromSeed` + `signEd25519` with `@noble/ed25519`
 *    + `@scure/bip32-ed25519` (SLIP-0010). Public contract unchanged.
 *  - MPC: replace the simulated `deriveShare` / `completeSigning` with
 *    a real threshold-ECDSA library (Silence Laboratories, Torus,
 *    Fireblocks, Lit Protocol). Public contract unchanged.
 *  - Encrypted store: replace the in-memory `Map` with a Postgres /
 *    Vault / KMS-backed implementation. The `EncryptedRecord` shape
 *    is JSON-serialisable and portable.
 *  - Chain executor: `withdrawalService.setExecutor(adapter)` plugs
 *    in any chain adapter that implements the `WithdrawalExecutor`
 *    interface (or auto-resolves via `chainRegistry`).
 *
 * The kernel is FROZEN — this module only imports `uid`, `nowTs`
 * from `@/kernel/support`, `eventEngine` from `@/kernel/event`, and
 * uses Node built-in `crypto`. No kernel files are modified.
 */
export * from './types';

export {
  HDWalletService,
  hdWalletService,
  BIP39_WORDLIST,
  type DerivedKeyPair,
  type CreatedHDWallet,
} from './hd-wallet';

export {
  MPCService,
  mpcService,
  type MPCSessionStatus,
  type MPCSigningStatus,
  type MPCParticipant,
  type MPCKeyGenSession,
  type MPCSigningSession,
} from './mpc';

export {
  EncryptedKeyStore,
  encryptedKeyStore,
  MASTER_SECRET_ENV_VAR,
  type EncryptedRecord,
} from './encrypted-storage';

export {
  CustodialWalletService,
  custodialWalletService,
  type CustodialBalance,
  type CustodialWalletRecord,
} from './custodial';

export {
  NonCustodialWalletService,
  nonCustodialWalletService,
  type NonCustodialWalletRecord,
} from './non-custodial';

export {
  KeyRotationService,
  keyRotationService,
  type ScheduledRotation,
} from './key-rotation';

export {
  RecoveryService,
  recoveryService,
  type Guardian,
  type VerifyMnemonicResult,
  type VerifySocialResult,
} from './recovery';

export {
  WalletPolicyService,
  walletPolicyService,
} from './policies';

export {
  WithdrawalService,
  withdrawalService,
  type WithdrawalFilter,
  type WithdrawalExecutor,
} from './withdrawals';

// ---------------------------------------------------------------------------
// Convenience: create a fully-configured custodial wallet with policy
// ---------------------------------------------------------------------------

import { custodialWalletService } from './custodial';
import { walletPolicyService } from './policies';
import {
  DEFAULT_DAILY_SPENDING_LIMIT,
  DEFAULT_MONTHLY_SPENDING_LIMIT,
  DEFAULT_REQUIRE_APPROVAL_ABOVE,
  DEFAULT_SPENDING_LIMIT_PER_TX,
  type WalletPolicy,
} from './types';

/**
 * One-shot helper: create a custodial wallet, activate it, and apply
 * a default policy. Returns the walletId + policy. This is the
 * function the merchant-onboarding flow calls when a new merchant
 * signs up.
 */
export function provisionCustodialWallet(
  accountId: string,
  chain: string,
  opts?: {
    spendingLimitPerTx?: number;
    dailySpendingLimit?: number;
    monthlySpendingLimit?: number;
    allowedChains?: string[];
    allowedAssets?: string[];
    requireMFA?: boolean;
    requireApprovalAbove?: number;
    whitelistedAddresses?: string[];
  },
): { walletId: string; address: string; policy: WalletPolicy } {
  const record = custodialWalletService.createCustodialWallet(accountId, chain);
  custodialWalletService.activateWallet(record.wallet.id);
  const policy = walletPolicyService.setPolicy(record.wallet.id, {
    spendingLimitPerTx: opts?.spendingLimitPerTx ?? DEFAULT_SPENDING_LIMIT_PER_TX,
    dailySpendingLimit: opts?.dailySpendingLimit ?? DEFAULT_DAILY_SPENDING_LIMIT,
    monthlySpendingLimit: opts?.monthlySpendingLimit ?? DEFAULT_MONTHLY_SPENDING_LIMIT,
    allowedChains: opts?.allowedChains ?? [chain],
    allowedAssets: opts?.allowedAssets ?? [],
    requireMFA: opts?.requireMFA ?? false,
    requireApprovalAbove: opts?.requireApprovalAbove ?? DEFAULT_REQUIRE_APPROVAL_ABOVE,
    whitelistedAddresses: opts?.whitelistedAddresses ?? [],
  });
  return { walletId: record.wallet.id, address: record.wallet.address, policy };
}
