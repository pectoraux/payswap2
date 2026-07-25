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
  fmtDate,
} from '@/components/role-ui';
import { ArrowLeftRight, CheckCircle2, Clock, Coins } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function LpSettlementsPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  const account = userId
    ? await db.account.findFirst({
        where: { userId, type: 'LP' },
        include: { lpProfile: true },
      })
    : null;

  const lp = account?.lpProfile ?? null;

  const settlements = lp
    ? await db.payment.findMany({
        where: { lpId: lp.id, status: 'COMPLETED' },
        orderBy: { settledAt: 'desc' },
        take: 100,
      })
    : [];

  const totalSettled = settlements.reduce((s, p) => s + p.amount, 0);
  const totalFees = settlements.reduce((s, p) => s + p.fee, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settlements"
        description="Completed settlements routed through your liquidity."
      />

      {!lp ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<ArrowLeftRight className="h-6 w-6" />}
              title="No LP profile linked"
              description="Contact the treasury team to onboard your liquidity provider account."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Settled volume"
              value={fmtCurrency(totalSettled, 'USD')}
              hint="All-time"
              icon={<Coins className="h-4 w-4" />}
              tone="emerald"
            />
            <KpiCard
              label="Fees earned"
              value={fmtCurrency(totalFees, 'USD')}
              hint="Settlement fees"
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone="teal"
            />
            <KpiCard
              label="Settlements"
              value={settlements.length.toString()}
              hint="Completed"
              icon={<ArrowLeftRight className="h-4 w-4" />}
              tone="cyan"
            />
            <KpiCard
              label="Last settlement"
              value={settlements[0] ? fmtDate(settlements[0].settledAt) : '—'}
              hint="Most recent"
              icon={<Clock className="h-4 w-4" />}
              tone="amber"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Settlement history</CardTitle>
              <CardDescription>
                {settlements.length} settlement{settlements.length === 1 ? '' : 's'} recorded
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settlements.length === 0 ? (
                <EmptyState
                  icon={<ArrowLeftRight className="h-6 w-6" />}
                  title="No settlements yet"
                  description="Completed payments routed through your liquidity will appear here."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Corridor</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Fee</TableHead>
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
                        <TableCell className="text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                          {fmtCurrency(s.fee, s.currency)}
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
        </>
      )}
    </div>
  );
}
