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
  KpiCard,
  EmptyState,
  PageHeader,
  fmtCurrency,
} from '@/components/role-ui';
import { Wallet, ArrowDownLeft, Lock } from 'lucide-react';
import {
  CustomerWalletActions,
  type WalletView,
  type WalletTransactionView,
} from '@/components/customer/customer-wallet-actions';

export const dynamic = 'force-dynamic';

export default async function CustomerWalletPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  const account = userId
    ? await db.account.findFirst({
        where: { userId, type: 'CUSTOMER' },
        include: {
          customer: true,
          wallets: { include: { transactions: { orderBy: { createdAt: 'desc' }, take: 50 } } },
        },
      })
    : null;

  const customer = account?.customer ?? null;
  const wallets: WalletView[] = (account?.wallets ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    currency: w.currency,
    balance: w.balance,
    pendingBalance: w.pendingBalance,
    lockedBalance: w.lockedBalance,
    isDefault: w.isDefault,
  }));

  const totalBalance = wallets.reduce((s, w) => s + w.balance, 0);
  const totalLocked = wallets.reduce((s, w) => s + w.lockedBalance, 0);
  const totalPending = wallets.reduce((s, w) => s + w.pendingBalance, 0);
  const currency = wallets[0]?.currency || 'GHS';

  const transactions: WalletTransactionView[] = (account?.wallets ?? [])
    .flatMap((w) =>
      w.transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        currency: t.currency,
        counterparty: t.counterparty,
        reference: t.reference,
        createdAt: t.createdAt.toISOString(),
      })),
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wallet"
        description="Deposit, withdraw, transfer, scan to pay and receive."
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
      ) : wallets.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Wallet className="h-6 w-6" />}
              title="No wallets yet"
              description="Use the Deposit button below to fund your first wallet."
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your wallets</CardTitle>
              <CardDescription>Currency balances on your account</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {wallets.map((w) => (
                  <div
                    key={w.id}
                    className="rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 p-5 text-white shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wide text-white/80">
                        {w.name}
                      </span>
                      <Wallet className="h-4 w-4 text-white/80" />
                    </div>
                    <div className="mt-3 text-2xl font-bold tabular-nums">
                      {fmtCurrency(w.balance, w.currency)}
                    </div>
                    <div className="mt-1 text-[10px] text-white/70">
                      {w.currency}{w.isDefault ? ' · Default' : ''}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <CustomerWalletActions
            customerId={customer.id}
            wallets={wallets}
            transactions={transactions}
          />
        </>
      )}
    </div>
  );
}
