/**
 * Secret management — fail-closed helpers.
 *
 * SECURITY RULE (C-1 fix): Never use `process.env.SECRET || 'literal'`.
 * If the env var is missing, the system MUST throw (fail closed), not
 * silently fall back to a known value. A fail-open fallback lets anyone
 * who reads the code forge tokens with the hardcoded secret.
 *
 * This module is the single source of truth for secret access. Every
 * call site that needs NEXTAUTH_SECRET (or any other secret) must go
 * through `requireNextAuthSecret()` or `requireSecret(name)`.
 */

/**
 * Require a secret from the environment. Throws if missing or empty.
 * Use for any secret where absence should block startup or request handling.
 */
export function requireSecret(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `SECRET_MISSING: environment variable '${name}' is not set. ` +
        'Set it in the hosting platform secret store (e.g. Vercel dashboard). ' +
        'The system refuses to start or handle this request without it — ' +
        'a missing secret is a fail-closed condition, not a dev convenience.',
    );
  }
  return value;
}

/**
 * Require the NEXTAUTH_SECRET. Throws if missing.
 *
 * This is the canonical way to access the JWT-signing secret. Every
 * auth-related module (auth.ts, middleware.ts, key-rotation.ts) must
 * call this — never `process.env.NEXTAUTH_SECRET || '...'`.
 */
export function requireNextAuthSecret(): string {
  return requireSecret('NEXTAUTH_SECRET');
}

/**
 * Get a secret, or return null if missing (for non-critical secrets
 * that have a legitimate degraded-mode fallback).
 *
 * Use sparingly — most secrets should use `requireSecret()` instead.
 */
export function getOptionalSecret(name: string): string | null {
  const value = process.env[name];
  if (!value || value.trim().length === 0) return null;
  return value;
}
