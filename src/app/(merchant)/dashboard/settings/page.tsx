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
  Mail,
  Phone,
  Globe,
  Coins,
  FileText,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

function Field({
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
            <div className="grid gap-3 sm:grid-cols-2">
              <Field icon={<Building2 className="h-4 w-4" />} label="Merchant name" value={merchant.name} />
              <Field icon={<Mail className="h-4 w-4" />} label="Email" value={merchant.email} />
              <Field icon={<Phone className="h-4 w-4" />} label="Phone" value={merchant.phone} />
              <Field icon={<Globe className="h-4 w-4" />} label="Country" value={merchant.country} />
              <Field icon={<Coins className="h-4 w-4" />} label="Currency" value={merchant.currency} />
              <Field icon={<Building2 className="h-4 w-4" />} label="Business type" value={merchant.businessType} />
            </div>
            <div className="mt-3 rounded-lg border bg-card/50 p-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Description
                </span>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {merchant.description || 'No description provided.'}
              </p>
            </div>
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
              <CardTitle className="text-base">Legal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Registration #</span>
                <span className="font-medium">{merchant.registrationNumber || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tax ID</span>
                <span className="font-medium">{merchant.taxId || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Website</span>
                <span className="font-medium truncate max-w-[12rem]">{merchant.website || '—'}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
