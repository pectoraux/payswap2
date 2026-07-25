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
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtCurrency,
  fmtNumber,
} from '@/components/role-ui';
import { Vault, Coins, ShieldCheck, Gauge } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function TreasuryReservesPage() {
  const session = await getServerSession(authOptions);

  const walletAgg = await db.wallet.groupBy({
    by: ['currency'],
    _sum: { balance: true, pendingBalance: true, lockedBalance: true },
  });

  const bondAgg = await db.merchant.aggregate({ _sum: { bond: true } });
  const totalBonds = bondAgg._sum.bond ?? 0;

  const lpAgg = await db.lPProfile.aggregate({
    _sum: { stake: true, collateral: true },
  });

  const totalReserves = walletAgg.reduce((s, w) => s + (w._sum.balance ?? 0), 0);
  const totalPending = walletAgg.reduce((s, w) => s + (w._sum.pendingBalance ?? 0), 0);
  const totalLocked = walletAgg.reduce((s, w) => s + (w._sum.lockedBalance ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reserves"
        description="Currency reserves, backing collateral and utilization."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total reserves"
          value={fmtCurrency(totalReserves, 'USD')}
          icon={<Vault className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Pending"
          value={fmtCurrency(totalPending, 'USD')}
          hint="Incoming"
          icon={<Coins className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Locked"
          value={fmtCurrency(totalLocked, 'USD')}
          hint="In escrow"
          icon={<ShieldCheck className="h-4 w-4" />}
          tone="amber"
        />
        <KpiCard
          label="Merchant bonds"
          value={fmtCurrency(totalBonds, 'USD')}
          hint="Posted collateral"
          icon={<Gauge className="h-4 w-4" />}
          tone="cyan"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reserves by currency</CardTitle>
          <CardDescription>
            Aggregated wallet balances with pending and locked breakdown
          </CardDescription>
        </CardHeader>
        <CardContent>
          {walletAgg.length === 0 ? (
            <EmptyState
              icon={<Vault className="h-6 w-6" />}
              title="No reserves recorded"
              description="Wallet balances will appear here once merchants and customers fund accounts."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Currency</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Locked</TableHead>
                  <TableHead>Locked utilisation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {walletAgg.map((w) => {
                  const available = w._sum.balance ?? 0;
                  const locked = w._sum.lockedBalance ?? 0;
                  const pct = available > 0 ? Math.min(100, (locked / available) * 100) : 0;
                  return (
                    <TableRow key={w.currency}>
                      <TableCell>
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                          {w.currency}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmtCurrency(available, w.currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {fmtCurrency(w._sum.pendingBalance ?? 0, w.currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {fmtCurrency(locked, w.currency)}
                      </TableCell>
                      <TableCell className="w-48">
                        <div className="flex items-center gap-2">
                          <Progress value={pct} className="h-2" />
                          <span className="w-10 text-right text-[10px] tabular-nums text-muted-foreground">
                            {fmtNumber(pct, 0)}%
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">LP backing pool</CardTitle>
          <CardDescription>Aggregate LP stake and collateral</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border bg-card/50 p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Total LP stake
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {fmtCurrency(lpAgg._sum.stake ?? 0, 'USD')}
            </div>
          </div>
          <div className="rounded-lg border bg-card/50 p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Total LP collateral
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-teal-600 dark:text-teal-400">
              {fmtCurrency(lpAgg._sum.collateral ?? 0, 'USD')}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
