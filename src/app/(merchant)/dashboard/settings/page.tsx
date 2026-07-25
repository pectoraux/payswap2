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
  Coins,
} from 'lucide-react';
import {
  EditSettingsForm,
  type MerchantSettings,
} from '@/components/merchant/edit-settings-form';

export const dynamic = 'force-dynamic';

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

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userId = (session?.user as any)?.id;
  const userRole = await db.userRole.findFirst({
    where: { userId, role: { in: ['MERCHANT', 'MERCHANT_STAFF'] } },
  });
  const merchantId = userRole?.merchantId;
  if (!merchantId) redirect('/unauthorized');

  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) redirect('/unauthorized');

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: merchant.currency }).format(n);

  const settings: MerchantSettings = {
    id: merchant.id,
    name: merchant.name,
    email: merchant.email,
    phone: merchant.phone,
    description: merchant.description,
    website: merchant.website,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your merchant profile and business details.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Business profile</CardTitle>
            <CardDescription>
              Public information shown to your customers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EditSettingsForm merchant={settings} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Account status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </span>
                <StatusBadge status={merchant.status} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Tier
                </span>
                <StatusBadge status={merchant.tier} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  KYC level
                </span>
                <span className="text-sm font-semibold">{merchant.kycLevel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Bond
                </span>
                <span className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {fmt(merchant.bond)}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Read-only details</CardTitle>
              <CardDescription>
                Country, currency, and registration data. Contact support to
                change these.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <ReadOnlyField icon={<Globe className="h-4 w-4" />} label="Country" value={merchant.country} />
                <ReadOnlyField icon={<Coins className="h-4 w-4" />} label="Currency" value={merchant.currency} />
                <ReadOnlyField icon={<Building2 className="h-4 w-4" />} label="Business type" value={merchant.businessType} />
                <ReadOnlyField icon={<Building2 className="h-4 w-4" />} label="Registration #" value={merchant.registrationNumber} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

