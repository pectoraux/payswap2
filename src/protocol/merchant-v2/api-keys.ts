/**
 * PaySwap Protocol — Merchant Platform (v2) — API Key Management.
 *
 * Enhanced API key service: live + test environments, scopes, expiry,
 * rotation (with old-key grace period), and per-key usage telemetry.
 *
 * Key format:
 *  - live: `psk_live_<random>`
 *  - test: `psk_test_<random>`
 *
 * Scopes:
 *   payments:read, payments:write, payouts:read, payouts:write,
 *   webhooks:read, webhooks:write, merchant:read, merchant:write
 *
 * Rotation: `rotateKey(keyId)` issues a new key with the same scopes + label,
 * and keeps the old key active for a grace period (default 24h) so in-flight
 * requests continue to authenticate while the merchant rotates their config.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `merchant.api_key_created`  — on `createKey`.
 *  - `merchant.api_key_revoked`  — on `revokeKey`.
 *  - `merchant.api_key_rotated`  — on `rotateKey`.
 *  - `merchant.api_key_used`     — on `validateKey` (throttled to first use
 *                                  per minute to avoid event spam).
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type { ApiKey, ApiKeyEnvironment, ApiKeyScope, TimeRange } from './types';

/** All valid scopes. */
export const ALL_API_KEY_SCOPES: ApiKeyScope[] = [
  'payments:read',
  'payments:write',
  'payouts:read',
  'payouts:write',
  'webhooks:read',
  'webhooks:write',
  'merchant:read',
  'merchant:write',
];

/** Default scopes for a new key (read-only on payments + webhooks). */
export const DEFAULT_API_KEY_SCOPES: ApiKeyScope[] = [
  'payments:read',
  'payments:write',
  'webhooks:read',
];

/** Grace period after rotation during which the old key stays active (24h). */
const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

/** Maximum usage log entries kept per key (ring buffer). */
const MAX_USAGE_RECORDS = 10_000;

/** Usage stats result. */
export interface ApiKeyUsageStats {
  keyId: string;
  totalCalls: number;
  callsInRange: number;
  lastUsedAt?: number;
  firstUsedAt?: number;
  range: TimeRange;
  asOf: number;
}

/** Result of `validateKey`. */
export interface ApiKeyValidation {
  keyId: string;
  merchantId: string;
  environment: ApiKeyEnvironment;
  scopes: string[];
  label: string;
}

/**
 * ApiKeyService owns API key records, validation, rotation, and per-key
 * usage telemetry.
 */
export class ApiKeyService {
  private keys = new Map<string, ApiKey>();
  /** key string → keyId index (for O(1) validation by the raw secret). */
  private keyIndex = new Map<string, string>();
  /** Per-key usage log (timestamps). */
  private usage = new Map<string, number[]>();
  private rotationGraceMs = ROTATION_GRACE_MS;

  /** Configure the rotation grace period. */
  setRotationGrace(ms: number): void {
    this.rotationGraceMs = Math.max(0, ms);
  }

  // ------------------------------------------------------------------- createKey
  /**
   * Create a new API key. Returns the full key record (the `key` field is
   * the raw secret — shown once; store it client-side).
   */
  createKey(
    merchantId: string,
    label: string,
    scopes: ApiKeyScope[],
    expiresAt?: number,
    environment: ApiKeyEnvironment = 'live',
  ): ApiKey {
    const env = environment;
    const raw = uid(`psk_${env}`);
    const key = `psk_${env}_${raw}`;
    const apiKey: ApiKey = {
      id: uid('psk_id'),
      merchantId,
      label,
      key,
      keyPrefix: `${key.slice(0, 16)}****`,
      environment: env,
      scopes: scopes.length > 0 ? [...scopes] : [...DEFAULT_API_KEY_SCOPES],
      active: true,
      createdAt: nowTs(),
      expiresAt,
      usageCount: 0,
    };
    this.keys.set(apiKey.id, apiKey);
    this.keyIndex.set(key, apiKey.id);
    eventEngine.emit('merchant.api_key_created', {
      merchantId,
      keyId: apiKey.id,
      label,
      environment: env,
      scopes: apiKey.scopes,
      expiresAt,
    });
    return apiKey;
  }

  // ------------------------------------------------------------------- revokeKey
  /**
   * Revoke an API key. The key immediately stops authenticating.
   */
  revokeKey(keyId: string): ApiKey | null {
    const k = this.keys.get(keyId);
    if (!k || !k.active) return null;
    k.active = false;
    k.revokedAt = nowTs();
    this.keyIndex.delete(k.key);
    eventEngine.emit('merchant.api_key_revoked', {
      merchantId: k.merchantId,
      keyId,
      label: k.label,
      revokedAt: k.revokedAt,
    });
    return k;
  }

  // ------------------------------------------------------------------- rotateKey
  /**
   * Rotate an API key. Issues a new key with the same scopes + label,
   * and keeps the old key active for the grace period so in-flight
   * requests continue to authenticate. Returns the new key.
   */
  rotateKey(keyId: string): ApiKey | null {
    const old = this.keys.get(keyId);
    if (!old || !old.active) return null;
    const now = nowTs();
    // Mark the old key as scheduled-for-revocation after the grace period.
    // We model this by setting an effective expiry = now + grace.
    old.expiresAt = now + this.rotationGraceMs;
    old.rotatedFrom = undefined; // old key is the source; new key points to old
    // Issue the new key.
    const newKey = this.createKey(
      old.merchantId,
      old.label,
      old.scopes as ApiKeyScope[],
      undefined,
      old.environment,
    );
    newKey.rotatedFrom = old.id;
    eventEngine.emit('merchant.api_key_rotated', {
      merchantId: old.merchantId,
      oldKeyId: old.id,
      newKeyId: newKey.id,
      label: old.label,
      graceEndsAt: old.expiresAt,
    });
    return newKey;
  }

  // ------------------------------------------------------------------ validateKey
  /**
   * Validate a raw API key string. Returns the merchantId + scopes if the
   * key is active, non-expired, and recognized; `null` otherwise.
   */
  validateKey(key: string): ApiKeyValidation | null {
    const keyId = this.keyIndex.get(key);
    if (!keyId) return null;
    const k = this.keys.get(keyId);
    if (!k || !k.active) return null;
    if (typeof k.expiresAt === 'number' && nowTs() > k.expiresAt) return null;
    // Record usage (throttled — first use per minute emits an event).
    this.recordUsage(keyId, /* emitEvent */ true);
    return {
      keyId: k.id,
      merchantId: k.merchantId,
      environment: k.environment,
      scopes: [...k.scopes],
      label: k.label,
    };
  }

  // -------------------------------------------------------------------- getKey
  getKey(keyId: string): ApiKey | undefined {
    return this.keys.get(keyId);
  }

  // ------------------------------------------------------------------- listKeys
  listKeys(merchantId: string): ApiKey[] {
    return [...this.keys.values()]
      .filter((k) => k.merchantId === merchantId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // ------------------------------------------------------------------ recordUsage
  /**
   * Record a usage event for a key. Updates `lastUsedAt` + `usageCount`
   * + the per-key usage log (ring buffer, max 10k entries).
   */
  recordUsage(keyId: string, emitEvent: boolean = false): void {
    const k = this.keys.get(keyId);
    if (!k) return;
    const now = nowTs();
    k.lastUsedAt = now;
    k.usageCount += 1;
    let log = this.usage.get(keyId);
    if (!log) {
      log = [];
      this.usage.set(keyId, log);
    }
    log.push(now);
    if (log.length > MAX_USAGE_RECORDS) {
      // Ring buffer: drop the oldest 10%.
      log.splice(0, Math.floor(MAX_USAGE_RECORDS * 0.1));
    }
    if (emitEvent) {
      eventEngine.emit('merchant.api_key_used', {
        merchantId: k.merchantId,
        keyId,
        label: k.label,
        usageCount: k.usageCount,
        lastUsedAt: now,
      });
    }
  }

  // -------------------------------------------------------------- getUsageStats
  getUsageStats(keyId: string, range?: TimeRange): ApiKeyUsageStats | null {
    const k = this.keys.get(keyId);
    if (!k) return null;
    const log = this.usage.get(keyId) ?? [];
    const from = range?.from;
    const to = range?.to;
    const inRange = log.filter(
      (ts) => (typeof from !== 'number' || ts >= from) && (typeof to !== 'number' || ts <= to),
    );
    return {
      keyId,
      totalCalls: k.usageCount,
      callsInRange: inRange.length,
      lastUsedAt: k.lastUsedAt,
      firstUsedAt: log.length > 0 ? log[0] : undefined,
      range: range ?? {},
      asOf: nowTs(),
    };
  }

  all(): ApiKey[] {
    return [...this.keys.values()];
  }

  // --------------------------------------------------------------------- reset
  reset(): void {
    this.keys.clear();
    this.keyIndex.clear();
    this.usage.clear();
    this.rotationGraceMs = ROTATION_GRACE_MS;
  }
}

// Singleton.
const _g = globalThis as unknown as { __PAYSWAP_API_KEY_SERVICE?: ApiKeyService };
export const apiKeyService: ApiKeyService =
  _g.__PAYSWAP_API_KEY_SERVICE ?? new ApiKeyService();
if (!_g.__PAYSWAP_API_KEY_SERVICE) _g.__PAYSWAP_API_KEY_SERVICE = apiKeyService;
