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
import { PageHeader, EmptyState, fmtDate } from '@/components/role-ui';
import {
  Settings,
  User,
  Globe,
  Coins,
  Star,
  ShieldCheck,
  CalendarDays,
  Lock,
} from 'lucide-react';
import { LpSettingsForm, type LpSettingsData } from '@/components/lp/lp-settings-form';

export const dynamic = 'force-dynamic';

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseMap(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

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

export default async function LpSettingsPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  const account = userId
    ? await db.account.findFirst({
        where: { userId, type: 'LP' },
        include: { lpProfile: true },
      })
    : null;

  const lp = account?.lpProfile ?? null;
  const user = userId ? await db.user.findUnique({ where: { id: userId } }) : null;

  const lpData: LpSettingsData | null = lp
    ? {
        id: lp.id,
        name: lp.name,
        country: lp.country,
        currencies: parseList(lp.currencies),
        tier: lp.tier,
        stake: lp.stake,
        collateral: lp.collateral,
        available: Math.max(0, lp.stake - lp.collateral),
        capacity: parseMap(lp.capacity),
        feeBps: parseMap(lp.feeBps),
        settlementSpeedMs: lp.settlementSpeedMs,
        reputation: lp.reputation,
        status: lp.status,
      }
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your fee configuration, settlement preferences, and per-corridor capacity."
      />

      {!lpData ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Settings className="h-6 w-6" />}
              title="No LP profile linked"
              description="Contact the treasury team to onboard your liquidity provider account."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Editable settings form */}
          <div className="space-y-6 lg:col-span-2">
            <LpSettingsForm lp={lpData} />
          </div>

          {/* Read-only sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">LP profile</CardTitle>
                <CardDescription>Public information used for routing decisions.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ReadOnlyField icon={<User className="h-4 w-4" />} label="Name" value={lpData.name} />
                  <ReadOnlyField icon={<Globe className="h-4 w-4" />} label="Country" value={lpData.country} />
                  <ReadOnlyField
                    icon={<Coins className="h-4 w-4" />}
                    label="Currencies"
                    value={lpData.currencies.length ? lpData.currencies.join(', ') : '—'}
                  />
                  <ReadOnlyField
                    icon={<CalendarDays className="h-4 w-4" />}
                    label="Joined"
                    value={new Date(lp!.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  />
                  <ReadOnlyField
                    icon={<CalendarDays className="h-4 w-4" />}
                    label="Updated"
                    value={fmtDate(lp!.updatedAt)}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Account status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Tier
                  </span>
                  <StatusBadge status={lpData.tier} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Status
                  </span>
                  <StatusBadge status={lpData.status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5" /> Collateral
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {lpData.collateral.toLocaleString('en-US', { maximumFractionDigits: 0 })} USD
                  </span>
                </div>
                {user && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Login email
                    </span>
                    <span className="truncate text-xs font-medium">{user.email}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-amber-500/20 bg-amber-500/[0.02]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  Reputation (read-only)
                </CardTitle>
                <CardDescription>
                  Computed by the protocol from settlement outcomes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2">
                  <Star className="h-4 w-4 text-amber-500" />
                  <span className="text-2xl font-bold tabular-nums">
                    {lpData.reputation.toFixed(2)}
                  </span>
                  <span className="text-xs text-muted-foreground">/ 1.00</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Reputation cannot be edited manually. It updates automatically as
                  you settle payments and is used by the router when selecting LPs.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
