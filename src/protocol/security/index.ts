/**
 * PaySwap Protocol — Security — Barrel Export.
 *
 * Centralizes all security exports: secrets vault, HSM, JWT, scopes, RBAC,
 * MFA, rate limiting, audit, device trust, auth facade, middleware factories.
 *
 * Quick start:
 *   import {
 *     secretsVault, hsm, jwtService, mfaService,
 *     rateLimiterRegistry, auditLog, deviceTrustService,
 *     authService, withAuth, withApiKey,
 *   } from '@/protocol/security';
 *
 *   // Set a secret:
 *   secretsVault.set('stripe_key', 'sk_live_xxx');
 *
 *   // Sign a JWT:
 *   const token = jwtService.sign({ sub: 'user_1', aud: 'payswap-api', scope: ['payments:read'], role: 'developer' });
 *
 *   // Wrap a route:
 *   export const POST = withAuth(handler, { permission: 'payment:create' });
 *
 * Frozen-kernel compliance:
 *   - Imports only `eventEngine` + `uid` + `nowTs` from kernel (read-only).
 *   - All NEW files in src/protocol/security/.
 *   - No external crypto packages — Node built-in `crypto` only.
 */

// ─── Secrets Vault ───────────────────────────────────────────────────────────
export {
  type SecretsVaultOptions,
  SecretsVault,
  deriveMasterKey,
  secretsVault,
} from './secrets';

// ─── HSM ─────────────────────────────────────────────────────────────────────
export {
  type SignResult,
  type VerifyResult,
  type PublicKeyResult,
  type HSMProvider,
  type RemoteHSMConfig,
  SoftwareHSM,
  RemoteHSM,
  hsm,
  configureRemoteHSM,
  resetToSoftwareHSM,
  signEvidence,
  evidenceHash,
} from './hsm';

// ─── JWT ─────────────────────────────────────────────────────────────────────
export {
  type JWTHeader,
  type JWTPayload,
  type JWTVerifyResult,
  type JWTSignOptions,
  JWTService,
  jwtService,
} from './jwt';

// ─── Scopes ──────────────────────────────────────────────────────────────────
export {
  type ApiScope,
  ALL_SCOPES,
  SCOPE_DESCRIPTIONS,
  SCOPE_HIERARCHY,
  InsufficientScopeError,
  isApiScope,
  expandScopes,
  effectiveScopes,
  hasScope,
  requireScopes,
} from './scopes';

// ─── RBAC ────────────────────────────────────────────────────────────────────
export {
  type Role,
  type Permission,
  ALL_PERMISSIONS,
  ForbiddenError,
  ROLE_PERMISSIONS,
  type UserLike,
  hasPermission,
  rolesForUser,
  userHasPermission,
  checkPermission,
  permissionsForUser,
} from './rbac';

// ─── MFA ─────────────────────────────────────────────────────────────────────
export {
  type MFAMethod,
  type MFAEnrollment,
  type MFAEnrollResult,
  MFAService,
  mfaService,
  base32Encode,
  base32Decode,
  totpCode,
  totpCounter,
  verifyTotp,
  generateBackupCodes,
  hashBackupCode,
} from './mfa';

// ─── Rate Limiting ───────────────────────────────────────────────────────────
export {
  type RateLimitStrategy,
  type RateLimitResult,
  type RateLimiterOptions,
  RateLimiter,
  RateLimiterRegistry,
  rateLimiterRegistry,
} from './rate-limit';

// ─── Audit ───────────────────────────────────────────────────────────────────
export {
  type AuditActorType,
  type AuditActor,
  type AuditResult,
  type AuditResource,
  type AuditCorrelation,
  type AuditEvent,
  type AuditQueryFilter,
  AUDIT_ACTIONS,
  type AuditAction,
  AuditLog,
  auditLog,
  auditSuccess,
  auditDenied,
  auditError,
} from './audit';

// ─── Device Trust ────────────────────────────────────────────────────────────
export {
  type DeviceTrustLevel,
  type DeviceRecord,
  type DeviceCheckResult,
  DeviceTrustService,
  deviceTrustService,
  hashFingerprint,
} from './device-trust';

// ─── Auth Facade ─────────────────────────────────────────────────────────────
export {
  type AuthType,
  type AuthContext,
  type AuthenticateResult,
  type LoginResult,
  AuthService,
  authService,
} from './auth';

// ─── Middleware ──────────────────────────────────────────────────────────────
export {
  type WithAuthOptions,
  type WithApiKeyOptions,
  type AuthedHandler,
  withAuth,
  withApiKey,
  withMfaRequired,
} from './middleware';
