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
import { Wallet, ArrowDownLeft, ArrowUpRight, Lock } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function CustomerWalletPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  const account = userId
    ? await db.account.findFirst({
        where: { userId, type: 'CUSTOMER' },
        include: {
          customer: true,
          wallets: { include: { transactions: { orderBy: { createdAt: 'desc' }, take: 25 } } },
        },
      })
    : null;

  const wallets = account?.wallets ?? [];
  const totalBalance = wallets.reduce((s, w) => s + w.balance, 0);
  const totalLocked = wallets.reduce((s, w) => s + w.lockedBalance, 0);
  const totalPending = wallets.reduce((s, w) => s + w.pendingBalance, 0);
  const currency = wallets[0]?.currency || 'GHS';

  const transactions = wallets.flatMap((w) =>
    w.transactions.map((t) => ({ ...t, walletName: w.name, walletCurrency: w.currency })),
  );
  transactions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wallet"
        description="Balances across your currency wallets."
      />

      {wallets.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Wallet className="h-6 w-6" />}
              title="No wallets yet"
              description="Your wallet will appear here once it has been provisioned by your merchant."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              label="Total balance"
              value={fmtCurrency(totalBalance, currency)}
              hint={`${wallets.length} wallet${wallets.length === 1 ? '' : 's'}`}
              icon={<Wallet className="h-4 w-4" />}
              tone="emerald"
            />
            <KpiCard
              label="Pending"
              value={fmtCurrency(totalPending, currency)}
              hint="Incoming"
              icon={<ArrowDownLeft className="h-4 w-4" />}
              tone="teal"
            />
            <KpiCard
              label="Locked"
              value={fmtCurrency(totalLocked, currency)}
              hint="Held in escrow"
              icon={<Lock className="h-4 w-4" />}
              tone="amber"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-base">Wallets</CardTitle>
                <CardDescription>Your currency balances</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {wallets.map((w) => (
                  <div
                    key={w.id}
                    className="rounded-lg border bg-card/50 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold">{w.name}</div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {w.currency}
                          {w.isDefault && ' · Default'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                          {fmtCurrency(w.balance, w.currency)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {fmtCurrency(w.pendingBalance, w.currency)} pending
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Transactions</CardTitle>
                <CardDescription>Recent wallet activity</CardDescription>
              </CardHeader>
              <CardContent>
                {transactions.length === 0 ? (
                  <EmptyState
                    icon={<ArrowUpRight className="h-6 w-6" />}
                    title="No transactions"
                    description="Wallet movements (deposits, payments, refunds) will show here."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Wallet</TableHead>
                        <TableHead>Counterparty</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions.slice(0, 25).map((t) => {
                        const incoming = t.amount >= 0;
                        return (
                          <TableRow key={t.id}>
                            <TableCell>
                              <StatusBadge status={t.type} />
                            </TableCell>
                            <TableCell className="text-xs">{t.walletName}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {t.counterparty || '—'}
                            </TableCell>
                            <TableCell
                              className={`text-right font-semibold tabular-nums ${
                                incoming
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {incoming ? '+' : '-'}
                              {fmtCurrency(Math.abs(t.amount), t.currency)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {fmtDate(t.createdAt)}
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
        </>
      )}
    </div>
  );
}
