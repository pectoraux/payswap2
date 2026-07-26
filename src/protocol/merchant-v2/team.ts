/**
 * PaySwap Protocol — Merchant Platform (v2) — Team Management + RBAC.
 *
 * Team member invitations, role-based access control, and permission
 * enforcement. Members are scoped to either a merchant (`scopeType='merchant'`)
 * or an organisation (`scopeType='org'`).
 *
 * Roles + permission matrix:
 *   owner      → ['all']  (full control)
 *   admin      → ['manage_merchants', 'manage_members', 'api_keys', 'webhooks']
 *   developer  → ['api_keys', 'webhooks', 'test_payments']
 *   analyst    → ['analytics', 'reports']
 *   viewer     → ['read_only']
 *   support    → ['refunds', 'customers']
 *
 * `hasPermission(memberId, permission)` returns true if the member's role
 * grants the permission (owner's 'all' grants every permission).
 * `requirePermission(memberId, permission)` throws a `PermissionDeniedError`
 * if denied.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `merchant.team_member_invited`  — on `inviteMember`.
 *  - `merchant.team_member_accepted` — on `acceptInvitation`.
 *  - `merchant.team_member_removed`  — on `removeMember`.
 *  - `merchant.team_member_role_changed` — on `updateRole`.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type { TeamInvitation, TeamMember, TeamRole } from './types';

/** All permissions known to the RBAC matrix. */
export const ALL_PERMISSIONS: string[] = [
  'manage_merchants',
  'manage_members',
  'api_keys',
  'webhooks',
  'test_payments',
  'analytics',
  'reports',
  'read_only',
  'refunds',
  'customers',
];

/** Role → permission matrix. */
export const ROLE_PERMISSIONS: Record<TeamRole, string[]> = {
  owner: ['all'],
  admin: ['manage_merchants', 'manage_members', 'api_keys', 'webhooks'],
  developer: ['api_keys', 'webhooks', 'test_payments'],
  analyst: ['analytics', 'reports'],
  viewer: ['read_only'],
  support: ['refunds', 'customers'],
};

/** Compute the effective permission set for a role (expands 'all'). */
export function permissionsForRole(role: TeamRole): string[] {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  if (perms.includes('all')) return [...ALL_PERMISSIONS];
  return [...perms];
}

/** Thrown by `requirePermission` when access is denied. */
export class PermissionDeniedError extends Error {
  readonly memberId: string;
  readonly permission: string;
  readonly role: TeamRole | undefined;
  constructor(memberId: string, permission: string, role: TeamRole | undefined) {
    super(`Permission denied: member ${memberId} lacks '${permission}' (role=${role ?? 'none'})`);
    this.name = 'PermissionDeniedError';
    this.memberId = memberId;
    this.permission = permission;
    this.role = role;
  }
}

/** Invitation expiry (7 days). */
const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * TeamService owns the team-member records, outstanding invitations, and
 * the RBAC permission checks.
 */
export class TeamService {
  private members = new Map<string, TeamMember>();
  private invitations = new Map<string, TeamInvitation>();

  // -------------------------------------------------------------- inviteMember
  /**
   * Invite a team member to a scope (merchant or org). Creates a pending
   * `TeamMember` + a `TeamInvitation` (with token + 7-day expiry).
   */
  inviteMember(
    scope: string,
    scopeType: 'merchant' | 'org',
    email: string,
    role: TeamRole,
  ): TeamMember {
    const now = nowTs();
    const member: TeamMember = {
      id: uid('tm'),
      scope,
      scopeType,
      email,
      role,
      permissions: permissionsForRole(role),
      invitedAt: now,
      status: 'pending',
    };
    this.members.set(member.id, member);
    const invitation: TeamInvitation = {
      id: uid('tmi'),
      scope,
      scopeType,
      email,
      role,
      token: uid('tmit'),
      invitedAt: now,
      expiresAt: now + INVITATION_EXPIRY_MS,
    };
    this.invitations.set(invitation.id, invitation);
    eventEngine.emit('merchant.team_member_invited', {
      scope,
      scopeType,
      memberId: member.id,
      invitationId: invitation.id,
      email,
      role,
      expiresAt: invitation.expiresAt,
    });
    return member;
  }

  // ----------------------------------------------------------- acceptInvitation
  /**
   * Accept an outstanding invitation. Transitions the matching pending
   * member to 'active'. Returns the activated member, or `null` if the
   * invitation is missing, already accepted, or expired.
   */
  acceptInvitation(invitationId: string): TeamMember | null {
    const inv = this.invitations.get(invitationId);
    if (!inv) return null;
    if (typeof inv.acceptedAt === 'number') return null;
    if (nowTs() > inv.expiresAt) return null;
    // Find the matching pending member (same scope + email).
    const member = [...this.members.values()].find(
      (m) =>
        m.scope === inv.scope &&
        m.scopeType === inv.scopeType &&
        m.email === inv.email &&
        m.status === 'pending',
    );
    if (!member) return null;
    member.status = 'active';
    member.joinedAt = nowTs();
    inv.acceptedAt = member.joinedAt;
    eventEngine.emit('merchant.team_member_accepted', {
      scope: member.scope,
      scopeType: member.scopeType,
      memberId: member.id,
      invitationId,
      email: member.email,
      role: member.role,
    });
    return member;
  }

  // ---------------------------------------------------------------- removeMember
  removeMember(memberId: string): boolean {
    const m = this.members.get(memberId);
    if (!m) return false;
    this.members.delete(memberId);
    eventEngine.emit('merchant.team_member_removed', {
      scope: m.scope,
      scopeType: m.scopeType,
      memberId,
      email: m.email,
      role: m.role,
    });
    return true;
  }

  // ------------------------------------------------------------------ updateRole
  updateRole(memberId: string, role: TeamRole): TeamMember | null {
    const m = this.members.get(memberId);
    if (!m) return null;
    const previousRole = m.role;
    m.role = role;
    m.permissions = permissionsForRole(role);
    eventEngine.emit('merchant.team_member_role_changed', {
      scope: m.scope,
      scopeType: m.scopeType,
      memberId,
      email: m.email,
      previousRole,
      newRole: role,
    });
    return m;
  }

  // ----------------------------------------------------------------- getMembers
  getMembers(scope: string): TeamMember[] {
    return [...this.members.values()].filter((m) => m.scope === scope);
  }

  getMember(memberId: string): TeamMember | undefined {
    return this.members.get(memberId);
  }

  getInvitation(invitationId: string): TeamInvitation | undefined {
    return this.invitations.get(invitationId);
  }

  /** Find a member by email within a scope. */
  findByEmail(scope: string, email: string): TeamMember | undefined {
    return [...this.members.values()].find(
      (m) => m.scope === scope && m.email === email,
    );
  }

  // -------------------------------------------------------------- hasPermission
  /**
   * Check whether a member has a permission. Returns `false` if the
   * member is missing, suspended, or pending (only active members can
   * act).
   */
  hasPermission(memberId: string, permission: string): boolean {
    const m = this.members.get(memberId);
    if (!m) return false;
    if (m.status !== 'active') return false;
    if (m.permissions.includes('all')) return true;
    return m.permissions.includes(permission);
  }

  // ----------------------------------------------------------- requirePermission
  /**
   * Throw a `PermissionDeniedError` if the member lacks the permission.
   * Also throws if the member is missing, suspended, or pending.
   */
  requirePermission(memberId: string, permission: string): void {
    const m = this.members.get(memberId);
    if (!m) {
      throw new PermissionDeniedError(memberId, permission, undefined);
    }
    if (m.status !== 'active') {
      throw new PermissionDeniedError(memberId, permission, m.role);
    }
    if (m.permissions.includes('all')) return;
    if (!m.permissions.includes(permission)) {
      throw new PermissionDeniedError(memberId, permission, m.role);
    }
  }

  all(): TeamMember[] {
    return [...this.members.values()];
  }

  allInvitations(): TeamInvitation[] {
    return [...this.invitations.values()];
  }

  // --------------------------------------------------------------------- reset
  reset(): void {
    this.members.clear();
    this.invitations.clear();
  }
}

// Singleton.
const _g = globalThis as unknown as { __PAYSWAP_TEAM_SERVICE?: TeamService };
export const teamService: TeamService = _g.__PAYSWAP_TEAM_SERVICE ?? new TeamService();
if (!_g.__PAYSWAP_TEAM_SERVICE) _g.__PAYSWAP_TEAM_SERVICE = teamService;
