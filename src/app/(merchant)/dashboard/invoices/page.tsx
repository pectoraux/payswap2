import { redirect } from 'next/navigation';
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
import { Button } from '@/components/ui/button';
import { FileText, Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userId = (session?.user as any)?.id;
  const userRole = await db.userRole.findFirst({
    where: { userId, role: { in: ['MERCHANT', 'MERCHANT_STAFF'] } },
  });
  const merchantId = userRole?.merchantId;
  if (!merchantId) redirect('/unauthorized');

  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  const invoices = await db.invoice.findMany({
    where: { merchantId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const fmt = (n: number, c: string = merchant?.currency || 'GHS') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);
  const fmtDate = (d: Date | null) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

  const totalOutstanding = invoices
    .filter((i) => i.status === 'SENT' || i.status === 'OVERDUE')
    .reduce((s, i) => s + i.total, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground">
            Bill customers and track payment status.
          </p>
        </div>
        <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
          <Plus className="mr-2 h-4 w-4" /> New invoice
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Outstanding
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {fmt(totalOutstanding)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total invoices
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {invoices.length}
            </div>
          </CardContent>
        </Card>
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
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <FileText className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No invoices yet</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Create an invoice to bill a customer for goods or services.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-xs font-semibold">
                      {inv.number}
                    </TableCell>
                    <TableCell className="font-semibold tabular-nums">
                      {fmt(inv.total, inv.currency)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={inv.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(inv.dueDate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
