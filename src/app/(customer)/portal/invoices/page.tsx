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

export const dynamic = 'force-dynamic';

export default async function CustomerInvoicesPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  const account = userId
    ? await db.account.findFirst({
        where: { userId, type: 'CUSTOMER' },
        include: { customer: true },
      })
    : null;

  const customer = account?.customer ?? null;
  const invoices = customer
    ? await db.invoice.findMany({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    : [];

  const outstanding = invoices
    .filter((i) => i.status === 'SENT' || i.status === 'OVERDUE')
    .reduce((s, i) => s + i.total, 0);
  const paid = invoices.filter((i) => i.status === 'PAID');
  const overdue = invoices.filter((i) => i.status === 'OVERDUE');
  const currency = invoices[0]?.currency || 'GHS';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Outstanding and paid invoices billed to you."
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
                      <TableHead>Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due date</TableHead>
                      <TableHead>Issued</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono text-xs font-semibold">
                          {inv.number}
                        </TableCell>
                        <TableCell className="font-semibold tabular-nums">
                          {fmtCurrency(inv.total, inv.currency)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={inv.status} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDateShort(inv.dueDate)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDateShort(inv.createdAt)}
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
