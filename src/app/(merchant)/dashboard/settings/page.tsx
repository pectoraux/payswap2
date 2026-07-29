import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { MerchantSettingsForm } from '@/components/merchant/settings-form';
import { requireMerchant } from '@/lib/auth-guards';
import { formatCurrency, formatDate, statusBadgeClass } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { merchant } = await requireMerchant();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your merchant profile and platform configuration."
      />

      {/* Status overview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account status</CardTitle>
          <CardDescription>Identity, KYC and tier information</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
            <div className="mt-1">
              <Badge variant="outline" className={statusBadgeClass(merchant.status)}>
                {merchant.status}
              </Badge>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Tier</div>
            <div className="mt-1">
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                {merchant.tier}
              </Badge>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">KYC level</div>
            <div className="mt-1 text-sm font-medium">{merchant.kycLevel} / 3</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Bond</div>
            <div className="mt-1 text-sm font-medium">
              {formatCurrency(Number(merchant.bond), merchant.currency)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Member since</div>
            <div className="mt-1 text-sm font-medium">{formatDate(merchant.createdAt)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Country</div>
            <div className="mt-1 text-sm font-medium">{merchant.country}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Currency</div>
            <div className="mt-1 text-sm font-medium">{merchant.currency}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Business type</div>
            <div className="mt-1 text-sm font-medium">{merchant.businessType ?? '—'}</div>
          </div>
        </CardContent>
      </Card>

      <MerchantSettingsForm merchant={merchant} />
    </div>
  );
}
