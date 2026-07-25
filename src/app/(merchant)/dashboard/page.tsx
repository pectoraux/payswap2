import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TrendingUp, CreditCard, Users, ArrowDownToLine, Package } from 'lucide-react';

export default async function MerchantDashboard() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  const userRole = await db.userRole.findFirst({ where: { userId, role: { in: ['MERCHANT', 'MERCHANT_STAFF'] } } });
  const merchantId = userRole?.merchantId;
  if (!merchantId) return <div>No merchant account found.</div>;

  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) return <div>Merchant not found.</div>;

  const [payments, payouts, customers, products] = await Promise.all([
    db.payment.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    db.payout.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' }, take: 5 }),
    db.customerRecord.count({ where: { merchantId } }),
    db.product.count({ where: { merchantId, deletedAt: null } }),
  ]);

  const revenue = payments.filter(p => p.status === 'COMPLETED').reduce((s, p) => s + p.amount, 0);
  const fmt = (n: number, c: string = merchant.currency) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n);
  const fmtDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome back, {merchant.name}</h1>
        <p className="text-sm text-muted-foreground">Here's what's happening with your business today.</p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Revenue</span><TrendingUp className="h-4 w-4 text-emerald-500" /></div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{fmt(revenue)}</div>
          <div className="text-[10px] text-emerald-600 mt-1">{payments.length} payments</div>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Transactions</span><CreditCard className="h-4 w-4 text-teal-500" /></div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{payments.length}</div>
          <div className="text-[10px] text-muted-foreground mt-1">All-time</div>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Customers</span><Users className="h-4 w-4 text-emerald-500" /></div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{customers}</div>
          <div className="text-[10px] text-muted-foreground mt-1">Total records</div>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payouts</span><ArrowDownToLine className="h-4 w-4 text-teal-500" /></div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{payouts.length}</div>
          <div className="text-[10px] text-muted-foreground mt-1">{products} products</div>
        </CardContent></Card>
      </div>

      {/* Recent payments */}
      <Card>
        <CardHeader><CardTitle className="text-base">Recent Payments</CardTitle><CardDescription>Your latest transactions</CardDescription></CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No payments yet.</div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Amount</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.reference || p.id.slice(0, 12)}</TableCell>
                    <TableCell className="font-semibold">{fmt(p.amount)}</TableCell>
                    <TableCell className="text-xs">{p.method || '—'}</TableCell>
                    <TableCell><Badge variant={p.status === 'COMPLETED' ? 'default' : 'secondary'} className="text-[10px]">{p.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(p.createdAt)}</TableCell>
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
