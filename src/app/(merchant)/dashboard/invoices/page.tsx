import { FileText } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { formatCurrency, formatDate, statusBadgeClass } from '@/lib/format';
import { CreateInvoiceDialog } from '@/components/merchant/create-invoice-dialog';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage() {
  const { merchant } = await requireMerchant();

  const invoices = await db.invoice.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Bill customers with itemised invoices, due dates, and automatic reminders."
        actions={<CreateInvoiceDialog />}
      />

      {invoices.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title="No invoices yet"
            description="Create an invoice to bill a customer for one or more line items. Paid invoices reconcile automatically with payments."
            action={{ label: 'New invoice', href: '/dashboard/invoices' }}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Due date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs">{inv.number}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {inv.customerId ?? '—'}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatCurrency(Number(inv.subtotal), inv.currency)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatCurrency(Number(inv.tax), inv.currency)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(Number(inv.total), inv.currency)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass(inv.status)}>
                      {inv.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDate(inv.dueDate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
