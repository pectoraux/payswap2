/**
 * PaySwap Protocol — Security — API Scopes.
 *
 * Fine-grained OAuth2-style scopes that gate API endpoints. A token's
 * `scope` claim is a string array; `hasScope(tokenScopes, required)` is
 * the canonical check. `admin:*` is a wildcard that grants every scope.
 *
 * Hierarchy:
 *   admin:*              → every scope
 *   treasury:admin       → treasury:read
 *   lp:admin             → lp:read
 *   ops:admin            → ops:read
 *
 * Frozen-kernel compliance: no kernel imports (pure module).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type ApiScope =
  | 'payments:read'
  | 'payments:write'
  | 'payouts:read'
  | 'payouts:write'
  | 'webhooks:read'
  | 'webhooks:write'
  | 'merchant:read'
  | 'merchant:write'
  | 'treasury:read'
  | 'treasury:admin'
  | 'lp:read'
  | 'lp:admin'
  | 'admin:*'
  | 'ops:read'
  | 'ops:admin';

export const ALL_SCOPES: readonly ApiScope[] = [
  'payments:read',
  'payments:write',
  'payouts:read',
  'payouts:write',
  'webhooks:read',
  'webhooks:write',
  'merchant:read',
  'merchant:write',
  'treasury:read',
  'treasury:admin',
  'lp:read',
  'lp:admin',
  'admin:*',
  'ops:read',
  'ops:admin',
] as const;

/** Human-readable descriptions for each scope (for consent screens). */
export const SCOPE_DESCRIPTIONS: Record<ApiScope, string> = {
  'payments:read': 'Read payment history and status',
  'payments:write': 'Create and refund payments',
  'payouts:read': 'Read payout history and status',
  'payouts:write': 'Request and process payouts',
  'webhooks:read': 'Read webhook endpoint configurations',
  'webhooks:write': 'Register, update, and delete webhook endpoints',
  'merchant:read': 'Read merchant account details',
  'merchant:write': 'Update merchant account settings',
  'treasury:read': 'Read treasury positions and reserves',
  'treasury:admin': 'Administer treasury: freeze, rebalance, draw stablecoin',
  'lp:read': 'Read liquidity provider registrations and stakes',
  'lp:admin': 'Administer LPs: register, pause, slash',
  'admin:*': 'Wildcard — grants every scope (super-admin only)',
  'ops:read': 'Read operational metrics, logs, and dashboards',
  'ops:admin': 'Administer ops: manage alert rules, SLOs, exporters',
};

/**
 * Scope hierarchy: each admin-level scope implies the corresponding read-level
 * scope. `admin:*` implies everything.
 */
export const SCOPE_HIERARCHY: Partial<Record<ApiScope, ApiScope[]>> = {
  'admin:*': [
    'payments:read', 'payments:write',
    'payouts:read', 'payouts:write',
    'webhooks:read', 'webhooks:write',
    'merchant:read', 'merchant:write',
    'treasury:read', 'treasury:admin',
    'lp:read', 'lp:admin',
    'ops:read', 'ops:admin',
  ],
  'treasury:admin': ['treasury:read'],
  'lp:admin': ['lp:read'],
  'ops:admin': ['ops:read'],
  'payments:write': ['payments:read'],
  'payouts:write': ['payouts:read'],
  'webhooks:write': ['webhooks:read'],
  'merchant:write': ['merchant:read'],
};

// ─── Errors ──────────────────────────────────────────────────────────────────

export class InsufficientScopeError extends Error {
  readonly code = 'INSUFFICIENT_SCOPE';
  readonly required: ApiScope;
  readonly granted: string[];
  constructor(required: ApiScope, granted: string[]) {
    super(`Insufficient scope: requires "${required}", granted [${granted.join(', ')}]`);
    this.name = 'InsufficientScopeError';
    this.required = required;
    this.granted = granted;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Expand a set of scopes by applying the hierarchy. Returns a new array
 * including all implied scopes.
 */
export function expandScopes(scopes: readonly string[]): ApiScope[] {
  const out = new Set<ApiScope>();
  for (const s of scopes) {
    if (!isApiScope(s)) continue;
    out.add(s);
    const implied = SCOPE_HIERARCHY[s];
    if (implied) {
      for (const i of implied) out.add(i);
    }
  }
  return [...out];
}

/** Type guard: is `s` a valid ApiScope? */
export function isApiScope(s: string): s is ApiScope {
  return (ALL_SCOPES as readonly string[]).includes(s);
}

/**
 * Returns true if the token grants the required scope.
 * `admin:*` always returns true (wildcard).
 */
export function hasScope(tokenScopes: readonly string[], required: ApiScope): boolean {
  if (tokenScopes.includes('admin:*')) return true;
  const expanded = new Set<string>(expandScopes(tokenScopes));
  return expanded.has(required);
}

/**
 * Throws `InsufficientScopeError` if the token lacks the required scope.
 */
export function requireScopes(tokenScopes: readonly string[], required: ApiScope): void {
  if (!hasScope(tokenScopes, required)) {
    throw new InsufficientScopeError(required, [...tokenScopes]);
  }
}

/**
 * Returns the list of scopes that would be granted if `scopes` were issued.
 * Useful for the API key creation UI to preview effective permissions.
 */
export function effectiveScopes(scopes: readonly string[]): ApiScope[] {
  return expandScopes(scopes);
}
