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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtCurrency,
  fmtNumber,
  fmtDate,
} from '@/components/role-ui';
import {
  Briefcase,
  ShieldCheck,
  Star,
  Gauge,
  ArrowLeftRight,
  Coins,
  Globe,
} from 'lucide-react';

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

function parseCapacity(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

export default async function LpOverviewPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  const account = userId
    ? await db.account.findFirst({
        where: { userId, type: 'LP' },
        include: { lpProfile: true },
      })
    : null;

  const lp = account?.lpProfile ?? null;
  const currencies = parseList(lp?.currencies);
  const capacity = parseCapacity(lp?.capacity);
  const totalCapacity = Object.values(capacity).reduce((s, n) => s + n, 0);
  const utilization =
    lp && lp.collateral > 0
      ? Math.min(100, Math.round(((lp.stake - lp.collateral) / lp.stake) * 100))
      : 0;

  // Recent settlement activity for this LP (by lpId on payments)
  const settlements = lp
    ? await db.payment.findMany({
        where: { lpId: lp.id, status: 'COMPLETED' },
        orderBy: { settledAt: 'desc' },
        take: 10,
      })
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${lp?.name || session?.user?.name || 'LP'}`}
        description="Your liquidity positions, capacity and settlement activity."
      />

      {!lp ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Briefcase className="h-6 w-6" />}
              title="No LP profile linked"
              description="Contact the treasury team to onboard your liquidity provider account."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Stake"
              value={fmtCurrency(lp.stake, 'USD')}
              hint="Total committed"
              icon={<Coins className="h-4 w-4" />}
              tone="emerald"
            />
            <KpiCard
              label="Collateral"
              value={fmtCurrency(lp.collateral, 'USD')}
              hint="Posted"
              icon={<ShieldCheck className="h-4 w-4" />}
              tone="teal"
            />
            <KpiCard
              label="Reputation"
              value={fmtNumber(lp.reputation, 2)}
              hint="Out of 1.00"
              icon={<Star className="h-4 w-4" />}
              tone="amber"
            />
            <KpiCard
              label="Capacity utilisation"
              value={`${utilization}%`}
              hint={fmtCurrency(totalCapacity, 'USD') + ' total'}
              icon={<Gauge className="h-4 w-4" />}
              tone="cyan"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Recent settlements</CardTitle>
                <CardDescription>Latest payments routed through your liquidity</CardDescription>
              </CardHeader>
              <CardContent>
                {settlements.length === 0 ? (
                  <EmptyState
                    icon={<ArrowLeftRight className="h-6 w-6" />}
                    title="No settlements yet"
                    description="When payments are routed through your liquidity, settlements will appear here."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>Corridor</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Settled</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {settlements.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-mono text-xs">
                            {s.reference || s.id.slice(0, 12)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {s.corridor || '—'}
                          </TableCell>
                          <TableCell className="font-semibold tabular-nums">
                            {fmtCurrency(s.amount, s.currency)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={s.status} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {fmtDate(s.settledAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Position summary</CardTitle>
                <CardDescription>LP profile snapshot</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Tier</span>
                  <StatusBadge status={lp.tier} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <StatusBadge status={lp.status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Country</span>
                  <span className="font-medium">{lp.country}</span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-muted-foreground">Currencies</span>
                  <div className="flex flex-wrap justify-end gap-1">
                    {currencies.length === 0 ? (
                      <span className="text-xs">—</span>
                    ) : (
                      currencies.map((c) => (
                        <span
                          key={c}
                          className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                        >
                          {c}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-muted-foreground">Capacity</span>
                  <div className="flex flex-wrap justify-end gap-1">
                    {Object.keys(capacity).length === 0 ? (
                      <span className="text-xs">—</span>
                    ) : (
                      Object.entries(capacity).map(([k, v]) => (
                        <span
                          key={k}
                          className="rounded bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-600 dark:text-teal-400"
                        >
                          {k}: {fmtCurrency(v, 'USD')}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Joined</span>
                  <span className="font-medium">{fmtDate(lp.createdAt)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
