import { PageHeader } from '@/components/page-header';
import { WaitlistManager, type WaitlistRow } from '@/components/admin/waitlist-manager';
import { requireAdmin } from '@/lib/auth-guards';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AdminWaitlistPage() {
  await requireAdmin();

  const entries = await db.waitlistEntry.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const rows: WaitlistRow[] = entries.map((e) => ({
    id: e.id,
    name: e.name,
    email: e.email,
    company: e.company,
    country: e.country,
    businessType: e.businessType,
    accountType: e.accountType,
    useCase: e.useCase,
    monthlyVolume: e.monthlyVolume,
    referralSource: e.referralSource,
    status: e.status,
    createdAt: e.createdAt.toISOString(),
    reviewedAt: e.reviewedAt?.toISOString() ?? null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Waitlist"
        description="Review applications and convert promising leads into active accounts."
      />
      <WaitlistManager entries={rows} />
    </div>
  );
}
