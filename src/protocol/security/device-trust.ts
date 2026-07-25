/**
 * PaySwap Protocol — Security — Device Trust.
 *
 * Tracks devices per user. Unknown devices require MFA; trusted devices
 * skip step-up auth for non-sensitive operations. Trusted devices still
 * require MFA for treasury freeze / payout approval (per the security
 * invariants).
 *
 * A device fingerprint is a stable hash of (user-agent + accept-language +
 * screen resolution + timezone offset) — computed client-side and sent in
 * the `X-Device-Fingerprint` header. The server stores it hashed (so a DB
 * leak doesn't reveal raw fingerprints).
 *
 * Frozen-kernel compliance: imports only `uid` from kernel support (read-only).
 */
import { createHash } from 'node:crypto';
import { uid } from '@/kernel/support';
import { logger } from '@/protocol/ops/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DeviceTrustLevel = 'unknown' | 'known' | 'trusted';

export interface DeviceRecord {
  id: string;
  userId: string;
  /** SHA-256 hash of the raw fingerprint (never store raw). */
  fingerprint: string;
  userAgent: string;
  ip: string;
  trustLevel: DeviceTrustLevel;
  trustedAt: number | null;
  lastSeenAt: number;
  registeredAt: number;
  revokedAt: number | null;
}

export interface DeviceCheckResult {
  trustLevel: DeviceTrustLevel;
  deviceId?: string;
  /** True if MFA is required (unknown device OR revoked OR not enrolled). */
  requiresMfa: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Hash a raw fingerprint with SHA-256. */
export function hashFingerprint(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// ─── DeviceTrustService ──────────────────────────────────────────────────────

export class DeviceTrustService {
  private devices: Map<string, DeviceRecord> = new Map();

  /** Register a new device for a user. If the fingerprint already exists
   *  for that user, returns the existing record (updating lastSeenAt + ip). */
  register(userId: string, rawFingerprint: string, userAgent: string, ip: string): DeviceRecord {
    const fingerprint = hashFingerprint(rawFingerprint);
    // Look for an existing device with the same (userId, fingerprint).
    for (const d of this.devices.values()) {
      if (d.userId === userId && d.fingerprint === fingerprint && !d.revokedAt) {
        d.lastSeenAt = Date.now();
        d.ip = ip;
        d.userAgent = userAgent;
        return d;
      }
    }
    const device: DeviceRecord = {
      id: uid('dev'),
      userId,
      fingerprint,
      userAgent,
      ip,
      trustLevel: 'unknown',
      trustedAt: null,
      lastSeenAt: Date.now(),
      registeredAt: Date.now(),
      revokedAt: null,
    };
    this.devices.set(device.id, device);
    logger.info('device registered', { userId, deviceId: device.id, trustLevel: device.trustLevel });
    return device;
  }

  /** Mark a device as trusted (called after successful MFA verification). */
  trust(deviceId: string): DeviceRecord | undefined {
    const d = this.devices.get(deviceId);
    if (!d) return undefined;
    if (d.revokedAt) return undefined;
    d.trustLevel = 'trusted';
    d.trustedAt = Date.now();
    logger.info('device trusted', { userId: d.userId, deviceId: d.id });
    return d;
  }

  /** Revoke a device (user logs out / reports lost). */
  revoke(deviceId: string): boolean {
    const d = this.devices.get(deviceId);
    if (!d) return false;
    d.revokedAt = Date.now();
    d.trustLevel = 'unknown';
    logger.info('device revoked', { userId: d.userId, deviceId: d.id });
    return true;
  }

  /** Check a device's trust level for a user. Unknown devices require MFA.
   *  Revoked devices also require MFA (and should ideally be re-registered). */
  check(userId: string, rawFingerprint: string): DeviceCheckResult {
    const fingerprint = hashFingerprint(rawFingerprint);
    for (const d of this.devices.values()) {
      if (d.userId === userId && d.fingerprint === fingerprint) {
        if (d.revokedAt) {
          return { trustLevel: 'unknown', deviceId: d.id, requiresMfa: true };
        }
        // Update lastSeenAt.
        d.lastSeenAt = Date.now();
        return {
          trustLevel: d.trustLevel,
          deviceId: d.id,
          requiresMfa: d.trustLevel !== 'trusted',
        };
      }
    }
    return { trustLevel: 'unknown', requiresMfa: true };
  }

  /** List all devices for a user (revoked included). */
  listForUser(userId: string): DeviceRecord[] {
    return [...this.devices.values()].filter((d) => d.userId === userId);
  }

  /** Get a device by ID. */
  get(deviceId: string): DeviceRecord | undefined {
    return this.devices.get(deviceId);
  }

  /** Reset (for tests). */
  reset(): void {
    this.devices.clear();
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const deviceTrustService = new DeviceTrustService();
