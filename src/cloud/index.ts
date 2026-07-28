/**
 * PaySwap Cloud — public entry point. (M-CLOUD-44.)
 *
 * Wires together the TenantManager, ProgramManager, DeploymentManager,
 * BillingManager, and CloudAudit services into a single Cloud Engine.
 *
 * The Cloud layer is a NEW top-level dir parallel to `src/runtime/`,
 * `src/trust/`, `src/sdk/`, `src/identity/`, and `src/ops/`. It does NOT
 * modify the frozen kernel and does NOT modify the Prisma schema — it
 * maintains an in-memory store of tenants, members, programs, deployments,
 * subscriptions, and audit entries.
 */

export * from './types';
export {
  store,
  slugify,
  uniqueSlug,
  ids,
  seedCloudStore,
  type CloudStore,
} from './store';
export { tenantManager, roleRank, type CreateTenantInput, type TenantLimitCheck } from './tenant-manager';
export { programManager, type CreateProgramInput } from './program-manager';
export { deploymentManager, type DeployInput } from './deployment-manager';
export { billingManager } from './billing-manager';
export { cloudAudit, type AuditFilter } from './audit';

import { tenantManager } from './tenant-manager';
import { programManager } from './program-manager';
import { deploymentManager } from './deployment-manager';
import { billingManager } from './billing-manager';
import { cloudAudit } from './audit';
import { store } from './store';
import type {
  CloudTenant,
  CloudTenantType,
  CloudPlan,
  CloudTenantStatus,
  CloudOverview,
} from './types';

/**
 * The Cloud Engine is the unified handle for the entire PaySwap Cloud layer.
 * Each sub-service is independently accessible (e.g., `cloudEngine.tenants`
 * is the same instance as the exported `tenantManager` singleton).
 */
export interface CloudEngine {
  tenants: typeof tenantManager;
  programs: typeof programManager;
  deployments: typeof deploymentManager;
  billing: typeof billingManager;
  audit: typeof cloudAudit;
  /** Convenience: get a tenant by ID (delegates to tenant manager). */
  getTenant(tenantId: string): Promise<CloudTenant | null>;
  /** Compute a dashboard overview for the admin cloud console. */
  overview(): CloudOverview;
}

export const cloudEngine: CloudEngine = {
  tenants: tenantManager,
  programs: programManager,
  deployments: deploymentManager,
  billing: billingManager,
  audit: cloudAudit,

  async getTenant(tenantId) {
    return tenantManager.get(tenantId);
  },

  overview(): CloudOverview {
    const tenants = Array.from(store.tenants.values());
    const byType = {
      organization: 0, government: 0, developer_org: 0, enterprise: 0,
    } as Record<CloudTenantType, number>;
    const byPlan = {
      free: 0, starter: 0, growth: 0, scale: 0, enterprise: 0,
    } as Record<CloudPlan, number>;
    const byStatus = {
      active: 0, suspended: 0, terminated: 0,
    } as Record<CloudTenantStatus, number>;

    let totalMembers = 0;
    let totalMrr = 0;

    for (const t of tenants) {
      byType[t.type] += 1;
      byPlan[t.plan] += 1;
      byStatus[t.status] += 1;
      totalMembers += t.members.length;
      // Sum the base plan amount for active subscriptions.
      if (t.status !== 'terminated') {
        const sub = store.subscriptions.get(t.id);
        if (sub && sub.status === 'active') totalMrr += sub.amount;
      }
    }

    const totalPrograms = Array.from(store.programs.values())
      .filter((p) => tenants.some((t) => t.id === p.tenantId))
      .length;
    const totalDeployments = Array.from(store.deployments.values())
      .filter((d) => tenants.some((t) => t.id === d.tenantId))
      .length;
    const totalSubscriptions = Array.from(store.subscriptions.values())
      .filter((s) => tenants.some((t) => t.id === s.tenantId))
      .length;

    return {
      totalTenants: tenants.length,
      byType,
      byPlan,
      byStatus,
      totalMembers,
      totalPrograms,
      totalDeployments,
      totalSubscriptions,
      totalMrr,
      currency: 'USD',
    };
  },
};
