/**
 * Extension Platform — Packaging + Signing.
 *
 * .psx package format: manifest + code + assets + schemas + checksums + signature.
 * Cryptographic signing using Node's crypto module. Every package must be signed;
 * signatures are verified on install; tampered packages are rejected.
 */

import { createHash, generateKeyPairSync, sign, verify, createPublicKey } from 'crypto';
import type { ExtensionManifestV2, ExtensionPackage, PackageChecksums, PackageSignature } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// CHECKSUMS
// ═══════════════════════════════════════════════════════════════════════════

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

export function computeChecksums(manifest: ExtensionManifestV2, code: string, assets: Record<string, string>): PackageChecksums {
  const manifestSha256 = sha256(JSON.stringify(manifest));
  const codeSha256 = sha256(code);
  const assetsSha256 = sha256(JSON.stringify(assets));
  const totalSha256 = sha256(manifestSha256 + codeSha256 + assetsSha256);
  return { manifestSha256, codeSha256, assetsSha256, totalSha256 };
}

/** Verify that a package's checksums match its content. */
export function verifyChecksums(pkg: ExtensionPackage): { valid: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  const recomputed = computeChecksums(pkg.manifest, pkg.code, pkg.assets);
  if (recomputed.manifestSha256 !== pkg.checksums.manifestSha256) mismatches.push('manifest checksum mismatch');
  if (recomputed.codeSha256 !== pkg.checksums.codeSha256) mismatches.push('code checksum mismatch');
  if (recomputed.assetsSha256 !== pkg.checksums.assetsSha256) mismatches.push('assets checksum mismatch');
  if (recomputed.totalSha256 !== pkg.checksums.totalSha256) mismatches.push('total checksum mismatch');
  return { valid: mismatches.length === 0, mismatches };
}

// ═══════════════════════════════════════════════════════════════════════════
// KEY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

export interface PublisherKeyPair {
  publicKey: string;          // PEM
  privateKey: string;         // PEM
  keyId: string;              // fingerprint of the public key
}

/** Generate a publisher key pair (RSA). In production, the developer does this locally. */
export function generatePublisherKeyPair(): PublisherKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const keyId = sha256(publicKey).slice(0, 16);
  return { publicKey, privateKey, keyId };
}

// ═══════════════════════════════════════════════════════════════════════════
// SIGNING
// ═══════════════════════════════════════════════════════════════════════════

/** Sign a package with a publisher's private key. */
export function signPackage(
  manifest: ExtensionManifestV2,
  code: string,
  assets: Record<string, string>,
  keyPair: PublisherKeyPair,
): ExtensionPackage {
  const checksums = computeChecksums(manifest, code, assets);
  const signature = sign('RSA-SHA256', Buffer.from(checksums.totalSha256, 'utf8'), keyPair.privateKey).toString('base64');

  const pkgSignature: PackageSignature = {
    publicKey: keyPair.publicKey,
    signature,
    algorithm: 'RSA-SHA256',
    signedAt: Date.now(),
    keyId: keyPair.keyId,
  };

  return {
    manifest,
    code,
    assets,
    schemas: {},
    checksums,
    signature: pkgSignature,
    builtAt: Date.now(),
  };
}

/** Verify a package's signature. Returns true if the signature is valid. */
export function verifySignature(pkg: ExtensionPackage): { valid: boolean; error?: string } {
  try {
    // First verify checksums
    const checksumResult = verifyChecksums(pkg);
    if (!checksumResult.valid) {
      return { valid: false, error: `Checksum verification failed: ${checksumResult.mismatches.join(', ')}` };
    }

    // Then verify the signature
    const publicKeyObj = createPublicKey(pkg.signature.publicKey);
    const isValid = verify(
      pkg.signature.algorithm,
      Buffer.from(pkg.checksums.totalSha256, 'utf8'),
      publicKeyObj,
      Buffer.from(pkg.signature.signature, 'base64'),
    );

    if (!isValid) {
      return { valid: false, error: 'Signature verification failed — package may be tampered' };
    }

    // Verify keyId matches the public key
    const expectedKeyId = sha256(pkg.signature.publicKey).slice(0, 16);
    if (expectedKeyId !== pkg.signature.keyId) {
      return { valid: false, error: 'Key ID mismatch — signature key does not match declared key ID' };
    }

    return { valid: true };
  } catch (e) {
    return { valid: false, error: `Signature verification error: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PACKAGE SERIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/** Serialize a package to a .psx string (JSON-based for the mock; real format would be tar+gzip). */
export function serializePackage(pkg: ExtensionPackage): string {
  return JSON.stringify(pkg);
}

/** Deserialize a .psx string back to a package. */
export function deserializePackage(data: string): ExtensionPackage {
  return JSON.parse(data) as ExtensionPackage;
}
