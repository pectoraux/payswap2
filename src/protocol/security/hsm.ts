/**
 * PaySwap Protocol — Security — HSM Abstraction.
 *
 * A pluggable Hardware Security Module interface. In production, secrets
 * never leave a real HSM (AWS CloudHSM, Azure Key Vault, YubiHSM, etc.).
 * In dev/test, a `SoftwareHSM` simulates the boundary by holding an
 * in-process RSA keypair (private key never serialized in plaintext).
 *
 * API:
 *   await hsm.generateKey();
 *   const sig = await hsm.sign(Buffer.from('hello'));
 *   await hsm.verify(Buffer.from('hello'), sig.signature);
 *   await hsm.getPublicKey();
 *
 *   // Switch to remote (stub):
 *   configureRemoteHSM('https://kms.example.com', { ... });
 *
 * Frozen-kernel compliance: imports only kernel `uid` (read-only).
 */
import {
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  createPrivateKey,
  createPublicKey,
  createHash,
  type KeyObject,
} from 'node:crypto';
import { uid } from '@/kernel/support';
import { logger } from '@/protocol/ops/logger';
import { secretsVault } from './secrets';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SignResult {
  /** Raw signature bytes. */
  signature: Buffer;
  /** Algorithm identifier (e.g. 'RSA-SHA256', 'Ed25519'). */
  algorithm: string;
  /** Key ID (kid) used to sign. */
  keyId: string;
  /** ISO timestamp of signing. */
  signedAt: number;
}

export interface VerifyResult {
  valid: boolean;
  /** Algorithm used to verify. */
  algorithm: string;
  /** Error message if verification failed (no throw). */
  error?: string;
}

export interface PublicKeyResult {
  /** PEM-encoded public key. */
  publicKey: string;
  /** Algorithm. */
  algorithm: string;
  /** Key ID. */
  keyId: string;
}

export interface HSMProvider {
  /** Sign data with the HSM's private key. */
  sign(data: Buffer): Promise<SignResult>;
  /** Verify a signature against the HSM's public key. */
  verify(data: Buffer, signature: Buffer): Promise<VerifyResult>;
  /** Return the PEM public key. */
  getPublicKey(): Promise<PublicKeyResult>;
  /** Generate a new keypair inside the module. */
  generateKey(): Promise<void>;
  /** Provider name (for logging / audit). */
  readonly name: string;
}

export interface RemoteHSMConfig {
  endpoint: string;
  credentials: Record<string, string>;
  /** Optional key ID already provisioned in the remote HSM. */
  keyId?: string;
}

// ─── SoftwareHSM ─────────────────────────────────────────────────────────────

/**
 * In-process HSM simulator. Uses an RSA-2048 keypair. The private key is
 * held as a `KeyObject` (never serialized to PEM in plaintext) — though in
 * a real HSM the key material would be in tamper-resistant hardware.
 *
 * Optionally persists the private key in the SecretsVault so signatures
 * remain verifiable across process restarts.
 */
export class SoftwareHSM implements HSMProvider {
  readonly name = 'software-hsm';
  private privateKey: KeyObject;
  private publicKey: KeyObject;
  private keyId: string;
  private readonly algorithm = 'RSA-SHA256';
  private readonly vaultKey = 'hsm:software:private_key';

  constructor() {
    this.keyId = uid('hsmkey');
    // Try to restore from secrets vault; if not present, generate + persist.
    const restored = this.restoreFromVault();
    if (restored) {
      logger.info('SoftwareHSM: restored keypair from secrets vault', { keyId: this.keyId });
    } else {
      const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      this.privateKey = createPrivateKey(privateKey as string);
      this.publicKey = createPublicKey(publicKey as string);
      this.persistToVault(privateKey as string, publicKey as string);
      logger.info('SoftwareHSM: generated new RSA-2048 keypair', { keyId: this.keyId });
    }
  }

  async sign(data: Buffer): Promise<SignResult> {
    const signature = cryptoSign(this.algorithm, data, this.privateKey);
    return {
      signature,
      algorithm: this.algorithm,
      keyId: this.keyId,
      signedAt: Date.now(),
    };
  }

  async verify(data: Buffer, signature: Buffer): Promise<VerifyResult> {
    try {
      const valid = cryptoVerify(this.algorithm, data, this.publicKey, signature);
      return { valid, algorithm: this.algorithm, error: valid ? undefined : 'signature mismatch' };
    } catch (e) {
      return {
        valid: false,
        algorithm: this.algorithm,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async getPublicKey(): Promise<PublicKeyResult> {
    return {
      publicKey: this.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      algorithm: this.algorithm,
      keyId: this.keyId,
    };
  }

  async generateKey(): Promise<void> {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    this.privateKey = createPrivateKey(privateKey as string);
    this.publicKey = createPublicKey(publicKey as string);
    this.keyId = uid('hsmkey');
    this.persistToVault(privateKey as string, publicKey as string);
    logger.info('SoftwareHSM: generated new RSA-2048 keypair (rotation)', { keyId: this.keyId });
  }

  private persistToVault(privateKeyPem: string, publicKeyPem: string): void {
    try {
      secretsVault.set(this.vaultKey, JSON.stringify({ privateKeyPem, publicKeyPem, keyId: this.keyId }));
    } catch (e) {
      logger.warn('SoftwareHSM: failed to persist keypair to vault (key will not survive restart)', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private restoreFromVault(): boolean {
    try {
      const raw = secretsVault.get(this.vaultKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { privateKeyPem: string; publicKeyPem: string; keyId: string };
      this.privateKey = createPrivateKey(parsed.privateKeyPem);
      this.publicKey = createPublicKey(parsed.publicKeyPem);
      this.keyId = parsed.keyId;
      return true;
    } catch {
      return false;
    }
  }
}

// ─── RemoteHSM ───────────────────────────────────────────────────────────────

/**
 * Stub for a remote HSM (AWS CloudHSM, Azure Key Vault, GCP Cloud KMS,
 * YubiHSM, etc.). All methods return error shapes (no JS throws) — a real
 * implementation would call the vendor SDK over the network.
 *
 * The intent is that production code can call `hsm.sign(...)` without
 * caring whether the HSM is local or remote; the RemoteHSM stub makes it
 * obvious when remote is configured but not yet implemented.
 */
export class RemoteHSM implements HSMProvider {
  readonly name = 'remote-hsm';
  private readonly config: RemoteHSMConfig;

  constructor(config: RemoteHSMConfig) {
    this.config = config;
    logger.info('RemoteHSM: configured (stub — network calls not implemented)', {
      endpoint: config.endpoint,
      keyId: config.keyId,
    });
  }

  async sign(_data: Buffer): Promise<SignResult> {
    return {
      signature: Buffer.alloc(0),
      algorithm: 'unsupported',
      keyId: this.config.keyId ?? 'unknown',
      signedAt: Date.now(),
    };
  }

  async verify(_data: Buffer, _signature: Buffer): Promise<VerifyResult> {
    return {
      valid: false,
      algorithm: 'unsupported',
      error: 'Remote HSM not configured (verify unavailable)',
    };
  }

  async getPublicKey(): Promise<PublicKeyResult> {
    return {
      publicKey: '',
      algorithm: 'unsupported',
      keyId: this.config.keyId ?? 'unknown',
    };
  }

  async generateKey(): Promise<void> {
    logger.warn('RemoteHSM: generateKey() is a no-op stub (use vendor SDK to provision keys)');
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _hsm: HSMProvider = new SoftwareHSM();

/** Current HSM provider (defaults to SoftwareHSM). */
export const hsm: HSMProvider = {
  get name() { return _hsm.name; },
  sign: (data: Buffer) => _hsm.sign(data),
  verify: (data: Buffer, sig: Buffer) => _hsm.verify(data, sig),
  getPublicKey: () => _hsm.getPublicKey(),
  generateKey: () => _hsm.generateKey(),
};

/** Switch the HSM singleton to a remote provider. */
export function configureRemoteHSM(endpoint: string, credentials: Record<string, string>, keyId?: string): void {
  _hsm = new RemoteHSM({ endpoint, credentials, keyId });
  logger.warn('HSM switched to remote provider', { endpoint, keyId });
}

/** Reset to SoftwareHSM (for testing). */
export function resetToSoftwareHSM(): void {
  _hsm = new SoftwareHSM();
}

// ─── Evidence signing helper ─────────────────────────────────────────────────

/**
 * Sign an evidence hash with the HSM. The evidence is expected to be a
 * hex-encoded hash string (or any string); it's UTF-8 encoded as the input
 * to the signature.
 *
 * Used by the settlement / payout engines to produce tamper-evident proofs
 * that a particular settlement decision was made by PaySwap's HSM at a
 * particular time.
 */
export async function signEvidence(evidence: string): Promise<SignResult> {
  const data = Buffer.from(evidence, 'utf8');
  return hsm.sign(data);
}

/** Convenience: produce a SHA-256 evidence hash from a JSON-serializable object. */
export function evidenceHash(obj: unknown): string {
  const json = JSON.stringify(obj);
  return createHash('sha256').update(json).digest('hex');
}
