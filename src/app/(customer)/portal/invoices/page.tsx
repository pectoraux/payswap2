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
  fmtDateShort,
} from '@/components/role-ui';
import { FileText, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { PayInvoiceButton } from '@/components/customer/pay-invoice-button';

export const dynamic = 'force-dynamic';

const PAYABLE_STATUSES = new Set(['SENT', 'OVERDUE', 'PENDING']);

export default async function CustomerInvoicesPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  const account = userId
    ? await db.account.findFirst({
        where: { userId, type: 'CUSTOMER' },
        include: { customer: true, wallets: true },
      })
    : null;

  const customer = account?.customer ?? null;
  const invoices = customer
    ? await db.invoice.findMany({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { merchant: true },
      })
    : [];

  const outstanding = invoices
    .filter((i) => i.status === 'SENT' || i.status === 'OVERDUE')
    .reduce((s, i) => s + Number(i.total), 0);
  const paid = invoices.filter((i) => i.status === 'PAID');
  const overdue = invoices.filter((i) => i.status === 'OVERDUE');
  const currency = invoices[0]?.currency || 'GHS';

  // Map invoice currency → wallet balance for that currency (for "Pay with wallet" affordance).
  const walletByCurrency = new Map(
    (account?.wallets ?? []).map((w) => [w.currency, w.balance]),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Outstanding and paid invoices billed to you. Pay any unpaid invoice directly from your wallet."
      />

      {!customer ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<FileText className="h-6 w-6" />}
              title="No customer account linked"
              description="Contact support to link a customer account to your profile."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Outstanding"
              value={fmtCurrency(outstanding, currency)}
              hint="Awaiting payment"
              icon={<Clock className="h-4 w-4" />}
              tone="amber"
            />
            <KpiCard
              label="Overdue"
              value={overdue.length.toString()}
              hint="Past due date"
              icon={<AlertTriangle className="h-4 w-4" />}
              tone="rose"
            />
            <KpiCard
              label="Paid"
              value={paid.length.toString()}
              hint="Settled invoices"
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone="emerald"
            />
            <KpiCard
              label="Total invoices"
              value={invoices.length.toString()}
              hint="All-time"
              icon={<FileText className="h-4 w-4" />}
              tone="teal"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">All invoices</CardTitle>
              <CardDescription>
                {invoices.length} invoice{invoices.length === 1 ? '' : 's'} on record
              </CardDescription>
            </CardHeader>
            <CardContent>
              {invoices.length === 0 ? (
                <EmptyState
                  icon={<FileText className="h-6 w-6" />}
                  title="No invoices yet"
                  description="Invoices billed to you by merchants will appear here."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Number</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due date</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv) => {
                      const payable = PAYABLE_STATUSES.has(inv.status);
                      const walletBalance = Number(walletByCurrency.get(inv.currency) ?? 0);
                      const canAfford = walletBalance >= Number(inv.total);
                      return (
                        <TableRow key={inv.id}>
                          <TableCell className="font-mono text-xs font-semibold">
                            {inv.number}
                          </TableCell>
                          <TableCell className="text-xs">
                            {inv.merchant?.name ?? '—'}
                          </TableCell>
                          <TableCell className="font-semibold tabular-nums">
                            {fmtCurrency(Number(inv.total), inv.currency)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={inv.status} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {fmtDateShort(inv.dueDate)}
                          </TableCell>
                          <TableCell className="text-right">
                            {payable ? (
                              <div className="flex flex-col items-end gap-1">
                                <PayInvoiceButton
                                  invoice={{
                                    id: inv.id,
                                    number: inv.number,
                                    total: Number(inv.total),
                                    currency: inv.currency,
                                  }}
                                />
                                {!canAfford && (
                                  <span className="text-[10px] text-amber-600 dark:text-amber-400">
                                    Wallet short: {fmtCurrency(Number(inv.total) - walletBalance, inv.currency)}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
