/**
 * Credential Manager — credentials issued to identities. (M-ID-41.)
 *
 * A credential is a verifiable identifier + secret pair an identity can use
 * to authenticate. Six credential types are supported:
 *   - password    (identifier = email, secretHash = hashed password)
 *   - api_key     (identifier = key fingerprint, secretHash = hashed key)
 *   - oauth       (identifier = provider:subjectId, no secret — external)
 *   - certificate (identifier = certificate fingerprint, no secret)
 *   - biometric   (identifier = device + templateId, no secret)
 *   - hardware_key(identifier = YubiKey / FIDO serial, secretHash = nonce)
 *
 * The manager is responsible for adding, verifying, removing, and
 * authenticating against credentials. `authenticate(identifier, secret)`
 * returns the matching Identity when the credential is valid and not
 * expired / suspended.
 */

import type { Credential, CredentialType, Identity } from './types';
import { store, hashSecret, verifySecret } from './store';
import { identityRegistry } from './registry';
import { uid } from '@/runtime/types';

export class CredentialManager {
  /**
   * Add a credential to an identity. `secret` is hashed before storage —
   * we never persist plaintext. For credential types without a secret
   * (oauth, certificate, biometric), pass `undefined`.
   */
  async add(
    identityId: string,
    credential: Omit<Credential, 'id' | 'createdAt'> & { secret?: string },
  ): Promise<Credential> {
    const identity = identityRegistry.getSync(identityId);
    if (!identity) throw new Error(`Identity ${identityId} not found`);

    const full: Credential = {
      id: uid('cred'),
      type: credential.type,
      identifier: credential.identifier,
      verified: credential.verified,
      createdAt: Date.now(),
      lastUsedAt: credential.lastUsedAt,
      expiresAt: credential.expiresAt,
      secretHash: credential.secret ? hashSecret(credential.secret) : credential.secretHash,
    };
    store.credentials.set(full.id, full);
    identity.credentials.push(full);
    identity.updatedAt = Date.now();
    return full;
  }

  /** Mark a credential verified (e.g., after an email verification flow). */
  async verify(credentialId: string): Promise<void> {
    const cred = store.credentials.get(credentialId);
    if (!cred) return;
    cred.verified = true;
    // Updating the credential record mutates the reference inside the
    // identity's `credentials` array (no extra join needed).
  }

  /** Remove a credential. Returns true if the credential was found. */
  async remove(credentialId: string): Promise<void> {
    const cred = store.credentials.get(credentialId);
    if (!cred) return;
    store.credentials.delete(credentialId);
    // Also drop it from the owning identity's list.
    for (const identity of store.identities.values()) {
      const idx = identity.credentials.findIndex((c) => c.id === credentialId);
      if (idx >= 0) {
        identity.credentials.splice(idx, 1);
        identity.updatedAt = Date.now();
        break;
      }
    }
  }

  /** List credentials for an identity. */
  async list(identityId: string): Promise<Credential[]> {
    const identity = identityRegistry.getSync(identityId);
    return identity ? [...identity.credentials] : [];
  }

  /**
   * Authenticate with a credential.
   *
   * `identifier` matches the credential's `identifier` (e.g., an email).
   * `secret` is the plaintext secret (compared against the stored hash).
   *
   * Returns the matching Identity if (a) the credential exists, (b) the
   * secret matches, (c) the credential is verified, (d) not expired, and
   * (e) the identity is active. Otherwise returns null.
   */
  async authenticate(identifier: string, secret: string): Promise<Identity | null> {
    let matched: Credential | null = null;
    let owner: Identity | null = null;
    for (const identity of store.identities.values()) {
      for (const cred of identity.credentials) {
        if (cred.identifier === identifier) {
          matched = cred;
          owner = identity;
          break;
        }
      }
      if (matched) break;
    }
    if (!matched || !owner) return null;
    if (!matched.verified) return null;
    if (matched.expiresAt && matched.expiresAt < Date.now()) return null;
    if (owner.status !== 'active') return null;
    if (!matched.secretHash) return null;
    if (!verifySecret(secret, matched.secretHash)) return null;
    matched.lastUsedAt = Date.now();
    return owner;
  }

  /**
   * Lookup a credential by ID. Useful for the API endpoints that take a
   * credentialId in the URL.
   */
  getSync(credentialId: string): Credential | null {
    return store.credentials.get(credentialId) ?? null;
  }

  /**
   * Convenience — list all credentials of a given type (across all
   * identities). Used by the admin overview endpoint.
   */
  listByType(type: CredentialType): Credential[] {
    return Array.from(store.credentials.values()).filter((c) => c.type === type);
  }
}

export const credentialManager = new CredentialManager();
