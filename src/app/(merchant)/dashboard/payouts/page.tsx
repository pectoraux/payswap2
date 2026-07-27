import Link from 'next/link';
import { Plus, ArrowDownToLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

export const dynamic = 'force-dynamic';

export default async function PayoutsPage() {
  const { merchant } = await requireMerchant();

  const payouts = await db.payout.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payouts"
        description="Money sent to bank accounts, mobile wallets, and on-chain addresses."
        actions={
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
            <Plus className="h-4 w-4" /> New Payout
          </Button>
        }
      />

      {payouts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ArrowDownToLine className="h-5 w-5" />}
            title="No payouts yet"
            description="When you send money to a bank, mobile money wallet, or on-chain address, the payout will appear here with full evidence."
            action={{ label: 'New payout', href: '/dashboard/payouts' }}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Method</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Fee</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.method.replace(/_/g, ' ')}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatCurrency(p.sourceAmount, p.sourceCurrency)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.destinationCurrency}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(p.sourceAmount, p.sourceCurrency)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatCurrency(p.fee, p.sourceCurrency)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(p.netAmount, p.destinationCurrency)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass(p.status)}>
                      {p.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDate(p.createdAt, true)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {payouts.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {payouts.length} payouts</span>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
