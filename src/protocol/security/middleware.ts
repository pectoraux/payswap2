/**
 * PaySwap Protocol — Security — Next.js-Friendly Middleware Factories.
 *
 * Factory functions that wrap a Next.js API route handler with auth, RBAC,
 * scope checks, rate limiting, and audit logging. The wrappers return
 * appropriate HTTP responses (401/403/429) on failure.
 *
 * Usage:
 *   export const POST = withAuth(
 *     async (req, ctx) => {
 *       return NextResponse.json({ ok: true, userId: ctx.userId });
 *     },
 *     { permission: 'payment:create' },
 *   );
 *
 *   export const GET = withApiKey(['payments:read'])(
 *     async (req, ctx) => NextResponse.json({ ok: true }),
 *   );
 *
 * Frozen-kernel compliance: no kernel imports (pure module).
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authService, type AuthContext } from './auth';
import { rateLimiterRegistry } from './rate-limit';
import { auditLog, auditDenied, auditSuccess } from './audit';
import type { Permission } from './rbac';
import { ForbiddenError } from './rbac';
import type { ApiScope } from './scopes';
import { InsufficientScopeError } from './scopes';
import { mfaService } from './mfa';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WithAuthOptions {
  /** Required RBAC permission (checked via rbac.checkPermission). */
  permission?: Permission;
  /** Required API scope (checked via scopes.hasScope). */
  scope?: ApiScope;
  /** Expected JWT audience (default 'payswap-api'). */
  audience?: string;
  /** Rate limiter name to apply (default 'api:per_ip'). */
  rateLimiter?: string;
  /** Rate limit key extractor (default: IP or user ID). */
  rateLimitKey?: (req: NextRequest, ctx: AuthContext) => string;
  /** Action name for audit log (default: derived from permission). */
  auditAction?: string;
  /** Resource type for audit log (default: 'api_endpoint'). */
  auditResourceType?: string;
}

export interface WithApiKeyOptions {
  /** Required scopes (any-of — token must have at least one, OR admin:*). */
  scopes: ApiScope[];
  /** Rate limiter name (default 'api:per_key'). */
  rateLimiter?: string;
  /** Action name for audit log. */
  auditAction?: string;
}

type HandlerResult = Response | NextResponse | Promise<Response | NextResponse>;
type AuthedHandler = (
  req: NextRequest,
  ctx: AuthContext,
) => HandlerResult;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractRateLimitKey(req: NextRequest, ctx: AuthContext): string {
  if (ctx.apiKeyId) return `key:${ctx.apiKeyId}`;
  if (ctx.userId) return `user:${ctx.userId}`;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip') ?? 'unknown';
  return `ip:${ip}`;
}

function rateLimitResponse(resetAt: number, limit: number): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: 'rate limit exceeded', retryAfter, resetAt, limit },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}

// ─── withAuth ────────────────────────────────────────────────────────────────

/**
 * Wrap a Next.js route handler with JWT auth + RBAC + rate limiting + audit.
 * Returns 401 if not authenticated, 403 if forbidden, 429 if rate-limited.
 */
export function withAuth(handler: AuthedHandler, opts: WithAuthOptions = {}): (req: NextRequest) => HandlerResult {
  return async (req: NextRequest): Promise<Response | NextResponse> => {
    // 1. Extract auth.
    const ctx = authService.requireAuth(req);
    if (ctx.type === 'anonymous') {
      auditDenied(auditLog, {
        type: 'system', id: 'anonymous', ip: ctx.ip,
      }, opts.auditAction ?? 'permission.denied', { type: 'auth', id: 'anonymous' }, {
        reason: 'no credentials',
      });
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // 2. Rate limit (per IP for anonymous-ish, per key for API keys).
    const limiterName = opts.rateLimiter ?? 'api:per_ip';
    const limiter = rateLimiterRegistry.maybeGet(limiterName);
    if (limiter) {
      const key = opts.rateLimitKey ? opts.rateLimitKey(req, ctx) : extractRateLimitKey(req, ctx);
      const rl = limiter.consume(key);
      if (!rl.allowed) {
        auditDenied(auditLog, {
          type: ctx.type, id: ctx.userId ?? ctx.apiKeyId ?? 'unknown',
          merchantId: ctx.merchantId, ip: ctx.ip,
        }, 'rate_limit.exceeded', { type: 'rate_limit', id: key }, {
          limit: rl.limit, resetAt: rl.resetAt, limiter: limiterName,
        });
        return rateLimitResponse(rl.resetAt, rl.limit);
      }
    }

    // 3. RBAC permission check.
    if (opts.permission) {
      try {
        authService.authorize(ctx, opts.permission);
      } catch (e) {
        if (e instanceof ForbiddenError) {
          return NextResponse.json({
            error: 'forbidden',
            permission: opts.permission,
            message: e.message,
          }, { status: 403 });
        }
        throw e;
      }
    }

    // 4. Scope check.
    if (opts.scope) {
      if (!authService.authorizeScope(ctx, opts.scope)) {
        return NextResponse.json({
          error: 'insufficient scope',
          required: opts.scope,
          granted: ctx.scopes ?? [],
        }, { status: 403 });
      }
    }

    // 5. Audit success.
    auditSuccess(auditLog, {
      type: ctx.type, id: ctx.userId ?? ctx.apiKeyId ?? 'unknown',
      merchantId: ctx.merchantId, role: ctx.role, scopes: ctx.scopes, ip: ctx.ip,
    }, opts.auditAction ?? opts.permission ?? 'api.call',
      { type: opts.auditResourceType ?? 'api_endpoint', id: req.nextUrl.pathname });

    // 6. Call the handler.
    return handler(req, ctx);
  };
}

// ─── withApiKey ──────────────────────────────────────────────────────────────

/**
 * Factory that returns a wrapper requiring an API key with the given scopes.
 * Returns 401 if no API key, 403 if insufficient scopes, 429 if rate-limited.
 *
 * Usage:
 *   export const GET = withApiKey(['payments:read'])(async (req, ctx) => ...);
 */
export function withApiKey(scopes: ApiScope[], opts: Omit<WithApiKeyOptions, 'scopes'> = {}): (handler: AuthedHandler) => (req: NextRequest) => HandlerResult {
  return (handler: AuthedHandler) => async (req: NextRequest): Promise<Response | NextResponse> => {
    // 1. Extract API key.
    const apiKey = req.headers.get('x-api-key') ?? req.headers.get('X-API-Key');
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip') ?? undefined;
    if (!apiKey) {
      return NextResponse.json({ error: 'api key required' }, { status: 401 });
    }
    const authResult = authService.authenticateApiKey(apiKey);
    if (!authResult.authenticated || !authResult.authCtx) {
      return NextResponse.json({ error: authResult.error ?? 'invalid api key' }, { status: 401 });
    }
    const ctx: AuthContext = { ...authResult.authCtx, ip };

    // 2. Rate limit per key.
    const limiter = rateLimiterRegistry.maybeGet(opts.rateLimiter ?? 'api:per_key');
    if (limiter && ctx.apiKeyId) {
      const rl = limiter.consume(ctx.apiKeyId);
      if (!rl.allowed) {
        return rateLimitResponse(rl.resetAt, rl.limit);
      }
    }

    // 3. Scope check (any-of: token must have at least one of the required scopes).
    const granted = ctx.scopes ?? [];
    const hasAnyScope = scopes.some((s) => granted.includes(s) || granted.includes('admin:*'));
    if (!hasAnyScope) {
      try {
        throw new InsufficientScopeError(scopes[0], granted);
      } catch (e) {
        if (e instanceof InsufficientScopeError) {
          auditDenied(auditLog, {
            type: 'api_key', id: ctx.apiKeyId ?? 'unknown', merchantId: ctx.merchantId,
            scopes: granted, ip,
          }, 'permission.denied', { type: 'scope', id: scopes.join(',') }, {
            required: scopes, granted,
          });
          return NextResponse.json({
            error: 'insufficient scope',
            required: scopes,
            granted,
          }, { status: 403 });
        }
        throw e;
      }
    }

    // 4. Audit success.
    auditSuccess(auditLog, {
      type: 'api_key', id: ctx.apiKeyId ?? 'unknown', merchantId: ctx.merchantId,
      scopes: granted, ip,
    }, opts.auditAction ?? 'api.call',
      { type: 'api_endpoint', id: req.nextUrl.pathname });

    // 5. Call the handler.
    return handler(req, ctx);
  };
}

// ─── withMfaRequired ─────────────────────────────────────────────────────────

/**
 * Wrap a handler that requires MFA (for sensitive operations like treasury
 * freeze / payout approval). The handler is only called if the JWT was
 * issued within the last 5 minutes (recent auth) AND the user has MFA
 * enrolled. Otherwise returns 403 with `requiresMfa: true`.
 *
 * This is a higher-order wrapper — typically composed AFTER `withAuth`.
 */
export function withMfaRequired(handler: AuthedHandler, opts: { maxAgeSeconds?: number } = {}): (req: NextRequest, ctx: AuthContext) => HandlerResult {
  const maxAge = opts.maxAgeSeconds ?? 5 * 60; // 5 min default
  return async (req: NextRequest, ctx: AuthContext): Promise<Response | NextResponse> => {
    if (!ctx.userId) {
      return NextResponse.json({ error: 'authentication required' }, { status: 401 });
    }
    // Check MFA enrollment.
    if (!mfaService.isEnrolled(ctx.userId)) {
      auditDenied(auditLog, {
        type: ctx.type, id: ctx.userId, merchantId: ctx.merchantId, ip: ctx.ip,
      }, 'permission.denied', { type: 'mfa', id: ctx.userId }, {
        reason: 'mfa not enrolled',
      });
      return NextResponse.json({
        error: 'mfa required',
        requiresMfa: true,
      }, { status: 403 });
    }
    // Check JWT age.
    if (ctx.jwt?.iat) {
      const age = Math.floor(Date.now() / 1000) - ctx.jwt.iat;
      if (age > maxAge) {
        auditDenied(auditLog, {
          type: ctx.type, id: ctx.userId, merchantId: ctx.merchantId, ip: ctx.ip,
        }, 'permission.denied', { type: 'mfa', id: ctx.userId }, {
          reason: 'session too old for sensitive operation',
          age, maxAge,
        });
        return NextResponse.json({
          error: 'recent authentication required',
          requiresRecentAuth: true,
          maxAgeSeconds: maxAge,
        }, { status: 403 });
      }
    }
    return handler(req, ctx);
  };
}
