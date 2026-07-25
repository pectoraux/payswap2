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
import { CreditCard, CheckCircle2, Clock } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function CustomerPaymentsPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  const account = userId
    ? await db.account.findFirst({
        where: { userId, type: 'CUSTOMER' },
        include: { customer: true },
      })
    : null;

  const customer = account?.customer ?? null;
  const payments = customer
    ? await db.payment.findMany({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    : [];

  const completed = payments.filter((p) => p.status === 'COMPLETED');
  const totalSpent = completed.reduce((s, p) => s + p.amount, 0);
  const currency = payments[0]?.currency || 'GHS';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Every payment you've made through PaySwap."
      />

      {!customer ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<CreditCard className="h-6 w-6" />}
              title="No customer account linked"
              description="Contact support to link a customer account to your profile."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard
              label="Total spent"
              value={fmtCurrency(totalSpent, currency)}
              hint="Completed payments"
              icon={<CreditCard className="h-4 w-4" />}
              tone="emerald"
            />
            <KpiCard
              label="Completed"
              value={completed.length.toString()}
              hint={`of ${payments.length} total`}
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone="teal"
            />
            <KpiCard
              label="Pending"
              value={payments
                .filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING')
                .length.toString()}
              hint="In-flight"
              icon={<Clock className="h-4 w-4" />}
              tone="amber"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment history</CardTitle>
              <CardDescription>
                {payments.length} payment{payments.length === 1 ? '' : 's'} recorded
              </CardDescription>
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
                      <TableHead>Description</TableHead>
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
                        <TableCell className="text-xs text-muted-foreground">
                          {p.description || '—'}
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
