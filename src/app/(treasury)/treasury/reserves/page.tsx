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
import { StatusBadge } from '@/components/status-badge';
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtCurrency,
  fmtNumber,
  fmtDateShort,
} from '@/components/role-ui';
import { AdjustReserveForm } from '@/components/treasury/adjust-reserve-form';
import { Vault, Coins, ShieldCheck, Gauge, History } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function TreasuryReservesPage() {
  const session = await getServerSession(authOptions);

  // --- Multi-currency wallet aggregates -----------------------------------
  const walletAgg = await db.wallet.groupBy({
    by: ['currency'],
    _sum: { balance: true, pendingBalance: true, lockedBalance: true },
    orderBy: { currency: 'asc' },
  });

  const bondAgg = await db.merchant.aggregate({ _sum: { bond: true } });
  const totalBonds = Number(bondAgg._sum.bond ?? 0);

  const lpAgg = await db.lPProfile.aggregate({
    _sum: { stake: true, collateral: true },
  });

  const totalReserves = walletAgg.reduce((s, w) => s + Number(w._sum.balance ?? 0), 0);
  const totalPending = walletAgg.reduce(
    (s, w) => s + Number(w._sum.pendingBalance ?? 0),
    0,
  );
  const totalLocked = walletAgg.reduce(
    (s, w) => s + Number(w._sum.lockedBalance ?? 0),
    0,
  );

  const balancesByCurrency: Record<string, number> = {};
  for (const w of walletAgg) {
    balancesByCurrency[w.currency] = Number(w._sum.balance ?? 0);
  }
  const currencyOptions = walletAgg.map((w) => w.currency);

  // --- Reserve history (WalletTransactions of type CREDIT/DEBIT on
  // reserve wallets) ------------------------------------------------------
  // The system reserve wallet lives on a Merchant named 'PaySwap Reserve'.
  // We grab recent CREDIT/DEBIT transactions on any wallet owned by that
  // merchant's account (across all currencies).
  const reserveMerchant = await db.merchant.findFirst({
    where: { name: 'PaySwap Reserve' },
    include: { account: true },
  });

  let reserveHistory: Array<{
    id: string;
    type: string;
    amount: number;
    currency: string;
    reference: string | null;
    counterparty: string | null;
    createdAt: Date;
  }> = [];

  if (reserveMerchant) {
    const reserveWallets = await db.wallet.findMany({
      where: { accountId: reserveMerchant.accountId },
      select: { id: true },
    });
    const walletIds = reserveWallets.map((w) => w.id);
    if (walletIds.length > 0) {
      const txs = await db.walletTransaction.findMany({
        where: {
          walletId: { in: walletIds },
          type: { in: ['CREDIT', 'DEBIT'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      });
      reserveHistory = txs.map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        currency: t.currency,
        reference: t.reference,
        counterparty: t.counterparty,
        createdAt: t.createdAt,
      }));
    }
  }

  // Fallback: also surface recent TREASURY.RESERVE_ADJUST audit-log entries
  // even before the reserve merchant exists, so operators see activity.
  const reserveAuditLogs = reserveMerchant
    ? []
    : await db.auditLog.findMany({
        where: { action: 'TREASURY.RESERVE_ADJUST' },
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: { user: true },
      });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reserves"
        description="Currency reserves, backing collateral, utilization and adjustment history."
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

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Per-currency breakdown with visual bars */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Reserves by currency</CardTitle>
            <CardDescription>
              Total balance, locked collateral and available reserves per
              currency. Bar shows locked utilisation.
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
              <div className="space-y-3">
                {walletAgg.map((w) => {
                  const available = Number(w._sum.balance ?? 0);
                  const locked = Number(w._sum.lockedBalance ?? 0);
                  const pending = Number(w._sum.pendingBalance ?? 0);
                  const pct =
                    available > 0
                      ? Math.min(100, (locked / available) * 100)
                      : 0;
                  return (
                    <div
                      key={w.currency}
                      className="rounded-lg border bg-card/40 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            {w.currency}
                          </span>
                          <span className="text-sm font-semibold tabular-nums">
                            {fmtCurrency(available, w.currency)}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          <span className="text-emerald-600 dark:text-emerald-400">
                            Avail {fmtCurrency(available - locked, w.currency)}
                          </span>
                          {' · '}
                          <span className="text-amber-600 dark:text-amber-400">
                            Locked {fmtCurrency(locked, w.currency)}
                          </span>
                          {' · '}
                          <span>Pending {fmtCurrency(pending, w.currency)}</span>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Progress
                          value={pct}
                          className="h-1.5"
                        />
                        <span className="w-12 text-right text-[10px] tabular-nums text-muted-foreground">
                          {fmtNumber(pct, 0)}% lock
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Adjust Reserve form */}
        <AdjustReserveForm
          currencies={currencyOptions}
          balancesByCurrency={balancesByCurrency}
        />
      </div>

      {/* Reserve History */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4 text-emerald-500" />
                Reserve history
              </CardTitle>
              <CardDescription>
                Recent reserve adjustments on the PaySwap Reserve wallet
                (CREDIT = added, DEBIT = removed)
              </CardDescription>
            </div>
            <StatusBadge
              status={reserveMerchant ? 'ACTIVE' : 'PENDING'}
            />
          </div>
        </CardHeader>
        <CardContent>
          {reserveHistory.length === 0 && reserveAuditLogs.length === 0 ? (
            <EmptyState
              icon={<History className="h-6 w-6" />}
              title="No reserve adjustments yet"
              description="Use the Adjust Reserve form above to credit or debit the system reserve wallet. Every adjustment will appear here."
            />
          ) : (
            <div className="max-h-96 overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Counterparty</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reserveHistory.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <StatusBadge
                          status={t.type === 'CREDIT' ? 'COMPLETED' : 'FROZEN'}
                        />
                        <span className="ml-1 font-mono text-[10px] uppercase text-muted-foreground">
                          {t.type}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                          {t.currency}
                        </span>
                      </TableCell>
                      <TableCell
                        className={`text-right font-semibold tabular-nums ${
                          t.type === 'CREDIT'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {t.type === 'CREDIT' ? '+' : '−'}
                        {fmtCurrency(t.amount, t.currency)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {t.reference ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.counterparty ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDateShort(t.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {reserveHistory.length === 0 &&
                    reserveAuditLogs.map((l) => {
                      let detail: any = {};
                      try {
                        detail = JSON.parse(l.details ?? '{}');
                      } catch {
                        detail = {};
                      }
                      const txType =
                        detail.action === 'add' ? 'CREDIT' : 'DEBIT';
                      return (
                        <TableRow key={l.id}>
                          <TableCell>
                            <StatusBadge
                              status={txType === 'CREDIT' ? 'COMPLETED' : 'FROZEN'}
                            />
                            <span className="ml-1 font-mono text-[10px] uppercase text-muted-foreground">
                              {txType}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                              {detail.currency ?? '—'}
                            </span>
                          </TableCell>
                          <TableCell
                            className={`text-right font-semibold tabular-nums ${
                              txType === 'CREDIT'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {txType === 'CREDIT' ? '+' : '−'}
                            {fmtCurrency(detail.amount ?? 0, detail.currency ?? 'USD')}
                          </TableCell>
                          <TableCell
                            className="max-w-[16rem] truncate font-mono text-xs text-muted-foreground"
                            title={detail.reason ?? ''}
                          >
                            {detail.reason ?? '—'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {l.user?.email ?? 'system'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {fmtDateShort(l.createdAt)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* LP backing pool summary */}
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
              {fmtCurrency(Number(lpAgg._sum.stake ?? 0), 'USD')}
            </div>
          </div>
          <div className="rounded-lg border bg-card/50 p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Total LP collateral
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-teal-600 dark:text-teal-400">
              {fmtCurrency(Number(lpAgg._sum.collateral ?? 0), 'USD')}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
