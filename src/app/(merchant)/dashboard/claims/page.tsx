import { requireMerchant } from '@/lib/auth-guards';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { claimsService, type Claim } from '@/claims';
import {
  MerchantClaimsManager,
  type ClaimDTO,
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
 * /dashboard/claims — Merchant Claims Console.
 *
 * Merchants can:
 *   - Create a claim (dispute a transaction)
 *   - View their claims and status
 *   - Submit additional evidence on their own claims
 *   - Cast a community vote (support / reject)
 *
 * The claims are scoped to the merchant's merchantId when fetched via the API.
 */
export default async function MerchantClaimsPage() {
  const ctx = await requireMerchant().catch(() => null);
  if (!ctx) redirect('/unauthorized');
  const { merchant } = ctx;

  // Load this merchant's claims from the in-memory store. Seeded claims are
  // associated with seed merchant IDs; when the merchant's actual id matches
  // we'll show them, otherwise the list will be empty until they create one.
  const all = claimsService.list({ merchantId: merchant.id });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Claims"
        description="Dispute a transaction, submit evidence, and let the community + admins vote on the outcome."
      />
      <MerchantClaimsManager initial={all.map(serialize)} />
    </div>
  );
}
