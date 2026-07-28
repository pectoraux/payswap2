import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth-guards';
import { cloudEngine, tenantManager } from '@/cloud';
import {
  CloudConsoleManager,
  type TenantSummary,
  type CloudOverviewSnapshot,
} from './cloud-console-manager';

export const dynamic = 'force-dynamic';

/**
 * /admin/cloud — PaySwap Cloud admin console.
 *
 * Lists every cloud tenant (organizations, governments, developer orgs,
 * enterprises) and lets admins drill into a tenant to manage its members,
 * programs, deployments, billing, and audit log.
 */
export default async function CloudAdminPage() {
  await requireAdmin();

  const tenants = tenantManager.list();
  tenants.sort((a, b) => b.createdAt - a.createdAt);

  const summaries: TenantSummary[] = tenants.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    type: t.type,
    plan: t.plan,
    region: t.region,
    status: t.status,
    ownerId: t.ownerId,
    createdAt: t.createdAt,
    memberCount: t.members.length,
    usage: t.usage,
    suspendedReason: t.suspendedReason,
    terminatedReason: t.terminatedReason,
  }));

  const overview: CloudOverviewSnapshot = cloudEngine.overview();

  return (
    <div className="space-y-6">
      <PageHeader
        title="PaySwap Cloud"
        description="Multi-tenant cloud platform — run your financial operating system on the shared kernel."
      />
      <CloudConsoleManager tenants={summaries} overview={overview} />
    </div>
  );
}
