import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import {
  Building2,
  Globe,
  Crown,
  Users,
} from 'lucide-react';
import { getOrgContext } from '@/lib/org-context';
import { OrganizationSettingsForm, type OrganizationSettings } from '@/components/merchant/organization-settings-form';

export const dynamic = 'force-dynamic';

const PLAN_LIMITS: Record<string, { transactions: string; fee: string }> = {
  starter: { transactions: '100 / month', fee: '2%' },
  growth: { transactions: '5,000 / month', fee: '1.5%' },
  scale: { transactions: '50,000 / month', fee: '1%' },
  enterprise: { transactions: 'Unlimited', fee: '0.5%' },
};

const ROLE_BADGE_CLASS: Record<string, string> = {
  owner: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  admin: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  developer: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  analyst: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  finance: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  support: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  viewer: 'bg-muted text-muted-foreground',
};

function ReadOnlyField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card/50 p-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="truncate text-sm font-medium">{value || '—'}</div>
      </div>
    </div>
  );
}

export default async function OrganizationSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userId = (session?.user as any)?.id;
  if (!userId) redirect('/unauthorized');

  // Resolve the active organization from the cookie + memberships.
  const orgCtx = await getOrgContext(userId).catch(() => null);
  if (!orgCtx) {
    // Fall back to the user's merchant scope — the page still renders so the
    // merchant can manage org-equivalent fields directly on the merchant
    // record via the General settings page.
    redirect('/dashboard/settings');
  }

  const organization = await db.organization.findUnique({
    where: { id: orgCtx.organizationId },
    include: {
      members: {
        orderBy: { invitedAt: 'desc' },
        include: { user: { select: { name: true, email: true } } },
      },
    },
  });

  if (!organization) redirect('/unauthorized');

  // Determine whether the current user can edit (owner or admin).
  const canEdit =
    orgCtx.role === 'owner' || orgCtx.role === 'admin';

  const settings: OrganizationSettings = {
    id: organization.id,
    name: organization.name,
    billingEmail: organization.billingEmail ?? '',
    country: organization.country ?? '',
    currency: organization.currency,
    plan: organization.plan,
  };

  const planLimits = PLAN_LIMITS[organization.plan] ?? PLAN_LIMITS.starter;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Organization</h1>
        <p className="text-sm text-muted-foreground">
          Manage your organization profile, billing contact, and team members.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Editable org profile */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Organization profile</CardTitle>
            <CardDescription>
              {canEdit
                ? 'These details appear on invoices, in the workspace switcher, and across reports.'
                : 'You need owner or admin privileges to edit these details.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OrganizationSettingsForm organization={settings} canEdit={canEdit} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* Plan + limits */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Plan &amp; limits</CardTitle>
              <CardDescription>
                The subscription tier applied to this organization.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Plan
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold capitalize text-emerald-600 dark:text-emerald-400">
                  <Crown className="h-3 w-3" />
                  {organization.plan}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Transactions
                </span>
                <span className="text-sm font-semibold">{planLimits.transactions}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Fee
                </span>
                <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {planLimits.fee}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Type
                </span>
                <span className="text-sm font-medium capitalize">{organization.type}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </span>
                <StatusBadge status={organization.status} />
              </div>
            </CardContent>
          </Card>

          {/* Read-only details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Read-only details</CardTitle>
              <CardDescription>
                Identity fields managed by the platform.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <ReadOnlyField
                  icon={<Globe className="h-4 w-4" />}
                  label="Slug"
                  value={organization.slug}
                />
                <ReadOnlyField
                  icon={<Building2 className="h-4 w-4" />}
                  label="Type"
                  value={organization.type}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Team members */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <div>
              <CardTitle className="text-base">Team members</CardTitle>
              <CardDescription>
                {organization.members.length} member
                {organization.members.length === 1 ? '' : 's'} in this organization
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {organization.members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Users className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No members yet</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Members of this organization will appear here once they accept their invitation.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Member</th>
                    <th className="pb-2 pr-4 font-medium">Role</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {organization.members.map((m) => (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="py-3 pr-4">
                        <div className="font-medium">
                          {m.user?.name ?? m.user?.email ?? 'Invited user'}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {m.user?.email ?? '—'}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize ${
                            ROLE_BADGE_CLASS[m.role] ?? ROLE_BADGE_CLASS.viewer
                          }`}
                        >
                          {m.role === 'owner' && <Crown className="h-3 w-3" />}
                          {m.role}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={m.status} />
                      </td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">
                        {m.joinedAt
                          ? new Date(m.joinedAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : 'Pending'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
