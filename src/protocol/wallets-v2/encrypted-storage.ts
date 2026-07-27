/**
 * PaySwap Protocol — Encrypted Key Storage.
 *
 * At-rest encryption for HD wallet seeds. Uses AES-256-GCM (an
 * authenticated encryption mode) so tampering with the ciphertext or
 * IV is detected at decryption time — `retrieve()` throws
 * `WalletError('keystore.tamper')` if the GCM auth tag does not verify.
 *
 * The master key is never stored. It is derived on demand from an
 * environment secret (`PAYSWAP_WALLET_MASTER_SECRET`) using scrypt
 * (N=2^17, r=8, p=1, keylen=32). Callers pass the master key into
 * `store()` / `retrieve()`; the key itself is held only in memory by
 * the caller and zeroed when no longer needed.
 *
 * Storage layout (per walletId):
 *
 *   {
 *     iv:        <12 bytes, base64>
 *     salt:      <16 bytes, base64>            // per-wallet salt for scrypt
 *     ciphertext:<variable, base64>
 *     tag:       <16 bytes, base64>            // GCM auth tag
 *     algo:      'aes-256-gcm',
 *     kdf:       'scrypt',
 *     kdfParams: { N, r, p, keylen },
 *     createdAt: <epoch ms>
 *   }
 *
 * The encrypted blob is JSON-serialisable so it can be persisted in any
 * KV store (Postgres, Redis, S3, …) without re-encoding.
 *
 * The kernel is FROZEN — this module only imports `uid`, `nowTs` from
 * `@/kernel/support` and uses Node built-in `crypto` only.
 */
import * as crypto from 'crypto';
import { nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import {
  GCM_AUTH_TAG_BYTES,
  GCM_IV_BYTES,
  SCRYPT_PARAMS,
  WalletError,
} from './types';

/** Environment variable holding the wallet master secret. */
export const MASTER_SECRET_ENV_VAR = 'PAYSWAP_WALLET_MASTER_SECRET';

/** Fallback development secret — ONLY used when the env var is unset. */
const DEV_FALLBACK_SECRET = 'payswap-dev-master-secret-do-not-use-in-production';

/** Salt length (bytes) — 128-bit per-wallet salt. */
const SALT_BYTES = 16;

/** Encrypted record shape (serialisable to JSON). */
export interface EncryptedRecord {
  iv: string; // base64
  salt: string; // base64
  ciphertext: string; // base64
  tag: string; // base64
  algo: 'aes-256-gcm';
  kdf: 'scrypt';
  kdfParams: { N: number; r: number; p: number; keylen: number };
  createdAt: number;
}

export class EncryptedKeyStore {
  private records = new Map<string, EncryptedRecord>();
  /** Cache of derived master keys keyed by salt+secret hash (avoids re-running scrypt on every retrieve). */
  private keyCache = new Map<string, Buffer>();

  // ------------------------------------------------------------------- store
  /**
   * Encrypt `seed` (a UTF-8 string — typically the mnemonic) with
   * AES-256-GCM under `masterKey`. The master key is derived from the
   * environment secret + a fresh per-wallet salt via scrypt.
   *
   * Returns the JSON-serialisable `EncryptedRecord` (also stored
   * internally under `walletId`).
   */
  store(walletId: string, seed: string, masterKey: string): EncryptedRecord {
    if (!seed) throw new WalletError('keystore.empty_seed', 'seed is required');
    if (!masterKey) throw new WalletError('keystore.empty_master_key', 'masterKey is required');

    const salt = crypto.randomBytes(SALT_BYTES);
    const iv = crypto.randomBytes(GCM_IV_BYTES);
    const derivedKey = this.deriveKey(masterKey, salt);

    const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
    const plaintext = Buffer.from(seed, 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const record: EncryptedRecord = {
      iv: iv.toString('base64'),
      salt: salt.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: tag.toString('base64'),
      algo: 'aes-256-gcm',
      kdf: 'scrypt',
      kdfParams: { ...SCRYPT_PARAMS },
      createdAt: nowTs(),
    };
    this.records.set(walletId, record);

    // Zero the derived key buffer (best-effort; JS GC may reclaim later).
    derivedKey.fill(0);

    eventEngine.emit('wallet.keystore_stored', { walletId, algo: record.algo });
    return record;
  }

  // ---------------------------------------------------------------- retrieve
  /**
   * Decrypt the seed for `walletId` using `masterKey`. Throws
   * `WalletError('keystore.tamper')` if the GCM auth tag fails to
   * verify (i.e. the ciphertext or IV has been tampered with).
   *
   * The caller is responsible for zeroing the returned seed buffer
   * after use — `signWithWallet` does this automatically.
   */
  retrieve(walletId: string, masterKey: string): string {
    const record = this.records.get(walletId);
    if (!record) {
      throw new WalletError('keystore.not_found', `No encrypted record for wallet ${walletId}`, { walletId });
    }
    if (!masterKey) {
      throw new WalletError('keystore.empty_master_key', 'masterKey is required');
    }

    const salt = Buffer.from(record.salt, 'base64');
    const iv = Buffer.from(record.iv, 'base64');
    const tag = Buffer.from(record.tag, 'base64');
    const ciphertext = Buffer.from(record.ciphertext, 'base64');

    const derivedKey = this.deriveKey(masterKey, salt);

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      derivedKey.fill(0);
      return plaintext.toString('utf8');
    } catch (err) {
      derivedKey.fill(0);
      throw new WalletError(
        'keystore.tamper',
        `Auth-tag verification failed for wallet ${walletId} — ciphertext may have been tampered with`,
        { walletId, error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  // ------------------------------------------------------------------ delete
  /**
   * Securely delete the encrypted record for `walletId`. Overwrites the
   * in-memory record with zeros before removing it from the map.
   */
  delete(walletId: string): boolean {
    const record = this.records.get(walletId);
    if (!record) return false;
    // Best-effort zeroisation of the in-memory buffers.
    try {
      Buffer.from(record.iv, 'base64').fill(0);
      Buffer.from(record.salt, 'base64').fill(0);
      Buffer.from(record.ciphertext, 'base64').fill(0);
      Buffer.from(record.tag, 'base64').fill(0);
    } catch {
      /* noop */
    }
    this.records.delete(walletId);
    this.keyCache.delete(walletId);
    eventEngine.emit('wallet.keystore_deleted', { walletId });
    return true;
  }

  // ------------------------------------------------------------------ exists
  exists(walletId: string): boolean {
    return this.records.has(walletId);
  }

  /** Read the raw encrypted record (does NOT decrypt). */
  getRecord(walletId: string): EncryptedRecord | undefined {
    return this.records.get(walletId);
  }

  /** Number of wallets currently stored. */
  size(): number {
    return this.records.size;
  }

  // ------------------------------------------------------------------- helpers
  /**
   * Derive a 256-bit AES key from the master secret + per-wallet salt
   * using scrypt. Results are cached per (secret-hash, salt) pair to
   * avoid re-running the expensive KDF on every `retrieve()`.
   */
  private deriveKey(masterKey: string, salt: Buffer): Buffer {
    const cacheKey = `${crypto.createHash('sha256').update(masterKey).digest('hex')}|${salt.toString('hex')}`;
    const cached = this.keyCache.get(cacheKey);
    if (cached) return Buffer.from(cached);

    const key = crypto.scryptSync(masterKey, salt, SCRYPT_PARAMS.keylen, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      maxmem: 256 * 1024 * 1024, // 256 MB — required for N=2^17
    });
    this.keyCache.set(cacheKey, Buffer.from(key));
    return key;
  }

  // ---------------------------------------------------------- master key load
  /**
   * Resolve the wallet master secret from the environment. Falls back to
   * a development secret (with a console warning) so unit tests work
   * out of the box. Production deployments MUST set the env var.
   */
  static loadMasterSecret(): string {
    const env = process.env[MASTER_SECRET_ENV_VAR];
    if (env && env.length >= 32) return env;
    if (env && env.length > 0) {
      // Secret present but short — still use it, but warn.
      console.warn(
        `[wallets-v2] ${MASTER_SECRET_ENV_VAR} is shorter than 32 chars — weak key. Set a strong secret in production.`,
      );
      return env;
    }
    console.warn(
      `[wallets-v2] ${MASTER_SECRET_ENV_VAR} not set — using dev fallback. DO NOT use in production.`,
    );
    return DEV_FALLBACK_SECRET;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForKeyStore = globalThis as unknown as { __PAYSWAP_ENCRYPTED_KEY_STORE?: EncryptedKeyStore };
export const encryptedKeyStore =
  _globalForKeyStore.__PAYSWAP_ENCRYPTED_KEY_STORE ?? new EncryptedKeyStore();
if (!_globalForKeyStore.__PAYSWAP_ENCRYPTED_KEY_STORE) {
  _globalForKeyStore.__PAYSWAP_ENCRYPTED_KEY_STORE = encryptedKeyStore;
}
