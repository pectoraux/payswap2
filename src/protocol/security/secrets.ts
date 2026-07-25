/**
 * PaySwap Protocol — Security — Encrypted Secrets Vault.
 *
 * AES-256-GCM at rest. Random IV per secret. Auth tag provides tamper
 * detection (integrity). Master key may be provided directly OR derived
 * from a passphrase via scrypt (N=2^15, r=8, p=1, salt=random per vault).
 *
 * API:
 *   const vault = new SecretsVault({ masterKey: <32-byte Buffer> });
 *   vault.set('stripe_key', 'sk_live_xxx');
 *   vault.get('stripe_key');                       // → 'sk_live_xxx'
 *   vault.list();                                  // → ['stripe_key']
 *   vault.delete('stripe_key');
 *   vault.rotateMasterKey(newKey);                 // re-encrypts all
 *   const blob = vault.exportEncrypted();          // backup blob
 *   vault.importEncrypted(blob, key);              // restore
 *
 * Invariants:
 *   - Secrets never stored in plaintext (ciphertext + tag + IV only).
 *   - Decryption failure (wrong key, tampered ciphertext) returns undefined.
 *   - Master key never persisted alongside ciphertext.
 *
 * Frozen-kernel compliance: imports only `uid` from kernel support (read-only).
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  createHash,
} from 'node:crypto';
import { uid } from '@/kernel/support';
import { logger } from '@/protocol/ops/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SecretsVaultOptions {
  /** 32-byte master key (raw). Mutually exclusive with passphrase. */
  masterKey?: Buffer;
  /** Human passphrase — derived to 32-byte key via scrypt with a random salt. */
  passphrase?: string;
  /** Optional salt for passphrase derivation (deterministic across reboots).
   *  If omitted, a random salt is generated and stored on the vault. */
  salt?: Buffer;
}

interface EncryptedSecret {
  /** 12-byte IV (base64). */
  iv: string;
  /** 16-byte GCM auth tag (base64). */
  tag: string;
  /** Ciphertext (base64). */
  ct: string;
  /** When the secret was stored (epoch ms). */
  storedAt: number;
}

interface ExportedVault {
  format: 'payswap-secrets-v1';
  /** Master key salt (if derived from passphrase). */
  salt?: string;
  /** KDF parameters (if derived from passphrase). */
  kdf?: { name: 'scrypt'; N: number; r: number; p: number; keyLen: number };
  secrets: Record<string, EncryptedSecret>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM recommended
const TAG_LEN = 16; // GCM auth tag
const SCRYPT_N = 1 << 15; // 32768
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

/** Derive a 32-byte master key from a passphrase + salt via scrypt. */
export function deriveMasterKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

// ─── SecretsVault ────────────────────────────────────────────────────────────

export class SecretsVault {
  private masterKey: Buffer;
  private readonly salt: Buffer;
  private readonly kdfParams: { name: 'scrypt'; N: number; r: number; p: number; keyLen: number } | undefined;
  private secrets: Map<string, EncryptedSecret> = new Map();

  constructor(opts: SecretsVaultOptions = {}) {
    if (opts.masterKey && opts.passphrase) {
      throw new Error('SecretsVault: provide masterKey OR passphrase, not both');
    }
    if (opts.masterKey) {
      if (opts.masterKey.length !== KEY_LEN) {
        throw new Error(`SecretsVault: masterKey must be ${KEY_LEN} bytes (got ${opts.masterKey.length})`);
      }
      this.masterKey = Buffer.from(opts.masterKey);
      this.salt = opts.salt ?? randomBytes(16);
      this.kdfParams = undefined;
    } else if (opts.passphrase) {
      this.salt = opts.salt ?? randomBytes(16);
      this.kdfParams = { name: 'scrypt', N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, keyLen: KEY_LEN };
      this.masterKey = scryptSync(opts.passphrase, this.salt, KEY_LEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAXMEM,
      });
    } else {
      // No key material — generate an ephemeral one (memory only, not persisted).
      this.masterKey = randomBytes(KEY_LEN);
      this.salt = randomBytes(16);
      this.kdfParams = undefined;
    }
  }

  /** Encrypt and store a secret. Returns true on success. */
  set(key: string, value: string): boolean {
    if (typeof key !== 'string' || key.length === 0) return false;
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    this.secrets.set(key, {
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ct: ct.toString('base64'),
      storedAt: Date.now(),
    });
    return true;
  }

  /** Decrypt and return a secret. Returns undefined if not found OR
   *  decryption fails (wrong key / tampered ciphertext / corrupted auth tag). */
  get(key: string): string | undefined {
    const enc = this.secrets.get(key);
    if (!enc) return undefined;
    try {
      const iv = Buffer.from(enc.iv, 'base64');
      const tag = Buffer.from(enc.tag, 'base64');
      const ct = Buffer.from(enc.ct, 'base64');
      if (iv.length !== IV_LEN || tag.length !== TAG_LEN) return undefined;
      const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv);
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      return pt.toString('utf8');
    } catch {
      // Tamper detection or wrong key — never leak the secret.
      return undefined;
    }
  }

  /** Returns the key names (NOT values). */
  list(): string[] {
    return [...this.secrets.keys()];
  }

  /** Delete a secret. Returns true if the key existed. */
  delete(key: string): boolean {
    return this.secrets.delete(key);
  }

  /** Number of secrets currently stored. */
  size(): number {
    return this.secrets.size;
  }

  /** Re-encrypt all secrets under a new master key. The previous key is
   *  wiped from memory. Returns the number of secrets re-encrypted. */
  rotateMasterKey(newKey: Buffer): number {
    if (newKey.length !== KEY_LEN) {
      throw new Error(`SecretsVault: newKey must be ${KEY_LEN} bytes (got ${newKey.length})`);
    }
    let count = 0;
    const reEncrypted = new Map<string, EncryptedSecret>();
    for (const [key, enc] of this.secrets) {
      // Decrypt with old key.
      let pt: string | undefined;
      try {
        const iv = Buffer.from(enc.iv, 'base64');
        const tag = Buffer.from(enc.tag, 'base64');
        const ct = Buffer.from(enc.ct, 'base64');
        const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv);
        decipher.setAuthTag(tag);
        pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
      } catch {
        // Skip secrets that can't be decrypted (shouldn't happen post-init).
        continue;
      }
      // Re-encrypt with new key + fresh IV.
      const newIv = randomBytes(IV_LEN);
      const cipher = createCipheriv('aes-256-gcm', newKey, newIv);
      const newCt = Buffer.concat([cipher.update(pt, 'utf8'), cipher.final()]);
      const newTag = cipher.getAuthTag();
      reEncrypted.set(key, {
        iv: newIv.toString('base64'),
        tag: newTag.toString('base64'),
        ct: newCt.toString('base64'),
        storedAt: enc.storedAt,
      });
      count++;
    }
    // Wipe old key, swap in new key + new ciphertext.
    this.masterKey.fill(0);
    this.masterKey = Buffer.from(newKey);
    this.secrets = reEncrypted;
    return count;
  }

  /** Export all secrets as an encrypted blob (JSON). The blob is itself
   *  NOT additionally encrypted beyond the per-secret AES-GCM (the master
   *  key is the security boundary). Suitable for backup storage. */
  exportEncrypted(): string {
    const blob: ExportedVault = {
      format: 'payswap-secrets-v1',
      salt: this.salt.toString('base64'),
      kdf: this.kdfParams,
      secrets: Object.fromEntries(this.secrets),
    };
    return JSON.stringify(blob);
  }

  /** Import secrets from an encrypted blob. Requires the master key (or
   *  passphrase) that produced the blob. Replaces the current vault contents.
   *  Returns the number of secrets imported. */
  importEncrypted(blob: string, keyOrPassphrase: Buffer | string): number {
    let parsed: ExportedVault;
    try {
      parsed = JSON.parse(blob) as ExportedVault;
    } catch {
      throw new Error('SecretsVault.importEncrypted: invalid JSON blob');
    }
    if (parsed.format !== 'payswap-secrets-v1') {
      throw new Error(`SecretsVault.importEncrypted: unsupported format "${parsed.format}"`);
    }
    let key: Buffer;
    if (typeof keyOrPassphrase === 'string') {
      const salt = Buffer.from(parsed.salt ?? '', 'base64');
      if (salt.length === 0) throw new Error('SecretsVault.importEncrypted: missing salt for passphrase');
      key = scryptSync(keyOrPassphrase, salt, KEY_LEN, {
        N: parsed.kdf?.N ?? SCRYPT_N,
        r: parsed.kdf?.r ?? SCRYPT_R,
        p: parsed.kdf?.p ?? SCRYPT_P,
        maxmem: SCRYPT_MAXMEM,
      });
    } else {
      if (keyOrPassphrase.length !== KEY_LEN) {
        throw new Error(`SecretsVault.importEncrypted: key must be ${KEY_LEN} bytes`);
      }
      key = keyOrPassphrase;
    }
    // Verify the key by trying to decrypt one secret (if any exist).
    const entries = Object.entries(parsed.secrets);
    if (entries.length > 0) {
      const [, sample] = entries[0];
      try {
        const iv = Buffer.from(sample.iv, 'base64');
        const tag = Buffer.from(sample.tag, 'base64');
        const ct = Buffer.from(sample.ct, 'base64');
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        Buffer.concat([decipher.update(ct), decipher.final()]);
      } catch {
        throw new Error('SecretsVault.importEncrypted: key does not match blob (decryption failed)');
      }
    }
    // Wipe old key + swap in new.
    this.masterKey.fill(0);
    this.masterKey = key;
    this.secrets = new Map(entries);
    return entries.length;
  }

  /** Wipe the master key from memory (best-effort). */
  wipe(): void {
    this.masterKey.fill(0);
    this.secrets.clear();
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

const DEV_FALLBACK_PASSPHRASE = 'payswap-dev-master-key-DO-NOT-USE-IN-PRODUCTION';

/**
 * Singleton secrets vault.
 *
 * In production, set `PAYSWAP_MASTER_KEY` to a 64-char hex string (32 bytes).
 * If absent, falls back to a dev passphrase and logs a warning.
 */
export const secretsVault: SecretsVault = (() => {
  const envKey = process.env.PAYSWAP_MASTER_KEY;
  if (envKey) {
    // Accept hex (64 chars) or base64.
    let buf: Buffer;
    if (/^[0-9a-fA-F]{64}$/.test(envKey)) {
      buf = Buffer.from(envKey, 'hex');
    } else {
      buf = Buffer.from(envKey, 'base64');
      if (buf.length !== 32) {
        logger.warn('PAYSWAP_MASTER_KEY is not 32 bytes after base64 decode; using scrypt derivation', {
          length: buf.length,
        });
        const salt = createHash('sha256').update('payswap-master-salt').digest();
        return new SecretsVault({ passphrase: envKey, salt });
      }
    }
    return new SecretsVault({ masterKey: buf });
  }
  logger.warn('PAYSWAP_MASTER_KEY not set — using dev fallback passphrase (NOT for production)', {
    env: process.env.NODE_ENV ?? 'development',
    vaultId: uid('vault'),
  });
  const salt = createHash('sha256').update('payswap-dev-salt').digest();
  return new SecretsVault({ passphrase: DEV_FALLBACK_PASSPHRASE, salt });
})();
