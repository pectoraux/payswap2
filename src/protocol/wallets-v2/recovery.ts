/**
 * PaySwap Protocol — Wallet Recovery Service.
 *
 * Three recovery paths for a locked-out customer (lost device, lost
 * mnemonic backup, suspected compromise requiring key reset):
 *
 *  1. `mnemonic` — the customer re-enters their 24-word seed phrase.
 *     If it matches the stored mnemonic backup, recovery is verified
 *     and a fresh key can be rotated in.
 *
 *  2. `social`   — M-of-N guardian signatures. The customer pre-
 *     designated N guardians (e.g. 5 friends / family); recovery
 *     requires M of them (default 3 of 5) to co-sign. This is the
 *     "social recovery" pattern from Ethereum account abstraction
 *     (ERC-4337) and Vitalic's "social recovery wallet" proposal.
 *
 *  3. `admin`    — admin override. Audited heavily. Used only when
 *     the other two paths are unavailable (e.g. customer lost both
 *     their mnemonic AND their guardian list). Requires two-person
 *     approval in production.
 *
 * All three paths converge on `completeRecovery()`, which:
 *   - Verifies the chosen recovery method.
 *   - Rotates the wallet's key (`keyRotationService.rotateKey`).
 *   - Optionally injects a customer-supplied new seed (if the
 *     customer wants to restore from a different mnemonic).
 *   - Marks the recovery `completed` and emits
 *     `wallet.recovery_completed`.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `wallet.recovery_initiated`
 *  - `wallet.recovery_verified`
 *  - `wallet.recovery_completed`
 *  - `wallet.recovery_rejected`
 *
 * The kernel is FROZEN — this module only imports `uid`, `nowTs` from
 * `@/kernel/support`, `eventEngine` from `@/kernel/event`, and uses
 * `hdWalletService` + `keyRotationService` + `WalletError`.
 */
import * as crypto from 'crypto';
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { hdWalletService } from './hd-wallet';
import { keyRotationService } from './key-rotation';
import { EncryptedKeyStore } from './encrypted-storage';
import {
  DEFAULT_SOCIAL_RECOVERY_GUARDIANS,
  DEFAULT_SOCIAL_RECOVERY_THRESHOLD,
  MNEMONIC_WORD_COUNT,
  WalletError,
  type RecoveryMethod,
  type RecoveryRequest,
} from './types';

/** Guardian record (for social recovery). */
export interface Guardian {
  id: string;
  publicKey: string;
}

/** Result of `verifyMnemonic`. */
export interface VerifyMnemonicResult {
  verified: boolean;
  recoveryId: string;
  /** Number of matching words (out of 24). */
  matchedWords: number;
}

/** Result of `verifySocial`. */
export interface VerifySocialResult {
  verified: boolean;
  recoveryId: string;
  signaturesProvided: number;
  thresholdRequired: number;
}

export class RecoveryService {
  private requests = new Map<string, RecoveryRequest>();
  /** walletId → guardians[] (registered for social recovery). */
  private guardiansByWallet = new Map<string, Guardian[]>();
  /** walletId → recoveryId[] (history). */
  private byWallet = new Map<string, string[]>();
  /** Social recovery thresholds per wallet (M-of-N). */
  private thresholdsByWallet = new Map<string, { m: number; n: number }>();
  /** Verified-but-not-completed recovery requests (per recoveryId). */
  private verified = new Set<string>();

  // ------------------------------------------------- registerGuardians
  /**
   * Register the guardian set for social recovery of a wallet.
   * Customer pre-designates N guardians; recovery requires M-of-N
   * signatures. Defaults to 3-of-5.
   */
  registerGuardians(
    walletId: string,
    guardians: Guardian[],
    threshold?: { m: number; n: number },
  ): { m: number; n: number } {
    const n = guardians.length;
    if (n < 2) throw new WalletError('recovery.too_few_guardians', 'Need at least 2 guardians');
    const m = threshold?.m ?? Math.min(DEFAULT_SOCIAL_RECOVERY_THRESHOLD, n);
    if (m < 1 || m > n) {
      throw new WalletError('recovery.bad_threshold', `M=${m} invalid for N=${n}`);
    }
    this.guardiansByWallet.set(walletId, [...guardians]);
    this.thresholdsByWallet.set(walletId, { m, n });
    eventEngine.emit('wallet.recovery_guardians_registered', { walletId, m, n });
    return { m, n };
  }

  // ------------------------------------------------- getGuardians
  getGuardians(walletId: string): Guardian[] {
    return [...(this.guardiansByWallet.get(walletId) ?? [])];
  }

  // ------------------------------------------------- initiateRecovery
  /**
   * Start a recovery request. The request is created in `pending`
   * state; the caller then runs one of the verify* methods to move it
   * to `verified`, then calls `completeRecovery` to finish.
   */
  initiateRecovery(walletId: string, method: RecoveryMethod): RecoveryRequest {
    const wallet = hdWalletService.getWallet(walletId);
    if (!wallet) {
      throw new WalletError('recovery.wallet_not_found', `Wallet ${walletId} not found`);
    }

    const id = uid('rec');
    const request: RecoveryRequest = {
      id,
      walletId,
      method,
      status: 'pending',
      initiatedAt: nowTs(),
    };
    this.requests.set(id, request);
    const list = this.byWallet.get(walletId) ?? [];
    list.push(id);
    this.byWallet.set(walletId, list);

    eventEngine.emit('wallet.recovery_initiated', {
      recoveryId: id,
      walletId,
      method,
    });
    return request;
  }

  // ------------------------------------------------- verifyMnemonic
  /**
   * Verify a 24-word mnemonic against the wallet's stored backup.
   * On success the recovery moves to `verified`. On failure the
   * recovery is `rejected`.
   */
  verifyMnemonic(walletId: string, mnemonicWords: string[]): VerifyMnemonicResult {
    const request = this.findPendingRequest(walletId, 'mnemonic');
    if (!request) {
      throw new WalletError('recovery.no_pending', `No pending mnemonic recovery for wallet ${walletId}`);
    }
    if (mnemonicWords.length !== MNEMONIC_WORD_COUNT) {
      this.reject(request.id, `Expected ${MNEMONIC_WORD_COUNT} words, got ${mnemonicWords.length}`);
      throw new WalletError(
        'recovery.bad_mnemonic_length',
        `Expected ${MNEMONIC_WORD_COUNT} words, got ${mnemonicWords.length}`,
      );
    }

    const backup = hdWalletService.getMnemonicBackup(walletId);
    if (!backup) {
      this.reject(request.id, 'No mnemonic backup available for wallet');
      throw new WalletError('recovery.no_backup', `No mnemonic backup for wallet ${walletId}`);
    }

    let matched = 0;
    for (let i = 0; i < MNEMONIC_WORD_COUNT; i++) {
      if ((mnemonicWords[i] ?? '').toLowerCase().trim() === (backup[i] ?? '').toLowerCase().trim()) {
        matched += 1;
      }
    }

    if (matched === MNEMONIC_WORD_COUNT) {
      request.status = 'verified';
      this.verified.add(request.id);
      eventEngine.emit('wallet.recovery_verified', {
        recoveryId: request.id,
        walletId,
        method: 'mnemonic',
      });
      return { verified: true, recoveryId: request.id, matchedWords: matched };
    }

    this.reject(request.id, `Mnemonic verification failed: ${matched}/${MNEMONIC_WORD_COUNT} words matched`);
    return { verified: false, recoveryId: request.id, matchedWords: matched };
  }

  // ------------------------------------------------- verifySocial
  /**
   * Verify social recovery: M-of-N guardians must each provide a
   * valid signature over a recovery challenge. The challenge is the
   * recoveryId; each guardian signs it with their private key (the
   * signature is verified against the guardian's registered public
   * key).
   */
  verifySocial(
    walletId: string,
    guardianSignatures: { guardianId: string; signature: string }[],
  ): VerifySocialResult {
    const request = this.findPendingRequest(walletId, 'social');
    if (!request) {
      throw new WalletError('recovery.no_pending', `No pending social recovery for wallet ${walletId}`);
    }
    const guardians = this.guardiansByWallet.get(walletId) ?? [];
    const threshold = this.thresholdsByWallet.get(walletId) ?? {
      m: DEFAULT_SOCIAL_RECOVERY_THRESHOLD,
      n: DEFAULT_SOCIAL_RECOVERY_GUARDIANS,
    };
    if (guardians.length === 0) {
      this.reject(request.id, 'No guardians registered for wallet');
      throw new WalletError('recovery.no_guardians', `No guardians registered for wallet ${walletId}`);
    }

    const guardianMap = new Map(guardians.map((g) => [g.id, g]));
    let validSignatures = 0;
    const seenGuardian = new Set<string>();
    const challenge = Buffer.from(request.id, 'utf8');

    for (const { guardianId, signature } of guardianSignatures) {
      if (seenGuardian.has(guardianId)) continue;
      const guardian = guardianMap.get(guardianId);
      if (!guardian) continue;
      try {
        const sigBuf = Buffer.from(signature, 'hex');
        const pub = Buffer.from(guardian.publicKey, 'hex');
        if (crypto.verify(null, challenge, pub, sigBuf)) {
          validSignatures += 1;
          seenGuardian.add(guardianId);
        }
      } catch {
        // Malformed signature — skip.
      }
    }

    if (validSignatures >= threshold.m) {
      request.status = 'verified';
      this.verified.add(request.id);
      eventEngine.emit('wallet.recovery_verified', {
        recoveryId: request.id,
        walletId,
        method: 'social',
        signatures: validSignatures,
        threshold: threshold.m,
      });
      return { verified: true, recoveryId: request.id, signaturesProvided: validSignatures, thresholdRequired: threshold.m };
    }

    this.reject(
      request.id,
      `Social recovery failed: ${validSignatures}/${threshold.m} valid guardian signatures`,
    );
    return {
      verified: false,
      recoveryId: request.id,
      signaturesProvided: validSignatures,
      thresholdRequired: threshold.m,
    };
  }

  // ------------------------------------------------- adminRecover
  /**
   * Admin override recovery. Records the admin id + reason and
   * immediately marks the request `verified`. Heavily audited —
   * production deployments require two-person approval before this
   * method is callable.
   */
  adminRecover(walletId: string, adminId: string, reason: string): RecoveryRequest {
    const request = this.findPendingRequest(walletId, 'admin');
    if (!request) {
      throw new WalletError('recovery.no_pending', `No pending admin recovery for wallet ${walletId}`);
    }
    if (!adminId) throw new WalletError('recovery.bad_admin', 'adminId is required');
    if (!reason || reason.length < 10) {
      throw new WalletError('recovery.bad_reason', 'reason must be at least 10 chars');
    }

    request.adminId = adminId;
    request.adminReason = reason;
    request.status = 'verified';
    this.verified.add(request.id);

    eventEngine.emit('wallet.recovery_verified', {
      recoveryId: request.id,
      walletId,
      method: 'admin',
      adminId,
      reason,
    });
    return request;
  }

  // ------------------------------------------------- completeRecovery
  /**
   * Complete a verified recovery: rotate the wallet's key (and
   * optionally inject a customer-supplied new mnemonic). The old
   * key is wiped and its hash retained in the rotation audit trail.
   */
  completeRecovery(
    recoveryId: string,
    newSeed?: string,
    opts?: { masterKey?: string; rotatedBy?: string },
  ): { recovery: RecoveryRequest; rotationId: string } {
    const request = this.requests.get(recoveryId);
    if (!request) {
      throw new WalletError('recovery.not_found', `Recovery ${recoveryId} not found`);
    }
    if (request.status !== 'verified') {
      throw new WalletError(
        'recovery.not_verified',
        `Recovery ${recoveryId} is in status ${request.status} — must be 'verified' to complete`,
      );
    }
    if (!this.verified.has(recoveryId)) {
      throw new WalletError('recovery.not_verified', `Recovery ${recoveryId} not in verified set`);
    }

    const masterKey = opts?.masterKey ?? EncryptedKeyStore.loadMasterSecret();
    const rotatedBy = opts?.rotatedBy ?? `recovery:${request.method}`;

    // If the customer supplied a new mnemonic, use it directly; else
    // generate a fresh one via keyRotationService.rotateKey.
    let rotationId: string;
    if (newSeed) {
      rotationId = this.rotateWithCustomerSeed(request.walletId, newSeed, masterKey, `recovery:${request.method}`, rotatedBy);
    } else {
      const rotation = keyRotationService.rotateKey(
        request.walletId,
        `recovery:${request.method}`,
        rotatedBy,
        { masterKey },
      );
      rotationId = rotation.id;
    }

    request.status = 'completed';
    request.completedAt = nowTs();
    this.verified.delete(recoveryId);

    eventEngine.emit('wallet.recovery_completed', {
      recoveryId,
      walletId: request.walletId,
      method: request.method,
      rotationId,
    });
    return { recovery: request, rotationId };
  }

  // ------------------------------------------------- getRecovery / listRecoveries
  getRecovery(recoveryId: string): RecoveryRequest | undefined {
    return this.requests.get(recoveryId);
  }

  listRecoveries(walletId?: string): RecoveryRequest[] {
    const all = [...this.requests.values()];
    return walletId ? all.filter((r) => r.walletId === walletId) : all;
  }

  // ------------------------------------------------- helpers
  private findPendingRequest(walletId: string, method: RecoveryMethod): RecoveryRequest | undefined {
    const ids = this.byWallet.get(walletId) ?? [];
    for (let i = ids.length - 1; i >= 0; i--) {
      const r = this.requests.get(ids[i]);
      if (r && r.status === 'pending' && r.method === method) return r;
    }
    return undefined;
  }

  private reject(recoveryId: string, reason: string): void {
    const r = this.requests.get(recoveryId);
    if (!r) return;
    r.status = 'rejected';
    r.rejectedAt = nowTs();
    r.rejectionReason = reason;
    this.verified.delete(recoveryId);
    eventEngine.emit('wallet.recovery_rejected', {
      recoveryId,
      walletId: r.walletId,
      method: r.method,
      reason,
    });
  }

  /**
   * Rotate a wallet's key with a customer-supplied seed (used when
   * the customer wants to restore from a known mnemonic).
   */
  private rotateWithCustomerSeed(
    walletId: string,
    newSeed: string,
    masterKey: string,
    reason: string,
    rotatedBy: string,
  ): string {
    const wallet = hdWalletService.getWallet(walletId);
    if (!wallet) {
      throw new WalletError('recovery.wallet_not_found', `Wallet ${walletId} not found`);
    }

    // Hash the old encrypted record (audit trail).
    const oldEncrypted = encryptedKeyStoreGetRecord(walletId);
    const oldKeyHash = oldEncrypted
      ? crypto
          .createHash('sha256')
          .update(`${oldEncrypted.iv}|${oldEncrypted.salt}|${oldEncrypted.ciphertext}|${oldEncrypted.tag}`)
          .digest('hex')
      : '0'.repeat(64);

    // Derive the new key pair from the customer-supplied seed.
    const newDerived = hdWalletService.deriveKeyPair(newSeed, wallet.derivationPath);
    const newKeyHash = crypto.createHash('sha256').update(newSeed).digest('hex');

    // Wipe old seed, store new.
    encryptedKeyStoreDelete(walletId);
    encryptedKeyStore.store(walletId, newSeed, masterKey);

    // Update wallet record.
    wallet.publicKey = newDerived.publicKey;
    wallet.address = newDerived.address;
    wallet.encryptedSeed = JSON.stringify(encryptedKeyStore.getRecord(walletId));
    wallet.keyRotatedAt = nowTs();

    newDerived.privateKey = '0'.repeat(64);

    // Record the rotation via the key-rotation service so the audit
    // trail includes this event.
    const rotationId = keyRotationRecordViaService(walletId, reason, rotatedBy, oldKeyHash, newKeyHash);
    return rotationId;
  }
}

// Imported here to avoid circular import in the helper functions.
import { encryptedKeyStore } from './encrypted-storage';
function encryptedKeyStoreGetRecord(walletId: string) {
  return encryptedKeyStore.getRecord(walletId);
}
function encryptedKeyStoreDelete(walletId: string) {
  encryptedKeyStore.delete(walletId);
}

/**
 * Append a rotation record to the key-rotation service's history
 * without re-running `rotateKey` (we've already done the actual
 * rotation; we just need the audit record).
 *
 * We do this by calling `keyRotationService.rotateKey` is NOT what we
 * want — that would generate yet another fresh seed. Instead, we
 * accept that this audit entry is "manual" and emit the event
 * directly. The history is queryable via
 * `recoveryService.listRecoveries()` + the emitted event.
 */
function keyRotationRecordViaService(
  walletId: string,
  reason: string,
  rotatedBy: string,
  oldKeyHash: string,
  newKeyHash: string,
): string {
  const id = uid('rot');
  eventEngine.emit('wallet.key_rotated', {
    rotationId: id,
    walletId,
    reason,
    rotatedBy,
    oldKeyHash,
    newKeyHash,
    source: 'recovery',
  });
  return id;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForRecovery = globalThis as unknown as { __PAYSWAP_RECOVERY_SERVICE?: RecoveryService };
export const recoveryService =
  _globalForRecovery.__PAYSWAP_RECOVERY_SERVICE ?? new RecoveryService();
if (!_globalForRecovery.__PAYSWAP_RECOVERY_SERVICE) {
  _globalForRecovery.__PAYSWAP_RECOVERY_SERVICE = recoveryService;
}
