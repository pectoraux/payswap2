import Link from 'next/link';
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
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
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
  ArrowRight,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { LpAiRecommendations } from '@/components/lp/ai-recommendations';

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

  // Open positions: payments where this LP is the designated LP and status is in-flight
  const [openPositions, openPositionsAgg, settlementsAgg, recentSettlements] =
    lp
      ? await Promise.all([
          db.payment.count({
            where: {
              lpId: lp.id,
              status: { in: ['PENDING', 'PROCESSING', 'AUTHORIZED'] },
            },
          }),
          db.payment.aggregate({
            where: {
              lpId: lp.id,
              status: { in: ['PENDING', 'PROCESSING', 'AUTHORIZED'] },
            },
            _sum: { amount: true },
          }),
          db.payment.aggregate({
            where: { lpId: lp.id, status: 'COMPLETED' },
            _sum: { amount: true, fee: true },
            _count: { _all: true },
          }),
          db.payment.findMany({
            where: { lpId: lp.id, status: 'COMPLETED' },
            orderBy: { settledAt: 'desc' },
            take: 10,
          }),
        ])
      : [
          0,
          { _sum: { amount: 0 } },
          { _sum: { amount: 0, fee: 0 }, _count: { _all: 0 } },
          [],
        ];

  const openVolume = openPositionsAgg._sum.amount ?? 0;
  const settledVolume = settlementsAgg._sum.amount ?? 0;
  const earnedFees = settlementsAgg._sum.fee ?? 0;
  const settledCount = settlementsAgg._count._all ?? 0;

  const availableCapacity = lp ? Math.max(0, lp.stake - lp.collateral) : 0;
  const utilization =
    lp && lp.stake > 0
      ? Math.min(100, Math.round((lp.collateral / lp.stake) * 100))
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${lp?.name || session?.user?.name || 'LP'}`}
        description="Your liquidity positions, capacity and settlement activity."
        action={
          lp ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/lp/positions">
                  <Briefcase className="h-4 w-4" />
                  View positions
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700">
                <Link href="/lp/settlements">
                  <ArrowLeftRight className="h-4 w-4" />
                  View settlements
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          ) : undefined
        }
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
              hint={`${fmtCurrency(availableCapacity, 'USD')} available`}
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
              hint={`${fmtCurrency(totalCapacity, 'USD')} total`}
              icon={<Gauge className="h-4 w-4" />}
              tone="cyan"
            />
          </div>

          <LpAiRecommendations />

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">Recent settlements</CardTitle>
                    <CardDescription>
                      Latest payments routed through your liquidity
                    </CardDescription>
                  </div>
                  <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
                    <Link href="/lp/settlements">
                      All <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {recentSettlements.length === 0 ? (
                  <EmptyState
                    icon={<ArrowLeftRight className="h-6 w-6" />}
                    title="No settlements yet"
                    description="When payments are routed through your liquidity, settlements will appear here."
                  />
                ) : (
                  <div className="max-h-96 overflow-y-auto pr-1">
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
                        {recentSettlements.map((s) => (
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
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Position summary</CardTitle>
                <CardDescription>LP profile snapshot</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border bg-card/50 p-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      <Briefcase className="h-3.5 w-3.5" /> Open positions
                    </div>
                    <div className="mt-1 text-lg font-bold tabular-nums">
                      {openPositions}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {fmtCurrency(openVolume, 'USD')} in flight
                    </div>
                  </div>
                  <div className="rounded-lg border bg-card/50 p-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      <TrendingUp className="h-3.5 w-3.5" /> Settled
                    </div>
                    <div className="mt-1 text-lg font-bold tabular-nums">
                      {settledCount}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {fmtCurrency(settledVolume, 'USD')} volume
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Wallet className="h-3.5 w-3.5" /> Available capacity
                    </span>
                    <span className="tabular-nums font-semibold">
                      {fmtCurrency(availableCapacity, 'USD')}
                    </span>
                  </div>
                  <Progress value={utilization} className="h-2" />
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Collateral posted</span>
                    <span className="tabular-nums">{utilization}% utilised</span>
                  </div>
                </div>

                <div className="space-y-2 border-t pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Earned fees</span>
                    <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {fmtCurrency(earnedFees, 'USD')}
                    </span>
                  </div>
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
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Joined</span>
                    <span className="font-medium">{fmtDate(lp.createdAt)}</span>
                  </div>
                </div>

                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href="/lp/profitability">
                    <TrendingUp className="h-4 w-4" />
                    View profitability
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
