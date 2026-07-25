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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Liquidity provider profile and contact information."
      />

      {!lp ? (
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
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">LP profile</CardTitle>
              <CardDescription>Public information used for routing decisions.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field icon={<User className="h-4 w-4" />} label="Name" value={lp.name} />
                <Field icon={<Globe className="h-4 w-4" />} label="Country" value={lp.country} />
                <Field
                  icon={<Coins className="h-4 w-4" />}
                  label="Currencies"
                  value={
                    (() => {
                      try {
                        const parsed = JSON.parse(lp.currencies);
                        return Array.isArray(parsed) ? parsed.join(', ') : lp.currencies;
                      } catch {
                        return lp.currencies;
                      }
                    })()
                  }
                />
                <Field
                  icon={<Star className="h-4 w-4" />}
                  label="Reputation"
                  value={lp.reputation.toFixed(2)}
                />
                <Field
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label="Collateral"
                  value={`${lp.collateral.toLocaleString('en-US')} USD`}
                />
                <Field
                  icon={<Coins className="h-4 w-4" />}
                  label="Stake"
                  value={`${lp.stake.toLocaleString('en-US')} USD`}
                />
                <Field
                  icon={<CalendarDays className="h-4 w-4" />}
                  label="Joined"
                  value={new Date(lp.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                />
                <Field
                  icon={<CalendarDays className="h-4 w-4" />}
                  label="Updated"
                  value={fmtDate(lp.updatedAt)}
                />
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Account status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Tier
                  </span>
                  <StatusBadge status={lp.tier} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Status
                  </span>
                  <StatusBadge status={lp.status} />
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

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Need changes?</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Profile changes (stake, collateral, capacity) are managed by the treasury
                team. Reach out via your operator channel to request an update.
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
