/**
 * Key Rotation Manager (M-5)
 *
 * Supports rotating JWT secrets and API keys with an overlap period
 * where both old and new keys are valid. This prevents:
 *   - Service interruption during rotation
 *   - Replay attacks with compromised keys
 *   - Locked-out users during rotation
 *
 * Rotation strategy:
 *   1. Add new key alongside old key (both valid)
 *   2. Wait for overlap period (default: 24h)
 *   3. Revoke old key
 *
 * For JWT: the verifier accepts tokens signed by either key.
 *           New tokens are signed with the new key only.
 *
 * For API keys: old keys continue to work until explicitly revoked.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';

interface KeyEntry {
  id: string;
  key: string;
  createdAt: number;
  status: 'active' | 'rotating' | 'revoked';
  revokesAt?: number;  // when the key expires (for rotating keys)
}

class KeyRotationManager {
  private jwtKeys: Map<string, KeyEntry> = new Map();
  private apiKeys: Map<string, KeyEntry> = new Map();

  // ─── JWT Secret Rotation ──────────────────────────────────────────────

  /**
   * Get the active JWT secret (for signing new tokens).
   * SECURITY: no fallback. Throws if NEXTAUTH_SECRET is unset.
   */
  getActiveJwtSecret(): string {
    const active = Array.from(this.jwtKeys.values()).find(k => k.status === 'active');
    if (active) return active.key;
    // Fall back to env var — but never to a hardcoded literal.
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('NEXTAUTH_SECRET is missing or too short. Never use a fallback secret.');
    }
    return secret;
  }

  /**
   * Get all valid JWT secrets (for verifying tokens).
   * During rotation, both old and new secrets are valid.
   * SECURITY: no fallback. Throws if NEXTAUTH_SECRET is unset.
   */
  getValidJwtSecrets(): string[] {
    const now = Date.now();
    const valid = Array.from(this.jwtKeys.values()).filter(k => {
      if (k.status === 'revoked') return false;
      if (k.status === 'rotating' && k.revokesAt && k.revokesAt < now) return false;
      return true;
    });
    if (valid.length === 0) {
      // Fall back to env var — but never to a hardcoded literal.
      const secret = process.env.NEXTAUTH_SECRET;
      if (!secret || secret.length < 32) {
        throw new Error('NEXTAUTH_SECRET is missing or too short. Never use a fallback secret.');
      }
      return [secret];
    }
    return valid.map(k => k.key);
  }

  /**
   * Rotate the JWT secret. The old secret remains valid for the overlap
   * period (default: 24h), after which it is automatically revoked.
   */
  rotateJwtSecret(overlapHours: number = 24): { newKeyId: string; revokesAt: number } {
    const now = Date.now();
    const newKeyId = `jwt_${now}`;
    const newKey = randomBytes(32).toString('hex');

    // Mark all existing active keys as "rotating" (will expire)
    for (const [id, entry] of this.jwtKeys.entries()) {
      if (entry.status === 'active') {
        this.jwtKeys.set(id, {
          ...entry,
          status: 'rotating',
          revokesAt: now + overlapHours * 60 * 60 * 1000,
        });
      }
    }

    // Add the new key as active
    this.jwtKeys.set(newKeyId, {
      id: newKeyId,
      key: newKey,
      createdAt: now,
      status: 'active',
    });

    return {
      newKeyId,
      revokesAt: now + overlapHours * 60 * 60 * 1000,
    };
  }

  /**
   * Check if a JWT rotation is in progress.
   */
  isJwtRotating(): boolean {
    return Array.from(this.jwtKeys.values()).some(k => k.status === 'rotating');
  }

  /**
   * Revoke all expired keys (should be called periodically).
   */
  cleanupExpiredKeys(): number {
    const now = Date.now();
    let revoked = 0;
    for (const [id, entry] of this.jwtKeys.entries()) {
      if (entry.status === 'rotating' && entry.revokesAt && entry.revokesAt < now) {
        this.jwtKeys.set(id, { ...entry, status: 'revoked' });
        revoked++;
      }
    }
    return revoked;
  }

  // ─── API Key Rotation ─────────────────────────────────────────────────

  /**
   * Generate a new API key with a prefix.
   */
  generateApiKey(prefix: 'sk_test_' | 'sk_live_' = 'sk_test_'): { keyId: string; key: string; keyHash: string } {
    const keyId = `key_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const key = `${prefix}${randomBytes(32).toString('hex')}`;
    const keyHash = this.hashKey(key);

    this.apiKeys.set(keyId, {
      id: keyId,
      key: keyHash,  // store hash, not plaintext
      createdAt: Date.now(),
      status: 'active',
    });

    return { keyId, key, keyHash };
  }

  /**
   * Verify an API key against stored hashes (constant-time comparison).
   */
  verifyApiKey(key: string): boolean {
    const hash = this.hashKey(key);
    for (const entry of this.apiKeys.values()) {
      if (entry.status !== 'revoked' && this.safeCompare(hash, entry.key)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Revoke an API key by ID.
   */
  revokeApiKey(keyId: string): boolean {
    const entry = this.apiKeys.get(keyId);
    if (!entry) return false;
    this.apiKeys.set(keyId, { ...entry, status: 'revoked' });
    return true;
  }

  /**
   * List all API keys (without the actual key values).
   */
  listApiKeys(): { id: string; createdAt: number; status: string }[] {
    return Array.from(this.apiKeys.values()).map(k => ({
      id: k.id,
      createdAt: k.createdAt,
      status: k.status,
    }));
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  private safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
      return false;
    }
  }

  /**
   * Get rotation status for monitoring.
   */
  getStatus(): {
    jwtKeys: { id: string; status: string; createdAt: number; revokesAt?: number }[];
    apiKeys: { id: string; status: string; createdAt: number }[];
    isRotating: boolean;
  } {
    return {
      jwtKeys: Array.from(this.jwtKeys.values()).map(k => ({
        id: k.id,
        status: k.status,
        createdAt: k.createdAt,
        revokesAt: k.revokesAt,
      })),
      apiKeys: Array.from(this.apiKeys.values()).map(k => ({
        id: k.id,
        status: k.status,
        createdAt: k.createdAt,
      })),
      isRotating: this.isJwtRotating(),
    };
  }
}

export const keyRotationManager = new KeyRotationManager();
