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
import { Wallet, CreditCard, TrendingUp, ArrowUpRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function CustomerOverviewPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  const account = userId
    ? await db.account.findFirst({
        where: { userId, type: 'CUSTOMER' },
        include: { customer: true, wallets: true },
      })
    : null;

  const customer = account?.customer ?? null;
  const wallets = account?.wallets ?? [];
  const defaultWallet = wallets.find((w) => w.isDefault) ?? wallets[0] ?? null;
  const walletBalance = wallets.reduce((s, w) => s + w.balance, 0);

  const payments = customer
    ? await db.payment.findMany({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })
    : [];

  const totalSpent = payments
    .filter((p) => p.status === 'COMPLETED')
    .reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${customer?.name || session?.user?.name || 'Customer'}`}
        description="Your wallet, payments and invoices at a glance."
      />

      {!customer ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Wallet className="h-6 w-6" />}
              title="No customer account linked"
              description="Contact support to link a customer account to your profile."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              label="Wallet balance"
              value={fmtCurrency(walletBalance, defaultWallet?.currency || 'GHS')}
              hint={`${wallets.length} wallet${wallets.length === 1 ? '' : 's'}`}
              icon={<Wallet className="h-4 w-4" />}
              tone="emerald"
            />
            <KpiCard
              label="Total spent"
              value={fmtCurrency(totalSpent, defaultWallet?.currency || 'GHS')}
              hint="Completed payments"
              icon={<TrendingUp className="h-4 w-4" />}
              tone="teal"
            />
            <KpiCard
              label="Payment count"
              value={payments.length.toString()}
              hint="All-time"
              icon={<CreditCard className="h-4 w-4" />}
              tone="cyan"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Recent payments</CardTitle>
                <CardDescription>Your latest transactions</CardDescription>
              </CardHeader>
              <CardContent>
                {payments.length === 0 ? (
                  <EmptyState
                    icon={<CreditCard className="h-6 w-6" />}
                    title="No payments yet"
                    description="When you pay a merchant on PaySwap, the transaction will appear here."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs">
                            {p.reference || p.id.slice(0, 12)}
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

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Wallet</CardTitle>
                <CardDescription>Default balance</CardDescription>
              </CardHeader>
              <CardContent>
                {defaultWallet ? (
                  <div className="space-y-4">
                    <div className="rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 p-5 text-white shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wide text-white/80">
                          {defaultWallet.name}
                        </span>
                        <Wallet className="h-4 w-4 text-white/80" />
                      </div>
                      <div className="mt-3 text-3xl font-bold tabular-nums">
                        {fmtCurrency(defaultWallet.balance, defaultWallet.currency)}
                      </div>
                      <div className="mt-1 text-[10px] text-white/70">
                        {defaultWallet.currency} · {defaultWallet.isDefault ? 'Default' : 'Secondary'}
                      </div>
                    </div>
                    <div className="rounded-lg border bg-card/50 p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Pending</span>
                        <span className="font-semibold tabular-nums">
                          {fmtCurrency(defaultWallet.pendingBalance, defaultWallet.currency)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-muted-foreground">Locked</span>
                        <span className="font-semibold tabular-nums">
                          {fmtCurrency(defaultWallet.lockedBalance, defaultWallet.currency)}
                        </span>
                      </div>
                    </div>
                    <a
                      href="/portal/wallet"
                      className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-500/5 dark:text-emerald-400"
                    >
                      View wallet details
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  </div>
                ) : (
                  <EmptyState
                    icon={<Wallet className="h-6 w-6" />}
                    title="No wallet"
                    description="Your wallet will appear here once it has been provisioned."
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
