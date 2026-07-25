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
import { Progress } from '@/components/ui/progress';
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtCurrency,
  fmtNumber,
  fmtDateShort,
} from '@/components/role-ui';
import { Route, ArrowRight, TrendingUp, Activity } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function TreasuryCorridorsPage() {
  const session = await getServerSession(authOptions);

  // Group payments by corridor with volume + count
  const corridors = await db.payment.groupBy({
    by: ['corridor'],
    where: { NOT: { corridor: null } },
    _count: { _all: true },
    _sum: { amount: true, fee: true },
    orderBy: { _sum: { amount: 'desc' } },
    take: 50,
  });

  // Failed payments per corridor (proxy for corridor health)
  const failedByCorridor = await db.payment.groupBy({
    by: ['corridor'],
    where: { status: 'FAILED', NOT: { corridor: null } },
    _count: { _all: true },
  });
  const failedMap = new Map(
    failedByCorridor.map((f) => [f.corridor, f._count._all]),
  );

  const totalVolume = corridors.reduce((s, c) => s + (c._sum.amount ?? 0), 0);
  const totalFees = corridors.reduce((s, c) => s + (c._sum.fee ?? 0), 0);
  const totalPayments = corridors.reduce((s, c) => s + c._count._all, 0);
  const avgFeeBps = totalVolume > 0 ? (totalFees / totalVolume) * 10000 : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Corridors"
        description="Settlement routes between currencies and geographies."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Active corridors"
          value={corridors.length.toString()}
          icon={<Route className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Total volume"
          value={fmtCurrency(totalVolume, 'USD')}
          hint="All-time"
          icon={<TrendingUp className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Payments"
          value={totalPayments.toString()}
          hint="Routed"
          icon={<Activity className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Avg fee"
          value={`${fmtNumber(avgFeeBps, 1)} bps`}
          hint="Across corridors"
          icon={<ArrowRight className="h-4 w-4" />}
          tone="amber"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All corridors</CardTitle>
          <CardDescription>
            {corridors.length} corridor{corridors.length === 1 ? '' : 's'} with activity
          </CardDescription>
        </CardHeader>
        <CardContent>
          {corridors.length === 0 ? (
            <EmptyState
              icon={<Route className="h-6 w-6" />}
              title="No corridor activity"
              description="Corridors appear here once payments are routed between currencies."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Corridor</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Failures</TableHead>
                  <TableHead>Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {corridors.map((c) => {
                  const vol = c._sum.amount ?? 0;
                  const share = totalVolume > 0 ? (vol / totalVolume) * 100 : 0;
                  const failures = failedMap.get(c.corridor) ?? 0;
                  return (
                    <TableRow key={c.corridor}>
                      <TableCell className="font-mono text-xs font-semibold">
                        {c.corridor}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c._count._all}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmtCurrency(vol, 'USD')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {fmtCurrency(c._sum.fee ?? 0, 'USD')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={
                            failures > 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-muted-foreground'
                          }
                        >
                          {failures}
                        </span>
                      </TableCell>
                      <TableCell className="w-40">
                        <div className="flex items-center gap-2">
                          <Progress value={share} className="h-2" />
                          <span className="w-10 text-right text-[10px] tabular-nums text-muted-foreground">
                            {fmtNumber(share, 1)}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
