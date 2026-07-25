/**
 * PaySwap Protocol — Key Rotation Service.
 *
 * Periodic / on-demand rotation of HD wallet seeds. Generates a new
 * seed, re-encrypts it with the master key, and stores the new
 * ciphertext. The OLD seed is wiped from `encryptedKeyStore` and only
 * its SHA-256 hash is retained in the audit trail (`KeyRotationRecord`)
 * — so the audit can prove "the old key was X" without being able to
 * use X.
 *
 * Reasons to rotate:
 *  - Scheduled (every 90 days, e.g.).
 *  - Suspected compromise (security incident).
 *  - Customer request (paranoid rotation).
 *  - Compliance (regulator-mandated rotation cadence).
 *
 * After rotation:
 *  - The wallet's `publicKey` and `address` change (new key = new
 *    address). Customers must be notified to use the new address for
 *    deposits.
 *  - The wallet's `keyRotatedAt` is updated.
 *  - The old encrypted seed is securely deleted from
 *    `encryptedKeyStore`.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `wallet.key_rotated`
 *  - `wallet.key_rotation_scheduled`
 *  - `wallet.key_rotation_unscheduled`
 *
 * The kernel is FROZEN — this module only imports `uid`, `nowTs` from
 * `@/kernel/support`, `eventEngine` from `@/kernel/event`, and uses
 * `hdWalletService` + `encryptedKeyStore` + `WalletError`.
 */
import * as crypto from 'crypto';
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { hdWalletService } from './hd-wallet';
import { encryptedKeyStore, EncryptedKeyStore } from './encrypted-storage';
import {
  WalletError,
  type HDWallet,
  type KeyRotationRecord,
} from './types';

/** Scheduled rotation descriptor (returned by `scheduleRotation`). */
export interface ScheduledRotation {
  id: string;
  walletId: string;
  intervalMs: number;
  lastRunAt: number;
  nextRunAt: number;
  /** Active timer handle (kept internal). */
  timer: ReturnType<typeof setInterval>;
  /** Whether the schedule is still active. */
  active: boolean;
}

export class KeyRotationService {
  private rotations = new Map<string, KeyRotationRecord>();
  /** walletId → KeyRotationRecord[] (history). */
  private byWallet = new Map<string, KeyRotationRecord[]>();
  private scheduled = new Map<string, ScheduledRotation>();

  // ------------------------------------------------- rotateKey
  /**
   * Rotate a wallet's key: generate a new seed, re-encrypt, store,
   * wipe the old seed, record the rotation, emit
   * `wallet.key_rotated`.
   *
   * The wallet record's `publicKey`, `address`, and `encryptedSeed`
   * are updated. `keyRotatedAt` is set to `now`.
   */
  rotateKey(
    walletId: string,
    reason: string,
    rotatedBy: string,
    opts?: { masterKey?: string },
  ): KeyRotationRecord {
    const wallet = hdWalletService.getWallet(walletId);
    if (!wallet) {
      throw new WalletError('rotation.wallet_not_found', `Wallet ${walletId} not found`, { walletId });
    }
    if (wallet.state === 'closed') {
      throw new WalletError('rotation.wallet_closed', `Wallet ${walletId} is closed`, { walletId });
    }

    const masterKey = opts?.masterKey ?? EncryptedKeyStore.loadMasterSecret();

    // 1. Hash the OLD seed (for the audit trail). We hash the
    //    encrypted record itself — the plaintext seed is never
    //    re-read for this purpose. The hash proves "the old key was
    //    X" without exposing X.
    const oldEncrypted = encryptedKeyStore.getRecord(walletId);
    const oldKeyHash = oldEncrypted
      ? crypto
          .createHash('sha256')
          .update(`${oldEncrypted.iv}|${oldEncrypted.salt}|${oldEncrypted.ciphertext}|${oldEncrypted.tag}`)
          .digest('hex')
      : '0'.repeat(64);

    // 2. Generate a new mnemonic + derive a new key pair.
    const newMnemonicWords = hdWalletService.generateSeed();
    const newMnemonic = newMnemonicWords.join(' ');
    const newDerived = hdWalletService.deriveKeyPair(newMnemonic, wallet.derivationPath);

    // 3. Hash the NEW seed (for the audit trail).
    const newKeyHash = crypto.createHash('sha256').update(newMnemonic).digest('hex');

    // 4. Wipe the OLD seed from the encrypted store.
    encryptedKeyStore.delete(walletId);

    // 5. Store the NEW seed encrypted.
    encryptedKeyStore.store(walletId, newMnemonic, masterKey);

    // 6. Update the wallet record.
    wallet.publicKey = newDerived.publicKey;
    wallet.address = newDerived.address;
    wallet.encryptedSeed = JSON.stringify(encryptedKeyStore.getRecord(walletId));
    wallet.keyRotatedAt = nowTs();

    // Zero the derived private key reference.
    newDerived.privateKey = '0'.repeat(64);

    // 7. Record the rotation.
    const id = uid('rot');
    const record: KeyRotationRecord = {
      id,
      walletId,
      rotatedAt: nowTs(),
      rotatedBy,
      reason,
      oldKeyHash,
      newKeyHash,
    };
    this.rotations.set(id, record);
    const list = this.byWallet.get(walletId) ?? [];
    list.push(record);
    this.byWallet.set(walletId, list);

    eventEngine.emit('wallet.key_rotated', {
      rotationId: id,
      walletId,
      reason,
      rotatedBy,
      oldKeyHash,
      newKeyHash,
    });
    return record;
  }

  // ------------------------------------------------- getRotationHistory
  getRotationHistory(walletId: string): KeyRotationRecord[] {
    return [...(this.byWallet.get(walletId) ?? [])];
  }

  // ------------------------------------------------- getLastRotation
  getLastRotation(walletId: string): KeyRotationRecord | undefined {
    const history = this.byWallet.get(walletId) ?? [];
    if (history.length === 0) return undefined;
    return history[history.length - 1];
  }

  // ------------------------------------------------- scheduleRotation
  /**
   * Schedule periodic auto-rotation. Every `intervalMs`, the wallet's
   * key is rotated with reason `scheduled_rotation`. Returns a
   * `ScheduledRotation` descriptor; pass it to `unscheduleRotation`
   * to cancel.
   *
   * NOTE: In a serverless / Next.js environment, this timer is held
   * in-memory only — for production durability, the schedule should
   * be persisted (e.g. in Postgres) and a worker should re-arm the
   * timer on cold start. The contract here is the same.
   */
  scheduleRotation(
    walletId: string,
    intervalMs: number,
    opts?: { rotatedBy?: string; masterKey?: string },
  ): ScheduledRotation {
    if (intervalMs < 60_000) {
      throw new WalletError('rotation.bad_interval', 'interval must be >= 60s');
    }
    if (this.scheduled.has(walletId)) {
      throw new WalletError('rotation.already_scheduled', `Wallet ${walletId} already has a scheduled rotation`);
    }
    const id = uid('sched');
    const now = nowTs();
    const rotatedBy = opts?.rotatedBy ?? 'system';
    const masterKey = opts?.masterKey ?? EncryptedKeyStore.loadMasterSecret();

    const timer = setInterval(() => {
      try {
        this.rotateKey(walletId, 'scheduled_rotation', rotatedBy, { masterKey });
      } catch (err) {
        eventEngine.emit('wallet.key_rotation_failed', {
          walletId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, intervalMs);
    // Don't keep the event loop alive forever.
    if (typeof timer.unref === 'function') timer.unref();

    const scheduled: ScheduledRotation = {
      id,
      walletId,
      intervalMs,
      lastRunAt: now,
      nextRunAt: now + intervalMs,
      timer,
      active: true,
    };
    this.scheduled.set(walletId, scheduled);

    eventEngine.emit('wallet.key_rotation_scheduled', { walletId, intervalMs, nextRunAt: scheduled.nextRunAt });
    return scheduled;
  }

  // ------------------------------------------------- unscheduleRotation
  /** Cancel a previously-scheduled rotation. */
  unscheduleRotation(walletId: string): boolean {
    const scheduled = this.scheduled.get(walletId);
    if (!scheduled) return false;
    clearInterval(scheduled.timer);
    scheduled.active = false;
    this.scheduled.delete(walletId);
    eventEngine.emit('wallet.key_rotation_unscheduled', { walletId });
    return true;
  }

  // ------------------------------------------------- getScheduledRotations
  getScheduledRotations(): ScheduledRotation[] {
    return [...this.scheduled.values()];
  }

  /** True if a wallet has a scheduled rotation. */
  isScheduled(walletId: string): boolean {
    return this.scheduled.has(walletId);
  }

  // ------------------------------------------------- getWalletPostRotation
  /** Convenience: return the wallet record after the latest rotation. */
  getWalletPostRotation(walletId: string): HDWallet | undefined {
    return hdWalletService.getWallet(walletId);
  }

  // ------------------------------------------------- getAllRotations
  /** Every rotation record across all wallets (audit use). */
  getAllRotations(): KeyRotationRecord[] {
    return [...this.rotations.values()].sort((a, b) => a.rotatedAt - b.rotatedAt);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForKeyRotation = globalThis as unknown as { __PAYSWAP_KEY_ROTATION_SERVICE?: KeyRotationService };
export const keyRotationService =
  _globalForKeyRotation.__PAYSWAP_KEY_ROTATION_SERVICE ?? new KeyRotationService();
if (!_globalForKeyRotation.__PAYSWAP_KEY_ROTATION_SERVICE) {
  _globalForKeyRotation.__PAYSWAP_KEY_ROTATION_SERVICE = keyRotationService;
}
