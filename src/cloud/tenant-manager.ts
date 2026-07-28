/**
 * PaySwap Cloud — Tenant Manager. (M-CLOUD-44.)
 *
 * The TenantManager is the canonical source of truth for cloud tenants. It
 * owns tenant CRUD, member management (invite / remove / role change), usage
 * tracking, and limit checks.
 *
 * Every operation that mutates a tenant emits a CloudAuditEntry (via the
 * CloudAudit service) so the audit log stays in sync.
 */

import type {
  CloudTenant,
  CloudTenantMember,
  CloudTenantType,
  CloudPlan,
  CloudUsage,
  CloudTenantConfig,
  CloudTenantRole,
} from './types';
import { getPlanDefinition } from './types';
import { store, ids, slugify, uniqueSlug } from './store';
import { cloudAudit } from './audit';

export interface CreateTenantInput {
  name: string;
  slug?: string;
  type: CloudTenantType;
  plan: CloudPlan;
  region: string;
  ownerId: string;
  complianceRegion?: CloudTenantConfig['complianceRegion'];
  branding?: CloudTenantConfig['branding'];
}

export interface TenantLimitCheck {
  exceeded: boolean;
  current: number;
  limit: number;
  resource: string;
}

class TenantManager {
  /** Create a new tenant. The owner becomes the first member (role: owner). */
  async create(data: CreateTenantInput): Promise<CloudTenant> {
    const slug = data.slug ? uniqueSlug(data.slug) : uniqueSlug(data.name);
    const planDef = getPlanDefinition(data.plan);
    const now = Date.now();

    const tenantId = ids.tenant();
    const ownerId = ids.member();

    const member: CloudTenantMember = {
      id: ownerId,
      tenantId,
      userId: data.ownerId,
      role: 'owner',
      invitedAt: now,
      joinedAt: now,
    };

    const tenant: CloudTenant = {
      id: tenantId,
      name: data.name,
      slug,
      type: data.type,
      plan: data.plan,
      region: data.region,
      status: 'active',
      ownerId: data.ownerId,
      createdAt: now,
      members: [member],
      config: {
        features: planDef.features,
        limits: planDef.limits,
        branding: data.branding,
        complianceRegion: data.complianceRegion ?? 'GLOBAL',
      },
      usage: {
        merchants: 0,
        lps: 0,
        transactionsThisMonth: 0,
        apiRequestsThisMinute: 0,
        storageUsedGB: 0,
        extensionsInstalled: 0,
        lastResetAt: now,
      },
    };

    store.tenants.set(tenantId, tenant);
    store.slugIndex.set(slug, tenantId);
    const set = store.userTenants.get(data.ownerId) ?? new Set<string>();
    set.add(tenantId);
    store.userTenants.set(data.ownerId, set);

    await cloudAudit.record({
      tenantId,
      actorId: data.ownerId,
      action: 'tenant.created',
      resourceId: tenantId,
      resourceType: 'tenant',
      details: { name: data.name, slug, type: data.type, plan: data.plan, region: data.region },
    });

    return tenant;
  }

  /** Get a tenant by ID. */
  async get(tenantId: string): Promise<CloudTenant | null> {
    return store.tenants.get(tenantId) ?? null;
  }

  /** Get a tenant by slug. */
  async getBySlug(slug: string): Promise<CloudTenant | null> {
    const id = store.slugIndex.get(slug);
    if (!id) return null;
    return store.tenants.get(id) ?? null;
  }

  /** List all tenants. */
  list(filter?: {
    type?: CloudTenantType;
    plan?: CloudPlan;
    status?: CloudTenant['status'];
    q?: string;
  }): CloudTenant[] {
    const all = Array.from(store.tenants.values());
    if (!filter) return all;
    return all.filter((t) => {
      if (filter.type && t.type !== filter.type) return false;
      if (filter.plan && t.plan !== filter.plan) return false;
      if (filter.status && t.status !== filter.status) return false;
      if (filter.q) {
        const q = filter.q.toLowerCase();
        const matches = t.name.toLowerCase().includes(q) || t.slug.includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }

  /** List tenants that a user has access to (by membership). */
  async listForUser(userId: string): Promise<CloudTenant[]> {
    const ids = store.userTenants.get(userId);
    if (!ids || ids.size === 0) return [];
    const out: CloudTenant[] = [];
    for (const id of ids) {
      const t = store.tenants.get(id);
      if (t) out.push(t);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Update a tenant's mutable fields. */
  async update(
    tenantId: string,
    updates: {
      name?: string;
      region?: string;
      config?: Partial<CloudTenantConfig>;
    },
    actorId?: string,
  ): Promise<void> {
    const tenant = store.tenants.get(tenantId);
    if (!tenant) return;

    if (updates.name && updates.name !== tenant.name) {
      tenant.name = updates.name;
    }
    if (updates.region) {
      tenant.region = updates.region;
    }
    if (updates.config) {
      tenant.config = { ...tenant.config, ...updates.config };
    }

    await cloudAudit.record({
      tenantId,
      actorId: actorId ?? 'system',
      action: 'tenant.updated',
      resourceId: tenantId,
      resourceType: 'tenant',
      details: { updates } as Record<string, unknown>,
    });
  }

  /** Suspend a tenant (block all access, keep data). */
  async suspend(tenantId: string, reason: string, actorId?: string): Promise<void> {
    const tenant = store.tenants.get(tenantId);
    if (!tenant) return;
    tenant.status = 'suspended';
    tenant.suspendedAt = Date.now();
    tenant.suspendedReason = reason;

    await cloudAudit.record({
      tenantId,
      actorId: actorId ?? 'system',
      action: 'tenant.suspended',
      resourceId: tenantId,
      resourceType: 'tenant',
      details: { reason },
    });
  }

  /** Reactivate a suspended tenant. */
  async reactivate(tenantId: string, actorId?: string): Promise<void> {
    const tenant = store.tenants.get(tenantId);
    if (!tenant) return;
    tenant.status = 'active';
    tenant.suspendedAt = undefined;
    tenant.suspendedReason = undefined;

    await cloudAudit.record({
      tenantId,
      actorId: actorId ?? 'system',
      action: 'tenant.reactivated',
      resourceId: tenantId,
      resourceType: 'tenant',
      details: {},
    });
  }

  /** Permanently terminate a tenant. */
  async terminate(tenantId: string, reason: string, actorId?: string): Promise<void> {
    const tenant = store.tenants.get(tenantId);
    if (!tenant) return;
    tenant.status = 'terminated';
    tenant.terminatedAt = Date.now();
    tenant.terminatedReason = reason;

    await cloudAudit.record({
      tenantId,
      actorId: actorId ?? 'system',
      action: 'tenant.terminated',
      resourceId: tenantId,
      resourceType: 'tenant',
      details: { reason },
    });
  }

  /** Add a member to a tenant (invite). */
  async addMember(
    tenantId: string,
    userId: string,
    role: CloudTenantRole,
    invitedBy?: string,
  ): Promise<CloudTenantMember | null> {
    const tenant = store.tenants.get(tenantId);
    if (!tenant) return null;
    const existing = tenant.members.find((m) => m.userId === userId);
    if (existing) return existing;

    const member: CloudTenantMember = {
      id: ids.member(),
      tenantId,
      userId,
      role,
      invitedAt: Date.now(),
      invitedBy,
    };
    tenant.members.push(member);
    const set = store.userTenants.get(userId) ?? new Set<string>();
    set.add(tenantId);
    store.userTenants.set(userId, set);

    await cloudAudit.record({
      tenantId,
      actorId: invitedBy ?? 'system',
      action: 'member.added',
      resourceId: member.id,
      resourceType: 'member',
      details: { userId, role },
    });

    return member;
  }

  /** Remove a member. */
  async removeMember(tenantId: string, userId: string, actorId?: string): Promise<void> {
    const tenant = store.tenants.get(tenantId);
    if (!tenant) return;
    const member = tenant.members.find((m) => m.userId === userId);
    if (!member) return;
    tenant.members = tenant.members.filter((m) => m.userId !== userId);
    const set = store.userTenants.get(userId);
    if (set) {
      set.delete(tenantId);
      if (set.size === 0) store.userTenants.delete(userId);
    }

    await cloudAudit.record({
      tenantId,
      actorId: actorId ?? 'system',
      action: 'member.removed',
      resourceId: member.id,
      resourceType: 'member',
      details: { userId },
    });
  }

  /** Update a member's role. */
  async updateMemberRole(
    tenantId: string,
    userId: string,
    role: CloudTenantRole,
    actorId?: string,
  ): Promise<void> {
    const tenant = store.tenants.get(tenantId);
    if (!tenant) return;
    const member = tenant.members.find((m) => m.userId === userId);
    if (!member) return;
    const previous = member.role;
    member.role = role;

    await cloudAudit.record({
      tenantId,
      actorId: actorId ?? 'system',
      action: 'member.role_updated',
      resourceId: member.id,
      resourceType: 'member',
      details: { userId, previous, role },
    });
  }

  /** Get a tenant's current usage. */
  async getUsage(tenantId: string): Promise<CloudUsage | null> {
    const tenant = store.tenants.get(tenantId);
    if (!tenant) return null;
    return tenant.usage;
  }

  /**
   * Check whether a tenant is at or above its limit for a given resource.
   * Resource keys: 'merchants', 'lps', 'transactionsThisMonth',
   * 'apiRequestsThisMinute', 'storageGB', 'extensionsInstalled'.
   */
  async checkLimit(
    tenantId: string,
    resource: string,
  ): Promise<TenantLimitCheck> {
    const tenant = store.tenants.get(tenantId);
    if (!tenant) {
      return { exceeded: false, current: 0, limit: 0, resource };
    }

    const limits = tenant.config.limits;
    const usage = tenant.usage;

    let current = 0;
    let limit = 0;
    switch (resource) {
      case 'merchants':
        current = usage.merchants;
        limit = limits.maxMerchants;
        break;
      case 'lps':
        current = usage.lps;
        limit = limits.maxLPs;
        break;
      case 'transactionsThisMonth':
        current = usage.transactionsThisMonth;
        limit = limits.maxTransactionsPerMonth;
        break;
      case 'apiRequestsThisMinute':
        current = usage.apiRequestsThisMinute;
        limit = limits.maxAPIRequestsPerMinute;
        break;
      case 'storageGB':
        current = usage.storageUsedGB;
        limit = limits.maxStorageGB;
        break;
      case 'extensionsInstalled':
        current = usage.extensionsInstalled;
        limit = limits.maxExtensions;
        break;
      default:
        return { exceeded: false, current: 0, limit: 0, resource };
    }

    return {
      exceeded: current >= limit,
      current,
      limit,
      resource,
    };
  }

  /**
   * Apply a usage delta (positive or negative). Used by the platform to
   * increment counters when merchants are created, transactions settle, etc.
   */
  async applyUsageDelta(
    tenantId: string,
    field: keyof CloudUsage,
    delta: number,
  ): Promise<void> {
    const tenant = store.tenants.get(tenantId);
    if (!tenant) return;
    if (field === 'lastResetAt') return;
    const next = Math.max(0, (tenant.usage[field] as number) + delta);
    (tenant.usage[field] as number) = next;
  }

  /**
   * Resolve whether a user has the requested role-or-higher on a tenant.
   * Role hierarchy: owner > admin > developer > operator > viewer.
   */
  async memberHasRole(
    tenantId: string,
    userId: string,
    minRole: CloudTenantRole,
  ): Promise<boolean> {
    const tenant = store.tenants.get(tenantId);
    if (!tenant) return false;
    const member = tenant.members.find((m) => m.userId === userId);
    if (!member) return false;
    return roleRank(member.role) >= roleRank(minRole);
  }
}

const ROLE_RANK: Record<CloudTenantRole, number> = {
  viewer: 1,
  operator: 2,
  developer: 3,
  admin: 4,
  owner: 5,
};

export function roleRank(role: CloudTenantRole): number {
  return ROLE_RANK[role];
}

export const tenantManager = new TenantManager();

// Re-export slugify for the API layer.
export { slugify };
