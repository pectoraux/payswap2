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
import { Briefcase, Coins, ShieldCheck, Star } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function LpPositionsPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  const account = userId
    ? await db.account.findFirst({
        where: { userId, type: 'LP' },
        include: { lpProfile: true },
      })
    : null;

  const lp = account?.lpProfile ?? null;

  // Open positions: payments where this LP is the designated LP and status is in-flight
  const openPositions = lp
    ? await db.payment.findMany({
        where: {
          lpId: lp.id,
          status: { in: ['PENDING', 'PROCESSING', 'AUTHORIZED'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    : [];

  const openVolume = openPositions.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Positions"
        description="Open liquidity positions and posted collateral."
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
              label="Total stake"
              value={fmtCurrency(lp.stake, 'USD')}
              icon={<Coins className="h-4 w-4" />}
              tone="emerald"
            />
            <KpiCard
              label="Collateral posted"
              value={fmtCurrency(lp.collateral, 'USD')}
              icon={<ShieldCheck className="h-4 w-4" />}
              tone="teal"
            />
            <KpiCard
              label="Open positions"
              value={openPositions.length.toString()}
              hint={`${fmtCurrency(openVolume, 'USD')} in flight`}
              icon={<Briefcase className="h-4 w-4" />}
              tone="amber"
            />
            <KpiCard
              label="Reputation"
              value={fmtNumber(lp.reputation, 2)}
              hint="Out of 1.00"
              icon={<Star className="h-4 w-4" />}
              tone="cyan"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Open positions</CardTitle>
              <CardDescription>
                Payments currently awaiting settlement via your liquidity
              </CardDescription>
            </CardHeader>
            <CardContent>
              {openPositions.length === 0 ? (
                <EmptyState
                  icon={<Briefcase className="h-6 w-6" />}
                  title="No open positions"
                  description="When payments are routed through your liquidity, open positions will appear here."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Corridor</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Opened</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openPositions.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">
                          {p.reference || p.id.slice(0, 12)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.corridor || '—'}
                        </TableCell>
                        <TableCell className="font-semibold tabular-nums">
                          {fmtCurrency(p.amount, p.currency)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.method || '—'}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={p.status} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(p.createdAt)}
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
