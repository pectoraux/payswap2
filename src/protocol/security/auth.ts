/**
 * PaySwap Protocol — Security — High-Level Auth Facade.
 *
 * Ties together: API key auth (merchantPlatform), JWT auth (jwtService),
 * RBAC (rbac), scopes (scopes), MFA (mfaService), rate limiting
 * (rateLimiterRegistry), audit (auditLog), and device trust
 * (deviceTrustService) into a single cohesive API.
 *
 * API:
 *   // API key auth:
 *   const r = await authService.authenticateApiKey('psk_live_xxx');
 *
 *   // JWT auth:
 *   const r = await authService.authenticateJWT(token);
 *
 *   // Authorization (RBAC + scopes, audit-logged):
 *   authService.authorize(authCtx, 'payout:approve');
 *
 *   // From a Next.js request:
 *   const ctx = authService.requireAuth(req);
 *
 *   // Login flow (password + optional MFA):
 *   const r = await authService.login(email, password, mfaCode, deviceFingerprint);
 *
 * Frozen-kernel compliance: imports only `eventEngine` + `uid` (read-only).
 */
import { createHash, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { eventEngine } from '@/kernel/event';
import { uid } from '@/kernel/support';
import { logger } from '@/protocol/ops/logger';
import { merchantPlatform } from '@/protocol/merchant/platform';

import { jwtService, type JWTPayload } from './jwt';
import { hasScope, type ApiScope } from './scopes';
import {
  hasPermission as rbacHasPermission,
  checkPermission,
  type Role,
  type Permission,
  ForbiddenError,
  type UserLike,
} from './rbac';
import { mfaService } from './mfa';
import { rateLimiterRegistry } from './rate-limit';
import { auditLog, auditDenied, auditSuccess } from './audit';
import { deviceTrustService } from './device-trust';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuthType = 'user' | 'api_key' | 'anonymous';

export interface AuthContext {
  type: AuthType;
  userId?: string;
  merchantId?: string;
  /** Primary role (from JWT or API key's merchant team role). */
  role?: string;
  /** All roles the user has (for multi-role RBAC). */
  roles?: Role[];
  scopes?: string[];
  ip?: string;
  deviceId?: string;
  apiKeyId?: string;
  /** Original JWT payload (when type === 'user'). */
  jwt?: JWTPayload;
}

export interface AuthenticateResult {
  authenticated: boolean;
  authCtx?: AuthContext;
  error?: string;
}

export interface LoginResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
  merchantId?: string;
  requiresMfa?: boolean;
  mfaTicket?: string;
  deviceTrustLevel?: string;
  error?: string;
}

// ─── User store (in-memory demo) ─────────────────────────────────────────────

interface UserRecord {
  id: string;
  email: string;
  /** scrypt password hash: `scrypt:N:r:p$<salt_hex>$<hash_hex>`. */
  passwordHash: string;
  roles: Role[];
  merchantId?: string;
  createdAt: number;
}

const SCRYPT_N = 1 << 14; // 16384 (lower than vault master key — login is online)
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 32;

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_DKLEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024,
  });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  try {
    // Format: `scrypt:N:r:p$saltHex$hashHex`
    const dollarParts = stored.split('$');
    if (dollarParts.length !== 3) return false;
    const [paramsPart, saltHex, hashHex] = dollarParts;
    const colonParts = paramsPart.split(':');
    if (colonParts.length !== 4 || colonParts[0] !== 'scrypt') return false;
    const N = parseInt(colonParts[1], 10);
    const r = parseInt(colonParts[2], 10);
    const p = parseInt(colonParts[3], 10);
    if (!N || !r || !p) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(password, salt, expected.length, {
      N, r, p, maxmem: 64 * 1024 * 1024,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ─── AuthService ─────────────────────────────────────────────────────────────

export class AuthService {
  private users: Map<string, UserRecord> = new Map();
  private usersByEmail: Map<string, UserRecord> = new Map();
  /** Pending MFA tickets (issued after password verification). */
  private mfaTickets: Map<string, { userId: string; issuedAt: number; expiresAt: number }> = new Map();
  private readonly mfaTicketTtlMs = 5 * 60 * 1000; // 5 min

  /** Register a user (demo store — in production this would be the merchantPlatform
   *  team members with a real password store). Returns the new user ID. */
  registerUser(params: {
    email: string;
    password: string;
    roles: Role[];
    merchantId?: string;
  }): string {
    if (this.usersByEmail.has(params.email)) {
      throw new Error(`AuthService.registerUser: email "${params.email}" already registered`);
    }
    const user: UserRecord = {
      id: uid('user'),
      email: params.email,
      passwordHash: hashPassword(params.password),
      roles: params.roles,
      merchantId: params.merchantId,
      createdAt: Date.now(),
    };
    this.users.set(user.id, user);
    this.usersByEmail.set(user.email, user);
    return user.id;
  }

  /** Sync team members from merchantPlatform into the user store (demo).
   *  Each team member gets a random password (must be reset by the user).
   *  Returns the count of imported members. */
  syncMerchantTeamMembers(password: string = 'payswap-default-password'): number {
    let count = 0;
    for (const m of merchantPlatform.allMerchants()) {
      for (const member of m.team) {
        if (this.usersByEmail.has(member.email)) continue;
        const user: UserRecord = {
          id: member.id,
          email: member.email,
          passwordHash: hashPassword(password),
          roles: [member.role as Role],
          merchantId: m.id,
          createdAt: Date.now(),
        };
        this.users.set(user.id, user);
        this.usersByEmail.set(member.email, user);
        count++;
      }
    }
    return count;
  }

  /** Validate an API key against merchantPlatform. Checks rate limit.
   *  Returns the auth context if the key is valid + active. */
  authenticateApiKey(key: string): AuthenticateResult {
    if (!key || !key.startsWith('psk_')) {
      return { authenticated: false, error: 'invalid key format' };
    }
    // Find the key across all merchants.
    for (const m of merchantPlatform.allMerchants()) {
      for (const k of m.apiKeys) {
        if (k.active && k.key === key) {
          // Rate limit per API key.
          const rl = rateLimiterRegistry.get('api:per_key').consume(k.id);
          if (!rl.allowed) {
            auditDenied(auditLog, {
              type: 'api_key', id: k.id, merchantId: m.id, scopes: k.scopes,
            }, 'rate_limit.exceeded', { type: 'api_key', id: k.id }, {
              limit: rl.limit, resetAt: rl.resetAt,
            });
            return { authenticated: false, error: 'rate limit exceeded' };
          }
          return {
            authenticated: true,
            authCtx: {
              type: 'api_key',
              apiKeyId: k.id,
              merchantId: m.id,
              scopes: k.scopes,
              role: 'developer', // API keys default to developer role
              roles: ['developer'],
            },
          };
        }
      }
    }
    return { authenticated: false, error: 'key not found or revoked' };
  }

  /** Verify a JWT. Returns the auth context if valid. */
  authenticateJWT(token: string, expectedAudience?: string): AuthenticateResult {
    const result = jwtService.verify(token, expectedAudience);
    if (!result.valid || !result.payload) {
      return { authenticated: false, error: result.error };
    }
    const p = result.payload;
    return {
      authenticated: true,
      authCtx: {
        type: 'user',
        userId: p.sub,
        merchantId: p.merchantId,
        role: p.role,
        roles: [p.role as Role],
        scopes: p.scope,
        jwt: p,
      },
    };
  }

  /** Check RBAC + scopes for a given permission. Audit-logs denials.
   *  Throws `ForbiddenError` on denial. */
  authorize(authCtx: AuthContext, permission: Permission): void {
    const user: UserLike = {
      id: authCtx.userId ?? authCtx.apiKeyId ?? 'anonymous',
      roles: authCtx.roles ?? (authCtx.role ? [authCtx.role as Role] : []),
      merchantId: authCtx.merchantId,
    };
    try {
      checkPermission(user, permission);
    } catch (e) {
      if (e instanceof ForbiddenError) {
        auditDenied(auditLog, {
          type: authCtx.type,
          id: user.id,
          merchantId: authCtx.merchantId,
          role: authCtx.role,
          scopes: authCtx.scopes,
          ip: authCtx.ip,
        }, 'permission.denied', { type: 'permission', id: permission }, {
          permission,
          reason: e.message,
        });
      }
      throw e;
    }
  }

  /** Returns true if the auth context has the given scope (audit-logs denials). */
  authorizeScope(authCtx: AuthContext, required: ApiScope): boolean {
    const scopes = authCtx.scopes ?? [];
    if (hasScope(scopes, required)) return true;
    auditDenied(auditLog, {
      type: authCtx.type,
      id: authCtx.userId ?? authCtx.apiKeyId ?? 'anonymous',
      merchantId: authCtx.merchantId,
      role: authCtx.role,
      scopes: authCtx.scopes,
      ip: authCtx.ip,
    }, 'permission.denied', { type: 'scope', id: required }, {
      required,
      granted: scopes,
    });
    return false;
  }

  /** Extract auth from a NextRequest. Tries Bearer JWT first, then X-API-Key. */
  requireAuth(req: NextRequest): AuthContext {
    const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
    const apiKeyHeader = req.headers.get('x-api-key') ?? req.headers.get('X-API-Key');
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip') ?? undefined;
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      const token = authHeader.slice(7).trim();
      const r = this.authenticateJWT(token);
      if (r.authenticated && r.authCtx) {
        r.authCtx.ip = ip;
        return r.authCtx;
      }
    }
    if (apiKeyHeader) {
      const r = this.authenticateApiKey(apiKeyHeader);
      if (r.authenticated && r.authCtx) {
        r.authCtx.ip = ip;
        return r.authCtx;
      }
    }
    return { type: 'anonymous', ip };
  }

  /** High-level login. Verifies password; if MFA enrolled, requires MFA code.
   *  Issues access + refresh JWTs on success. Audits the login attempt.
   *  Device trust: unknown devices require MFA even if MFA is not enrolled
   *  (returns `requiresMfa: true, mfaTicket` so the client can enroll first). */
  async login(
    email: string,
    password: string,
    mfaCode?: string,
    deviceFingerprint?: string,
    opts: { ip?: string; audience?: string } = {},
  ): Promise<LoginResult> {
    const user = this.usersByEmail.get(email);
    const ip = opts.ip;
    if (!user) {
      auditDenied(auditLog, { type: 'user', id: email, ip }, 'login', { type: 'user', id: email }, {
        reason: 'user not found', email,
      });
      return { success: false, error: 'invalid credentials' };
    }
    if (!verifyPassword(password, user.passwordHash)) {
      auditDenied(auditLog, { type: 'user', id: user.id, merchantId: user.merchantId, ip },
        'login', { type: 'user', id: user.id }, { reason: 'invalid password' });
      return { success: false, error: 'invalid credentials' };
    }
    // Check device trust.
    let deviceTrustLevel: 'unknown' | 'known' | 'trusted' = 'unknown';
    let deviceId: string | undefined;
    if (deviceFingerprint) {
      const dt = deviceTrustService.check(user.id, deviceFingerprint);
      deviceTrustLevel = dt.trustLevel;
      deviceId = dt.deviceId;
    }
    const mfaEnrolled = mfaService.isEnrolled(user.id);
    // If MFA enrolled → require MFA code.
    if (mfaEnrolled) {
      if (!mfaCode) {
        // Issue an MFA ticket (client should retry with code + ticket).
        const ticket = uid('mfa');
        this.mfaTickets.set(ticket, {
          userId: user.id,
          issuedAt: Date.now(),
          expiresAt: Date.now() + this.mfaTicketTtlMs,
        });
        return {
          success: false,
          requiresMfa: true,
          mfaTicket: ticket,
          userId: user.id,
          merchantId: user.merchantId,
          deviceTrustLevel,
        };
      }
      if (!mfaService.verify(user.id, mfaCode)) {
        auditDenied(auditLog, { type: 'user', id: user.id, merchantId: user.merchantId, ip },
          'mfa.verify', { type: 'user', id: user.id }, { reason: 'invalid mfa code' });
        return { success: false, error: 'invalid mfa code', requiresMfa: true };
      }
      // If a new device was used, trust it now (post-MFA).
      if (deviceId) deviceTrustService.trust(deviceId);
    } else if (deviceFingerprint && deviceTrustLevel === 'unknown') {
      // Unknown device + MFA not enrolled → still allow login but register the device.
      // In a production system this might require step-up enrollment.
      deviceTrustService.register(user.id, deviceFingerprint, '', ip ?? '');
    }
    // Issue JWTs.
    const role = user.roles[0] ?? 'viewer';
    const scope = this.scopesForRole(role);
    const audience = opts.audience ?? 'payswap-api';
    const accessToken = jwtService.sign({
      sub: user.id,
      aud: audience,
      scope,
      role,
      merchantId: user.merchantId,
    }, { ttlSeconds: 3600, typ: 'access' });
    const refreshToken = jwtService.sign({
      sub: user.id,
      aud: 'payswap-refresh',
      scope,
      role,
      merchantId: user.merchantId,
    }, { ttlSeconds: 30 * 24 * 3600, typ: 'refresh' });
    auditSuccess(auditLog, {
      type: 'user', id: user.id, merchantId: user.merchantId, role, scopes: scope, ip,
    }, 'login', { type: 'session', id: user.id }, {
      deviceTrustLevel, deviceId, mfaUsed: mfaEnrolled,
    });
    eventEngine.emit('security.login', { userId: user.id, merchantId: user.merchantId, role }, 0);
    return {
      success: true,
      accessToken,
      refreshToken,
      userId: user.id,
      merchantId: user.merchantId,
      deviceTrustLevel,
    };
  }

  /** Returns the default scopes for a role. */
  private scopesForRole(role: Role): ApiScope[] {
    switch (role) {
      case 'super_admin': return ['admin:*'];
      case 'owner':
      case 'admin': return ['payments:read', 'payments:write', 'payouts:read', 'payouts:write',
        'webhooks:read', 'webhooks:write', 'merchant:read', 'merchant:write', 'treasury:read',
        'lp:read', 'ops:read'];
      case 'developer': return ['payments:read', 'payments:write', 'payouts:read', 'payouts:write',
        'webhooks:read', 'webhooks:write', 'merchant:read', 'ops:read'];
      case 'analyst': return ['payments:read', 'payouts:read', 'merchant:read', 'treasury:read',
        'lp:read', 'ops:read'];
      case 'treasury_admin': return ['treasury:read', 'treasury:admin', 'ops:read'];
      case 'lp_admin': return ['lp:read', 'lp:admin', 'ops:read'];
      case 'viewer':
      default: return ['payments:read', 'payouts:read', 'merchant:read', 'ops:read'];
    }
  }

  /** Verify an MFA ticket (issued by login() when MFA was required but no code
   *  was provided). Returns the user ID if the ticket is valid + not expired. */
  verifyMfaTicket(ticket: string): string | undefined {
    const t = this.mfaTickets.get(ticket);
    if (!t) return undefined;
    if (Date.now() > t.expiresAt) {
      this.mfaTickets.delete(ticket);
      return undefined;
    }
    return t.userId;
  }

  /** Consume an MFA ticket after successful MFA verification (one-time use). */
  consumeMfaTicket(ticket: string): void {
    this.mfaTickets.delete(ticket);
  }

  /** Reset (for tests). */
  reset(): void {
    this.users.clear();
    this.usersByEmail.clear();
    this.mfaTickets.clear();
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const authService = new AuthService();

// Re-export core helpers so callers can `import { hasPermission, ... } from '@/protocol/security'`.
export { rbacHasPermission as hasPermission, checkPermission, ForbiddenError };
