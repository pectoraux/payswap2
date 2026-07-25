/**
 * PaySwap Protocol — Security — Role-Based Access Control (RBAC).
 *
 * Maps user/team roles to fine-grained permissions. A user may have
 * multiple roles; the union of permissions is granted. `super_admin`
 * grants every permission.
 *
 * Roles:
 *   viewer          — read-only across the merchant account
 *   analyst         — read + run simulations / reports
 *   developer       — read + manage API keys, webhooks, products
 *   admin           — full merchant account management
 *   owner           — admin + transfer ownership / close account
 *   treasury_admin  — treasury operations across merchants
 *   lp_admin        — LP lifecycle management across merchants
 *   super_admin     — wildcard (every permission)
 *
 * Permissions:
 *   payment:create | payment:refund | payment:view
 *   payout:request | payout:approve | payout:view
 *   merchant:onboard | merchant:verify | merchant:suspend | merchant:view
 *   treasury:freeze | treasury:rebalance | treasury:draw | treasury:view
 *   lp:register | lp:pause | lp:slash | lp:view
 *   api_key:create | api_key:revoke | api_key:view
 *   webhook:setup | webhook:view
 *   user:invite | user:remove | user:manage
 *   audit:view | audit:export
 *   settings:update
 *
 * Frozen-kernel compliance: imports only `eventEngine` from kernel (read-only).
 */
import { eventEngine } from '@/kernel/event';
import { auditLog, auditDenied } from './audit';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Role =
  | 'viewer'
  | 'analyst'
  | 'developer'
  | 'admin'
  | 'owner'
  | 'treasury_admin'
  | 'lp_admin'
  | 'super_admin';

export type Permission =
  | 'payment:create'
  | 'payment:refund'
  | 'payment:view'
  | 'payout:request'
  | 'payout:approve'
  | 'payout:view'
  | 'merchant:onboard'
  | 'merchant:verify'
  | 'merchant:suspend'
  | 'merchant:view'
  | 'treasury:freeze'
  | 'treasury:rebalance'
  | 'treasury:draw'
  | 'treasury:view'
  | 'lp:register'
  | 'lp:pause'
  | 'lp:slash'
  | 'lp:view'
  | 'api_key:create'
  | 'api_key:revoke'
  | 'api_key:view'
  | 'webhook:setup'
  | 'webhook:view'
  | 'user:invite'
  | 'user:remove'
  | 'user:manage'
  | 'audit:view'
  | 'audit:export'
  | 'settings:update';

export const ALL_PERMISSIONS: readonly Permission[] = [
  'payment:create', 'payment:refund', 'payment:view',
  'payout:request', 'payout:approve', 'payout:view',
  'merchant:onboard', 'merchant:verify', 'merchant:suspend', 'merchant:view',
  'treasury:freeze', 'treasury:rebalance', 'treasury:draw', 'treasury:view',
  'lp:register', 'lp:pause', 'lp:slash', 'lp:view',
  'api_key:create', 'api_key:revoke', 'api_key:view',
  'webhook:setup', 'webhook:view',
  'user:invite', 'user:remove', 'user:manage',
  'audit:view', 'audit:export',
  'settings:update',
] as const;

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN';
  readonly permission: Permission;
  readonly role: string;
  constructor(permission: Permission, role: string) {
    super(`Forbidden: role "${role}" lacks permission "${permission}"`);
    this.name = 'ForbiddenError';
    this.permission = permission;
    this.role = role;
  }
}

// ─── Role → Permission map ───────────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  viewer: new Set<Permission>([
    'payment:view', 'payout:view', 'merchant:view',
    'treasury:view', 'lp:view', 'webhook:view', 'api_key:view', 'audit:view',
  ]),
  analyst: new Set<Permission>([
    'payment:view', 'payout:view', 'merchant:view',
    'treasury:view', 'lp:view', 'webhook:view', 'api_key:view', 'audit:view', 'audit:export',
  ]),
  developer: new Set<Permission>([
    'payment:view', 'payment:create', 'payment:refund',
    'payout:view', 'payout:request',
    'merchant:view',
    'webhook:view', 'webhook:setup',
    'api_key:view', 'api_key:create', 'api_key:revoke',
    'audit:view',
    'settings:update',
  ]),
  admin: new Set<Permission>([
    'payment:view', 'payment:create', 'payment:refund',
    'payout:view', 'payout:request', 'payout:approve',
    'merchant:view', 'merchant:suspend',
    'webhook:view', 'webhook:setup',
    'api_key:view', 'api_key:create', 'api_key:revoke',
    'user:invite', 'user:remove',
    'audit:view', 'audit:export',
    'settings:update',
  ]),
  owner: new Set<Permission>([
    'payment:view', 'payment:create', 'payment:refund',
    'payout:view', 'payout:request', 'payout:approve',
    'merchant:view', 'merchant:suspend',
    'webhook:view', 'webhook:setup',
    'api_key:view', 'api_key:create', 'api_key:revoke',
    'user:invite', 'user:remove', 'user:manage',
    'audit:view', 'audit:export',
    'settings:update',
  ]),
  treasury_admin: new Set<Permission>([
    'treasury:view', 'treasury:freeze', 'treasury:rebalance', 'treasury:draw',
    'audit:view', 'audit:export',
  ]),
  lp_admin: new Set<Permission>([
    'lp:view', 'lp:register', 'lp:pause', 'lp:slash',
    'audit:view', 'audit:export',
  ]),
  // super_admin: handled as wildcard in `hasPermission` — empty set here for type completeness.
  super_admin: new Set<Permission>([]),
};

// ─── User type ───────────────────────────────────────────────────────────────

export interface UserLike {
  id: string;
  roles: Role[];
  merchantId?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true if the role grants the permission. `super_admin` returns true
 * for every permission.
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  if (role === 'super_admin') return true;
  return ROLE_PERMISSIONS[role].has(permission);
}

/**
 * Returns the user's roles. (Provided as a function so callers can override
 * with a custom user store later; default reads `user.roles`.)
 */
export function rolesForUser(user: UserLike): Role[] {
  return user.roles ?? [];
}

/**
 * Returns true if ANY of the user's roles grants the permission
 * (super_admin short-circuits to true).
 */
export function userHasPermission(user: UserLike, permission: Permission): boolean {
  const roles = rolesForUser(user);
  if (roles.includes('super_admin')) return true;
  return roles.some((r) => hasPermission(r, permission));
}

/**
 * Throws `ForbiddenError` if the user lacks the permission. Emits a
 * `security.permission_denied` event AND records an `audit.denied` audit
 * entry so every denial is captured (per Security Invariant #3).
 */
export function checkPermission(user: UserLike, permission: Permission): void {
  if (userHasPermission(user, permission)) return;
  eventEngine.emit('security.permission_denied', {
    userId: user.id,
    merchantId: user.merchantId,
    permission,
    roles: user.roles,
    ts: Date.now(),
  }, 0);
  auditDenied(auditLog, {
    type: 'user',
    id: user.id,
    merchantId: user.merchantId,
    role: user.roles.join(','),
  }, 'permission.denied', { type: 'permission', id: permission }, {
    permission,
    roles: user.roles,
  });
  // Use the highest role for the error message (best-effort).
  const role = user.roles[0] ?? 'none';
  throw new ForbiddenError(permission, role);
}

/** Returns a list of all permissions granted by the union of the user's roles. */
export function permissionsForUser(user: UserLike): Permission[] {
  if (user.roles.includes('super_admin')) return [...ALL_PERMISSIONS];
  const out = new Set<Permission>();
  for (const r of user.roles) {
    for (const p of ROLE_PERMISSIONS[r]) out.add(p);
  }
  return [...out];
}
