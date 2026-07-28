import { requireAdmin } from '@/lib/auth-guards';
import { PageHeader } from '@/components/page-header';
import { claimsService, type Claim } from '@/claims';
import {
  AdminClaimsManager,
  type ClaimDTO,
  type ClaimsOverview,
} from './claims-manager';

export const dynamic = 'force-dynamic';

function serialize(c: Claim): ClaimDTO {
  return {
    ...c,
    createdAt: new Date(c.createdAt).toISOString(),
    updatedAt: new Date(c.updatedAt).toISOString(),
    resolvedAt: c.resolvedAt ? new Date(c.resolvedAt).toISOString() : null,
    evidence: c.evidence.map((e) => ({
      ...e,
      submittedAt: new Date(e.submittedAt).toISOString(),
    })),
    votes: c.votes.map((v) => ({
      ...v,
      votedAt: new Date(v.votedAt).toISOString(),
    })),
    resolution: c.resolution
      ? {
          ...c.resolution,
          resolvedAt: new Date(c.resolution.resolvedAt).toISOString(),
        }
      : null,
  };
}

/**
 * /admin/claims — Admin Claims Console.
 *
 * Lists every claim in the system, lets the admin drill into the detail
 * (evidence + votes + resolution) and resolve / veto any claim. The admin's
 * decision overrides the community vote and is fully audited.
 */
export default async function AdminClaimsPage() {
  await requireAdmin();

  const all = claimsService.list();
  const overview = claimsService.overview();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Claims"
        description="Disputes raised against transactions. Review evidence, community votes, and resolve / veto claims."
      />
      <AdminClaimsManager
        initial={all.map(serialize)}
        overview={overview as ClaimsOverview}
      />
    </div>
  );
}
