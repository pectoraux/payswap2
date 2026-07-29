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
import { Briefcase, Coins, ShieldCheck, Star, Wallet } from 'lucide-react';
import { LpCapitalManager, type LpCapitalSnapshot } from '@/components/lp/lp-capital-manager';

export const dynamic = 'force-dynamic';

interface SettlementRow {
  id: string;
  reference: string | null;
  corridor: string | null;
  amount: number;
  currency: string;
  fee: number;
  status: string;
  settledAt: Date | null;
  createdAt: Date;
  merchantName: string;
}

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

  // Open positions: payments where this LP is the designated LP and status is in-flight.
  const openPositions = lp
    ? await db.payment.findMany({
        where: {
          lpId: lp.id,
          status: { in: ['PENDING', 'PROCESSING', 'AUTHORIZED'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { merchant: { select: { name: true } } },
      })
    : [];

  // Settlement history: completed payments routed through this LP.
  const settlementsRaw = lp
    ? await db.payment.findMany({
        where: { lpId: lp.id, status: 'COMPLETED' },
        orderBy: { settledAt: 'desc' },
        take: 50,
        include: { merchant: { select: { name: true } } },
      })
    : [];

  const settlements: SettlementRow[] = settlementsRaw.map((s) => ({
    id: s.id,
    reference: s.reference,
    corridor: s.corridor,
    amount: Number(s.amount),
    currency: s.currency,
    fee: Number(s.fee),
    status: s.status,
    settledAt: s.settledAt,
    createdAt: s.createdAt,
    merchantName: s.merchant?.name ?? 'Unknown merchant',
  }));

  const openVolume = openPositions.reduce((s, p) => s + Number(p.amount), 0);
  const settledVolume = settlements.reduce((s, p) => s + p.amount, 0);
  const settledFees = settlements.reduce((s, p) => s + p.fee, 0);

  const capitalSnapshot: LpCapitalSnapshot | null = lp
    ? {
        stake: Number(lp.stake),
        collateral: Number(lp.collateral),
        available: Math.max(0, Number(lp.stake) - Number(lp.collateral)),
      }
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Positions"
        description="Manage your posted capital and review settlement activity."
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
              value={fmtCurrency(Number(lp.stake), 'USD')}
              icon={<Coins className="h-4 w-4" />}
              tone="emerald"
            />
            <KpiCard
              label="Collateral posted"
              value={fmtCurrency(Number(lp.collateral), 'USD')}
              icon={<ShieldCheck className="h-4 w-4" />}
              tone="teal"
            />
            <KpiCard
              label="Available"
              value={fmtCurrency(capitalSnapshot!.available, 'USD')}
              hint="Withdrawable now"
              icon={<Wallet className="h-4 w-4" />}
              tone="cyan"
            />
            <KpiCard
              label="Reputation"
              value={fmtNumber(Number(lp.reputation), 2)}
              hint="Out of 1.00"
              icon={<Star className="h-4 w-4" />}
              tone="amber"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Open positions table */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Open positions</CardTitle>
                <CardDescription>
                  {openPositions.length} in-flight · {fmtCurrency(openVolume, 'USD')} volume committed
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
                  <div className="max-h-96 overflow-y-auto pr-1">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Reference</TableHead>
                          <TableHead>Merchant</TableHead>
                          <TableHead>Corridor</TableHead>
                          <TableHead>Amount</TableHead>
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
                            <TableCell className="text-xs">
                              {p.merchant?.name ?? '—'}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {p.corridor || '—'}
                            </TableCell>
                            <TableCell className="font-semibold tabular-nums">
                              {fmtCurrency(Number(p.amount), p.currency)}
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
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Capital manager */}
            <LpCapitalManager lp={capitalSnapshot!} />
          </div>

          {/* Settlement history */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Settlement history</CardTitle>
              <CardDescription>
                {settlements.length} settlement{settlements.length === 1 ? '' : 's'} ·{' '}
                {fmtCurrency(settledVolume, 'USD')} volume ·{' '}
                <span className="text-emerald-600 dark:text-emerald-400">
                  {fmtCurrency(settledFees, 'USD')} earned
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settlements.length === 0 ? (
                <EmptyState
                  icon={<Briefcase className="h-6 w-6" />}
                  title="No settlements yet"
                  description="Completed payments routed through your liquidity will appear here with the merchant and fee earned."
                />
              ) : (
                <div className="max-h-96 overflow-y-auto pr-1">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>Merchant</TableHead>
                        <TableHead>Corridor</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Fee earned</TableHead>
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
                          <TableCell className="text-xs">{s.merchantName}</TableCell>
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
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
