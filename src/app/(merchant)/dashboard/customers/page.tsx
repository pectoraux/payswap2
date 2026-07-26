import { Plus, Users as UsersIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const { merchant } = await requireMerchant();

  const customers = await db.customerRecord.findMany({
    where: { merchantId: merchant.id, deletedAt: null },
    orderBy: { totalSpent: 'desc' },
    take: 500,
  });

  const currency = merchant.currency || 'USD';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="People and businesses that have paid you."
        actions={
          <Button variant="outline">
            <Plus className="h-4 w-4" /> Add Customer
          </Button>
        }
      />

      {customers.length === 0 ? (
        <Card>
          <EmptyState
            icon={<UsersIcon className="h-5 w-5" />}
            title="No customers yet"
            description="Customer records are created automatically when someone pays you. They'll appear here with running totals and transaction counts."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Country</TableHead>
                <TableHead className="text-right">Transactions</TableHead>
                <TableHead className="text-right">Total spent</TableHead>
                <TableHead className="text-right">Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.email}</TableCell>
                  <TableCell className="text-muted-foreground">{c.phone ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{c.country ?? '—'}</TableCell>
                  <TableCell className="text-right">{formatNumber(c.transactionCount)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(c.totalSpent, currency)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDate(c.createdAt)}
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
