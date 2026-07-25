import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';
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
import { Users } from 'lucide-react';
import { CreateCustomerDialog } from '@/components/merchant/create-customer-dialog';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userId = (session?.user as any)?.id;
  const userRole = await db.userRole.findFirst({
    where: { userId, role: { in: ['MERCHANT', 'MERCHANT_STAFF'] } },
  });
  const merchantId = userRole?.merchantId;
  if (!merchantId) redirect('/unauthorized');

  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  const env = await getEnvironment();
  const customers = await db.customerRecord.findMany({
    where: { merchantId, environment: env },
    orderBy: { totalSpent: 'desc' },
    take: 100,
  });

  const fmt = (n: number, c: string = merchant?.currency || 'GHS') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);

  const totalSpent = customers.reduce((s, c) => s + c.totalSpent, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">
            People who have paid you through PaySwap.
          </p>
        </div>
        <CreateCustomerDialog />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total customers
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {customers.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Lifetime value
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {fmt(totalSpent)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All customers</CardTitle>
          <CardDescription>
            {customers.length} customer{customers.length === 1 ? '' : 's'} on record
          </CardDescription>
        </CardHeader>
        <CardContent>
          {customers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Users className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No customers yet</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Customer records are created automatically when someone pays you.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Total spent</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.email}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.phone || '—'}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmt(c.totalSpent)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {c.transactionCount}
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
