import Link from 'next/link';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TrendingUp, CreditCard, Users, ArrowDownToLine, ExternalLink } from 'lucide-react';
import { OnboardingChecklist } from '@/components/merchant/onboarding-checklist';
import { HealthScore } from '@/components/merchant/health-score';
import { AiInsights } from '@/components/merchant/ai-insights';

export const dynamic = 'force-dynamic';

export default async function MerchantDashboard() {
  let merchantId: string;
  let merchant: any;
  try {
    const result = await requireMerchant();
    merchantId = result.merchantId;
    merchant = result.merchant;
  } catch (e) {
    return <div className="text-sm text-muted-foreground">No merchant account found.</div>;
  }

  const env = await getEnvironment();

  // Pull the recent payments, payouts, plus the total counts we need for
  // the KPI cards AND the onboarding checklist (which depends on whether
  // the merchant has set up api keys, webhooks, products, customers, etc.).
  const [
    payments,
    payouts,
    customers,
    products,
    paymentCount,
    payoutCount,
    apiKeyCount,
    webhookCount,
  ] = await Promise.all([
    db.payment.findMany({ where: { merchantId, environment: env }, orderBy: { createdAt: 'desc' }, take: 10 }),
    db.payout.findMany({ where: { merchantId, environment: env }, orderBy: { createdAt: 'desc' }, take: 5 }),
    db.customerRecord.count({ where: { merchantId, environment: env } }),
    db.product.count({ where: { merchantId, deletedAt: null, environment: env } }),
    db.payment.count({ where: { merchantId, environment: env } }),
    db.payout.count({ where: { merchantId, environment: env } }),
    db.apiKey.count({ where: { merchantId, environment: env } }),
    db.webhookEndpoint.count({ where: { merchantId, environment: env } }),
  ]);

  const revenue = payments.filter(p => p.status === 'COMPLETED').reduce((s, p) => s + p.amount, 0);
  const fmt = (n: number, c: string = merchant.currency) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n);
  const fmtDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Onboarding checklist — only shown when the merchant is still "new"
  // (< 5 lifetime payments in this environment). Each item's `done` flag
  // is computed from DB state.
  const isNewMerchant = paymentCount < 5;
  const checklistItems = isNewMerchant
    ? [
        {
          id: 'profile',
          label: 'Complete organization profile',
          href: '/dashboard/settings',
          description: 'Add your business name, logo, and contact details.',
          done:
            !!merchant.description ||
            !!merchant.website ||
            !!merchant.phone ||
            !!merchant.businessType,
        },
        {
          id: 'api_key',
          label: 'Create an API key',
          href: '/dashboard/settings/api-keys',
          description: 'Authenticate API requests from your applications.',
          done: apiKeyCount > 0,
        },
        {
          id: 'webhook',
          label: 'Configure a webhook',
          href: '/dashboard/settings/webhooks',
          description: 'Receive real-time event notifications.',
          done: webhookCount > 0,
        },
        {
          id: 'customer',
          label: 'Create your first customer',
          href: '/dashboard/customers',
          description: 'Build up your customer book.',
          done: customers > 0,
        },
        {
          id: 'product',
          label: 'Create your first product',
          href: '/dashboard/products',
          description: 'Add a catalog item your customers can buy.',
          done: products > 0,
        },
        {
          id: 'payment',
          label: 'Test a payment in Sandbox',
          href: '/dashboard/payments',
          description: 'Take a payment end-to-end before going live.',
          done: paymentCount > 0,
        },
        {
          id: 'payout',
          label: 'Complete your first payout',
          href: '/dashboard/payouts',
          description: 'Withdraw funds from your merchant balance.',
          done: payoutCount > 0,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome back, {merchant.name}</h1>
        <p className="text-sm text-muted-foreground">Here's what's happening with your business today.</p>
      </div>

      {isNewMerchant && <OnboardingChecklist items={checklistItems} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Revenue</span><TrendingUp className="h-4 w-4 text-emerald-500" /></div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{fmt(revenue)}</div>
          <div className="text-[10px] text-emerald-600 mt-1">{paymentCount} payments</div>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Transactions</span><CreditCard className="h-4 w-4 text-teal-500" /></div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{paymentCount}</div>
          <div className="text-[10px] text-muted-foreground mt-1">All-time</div>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Customers</span><Users className="h-4 w-4 text-emerald-500" /></div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{customers}</div>
          <div className="text-[10px] text-muted-foreground mt-1">Total records</div>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payouts</span><ArrowDownToLine className="h-4 w-4 text-teal-500" /></div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{payoutCount}</div>
          <div className="text-[10px] text-muted-foreground mt-1">{products} products</div>
        </CardContent></Card>
      </div>

      <HealthScore />

      <AiInsights />

      <Card>
        <CardHeader><CardTitle className="text-base">Recent Payments</CardTitle><CardDescription>Your latest transactions</CardDescription></CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No payments yet.</div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Amount</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead className="text-right">View</TableHead></TableRow></TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer">
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/dashboard/payments/${encodeURIComponent(p.id)}`}
                        className="hover:text-emerald-600 hover:underline dark:hover:text-emerald-400"
                      >
                        {p.reference || p.id.slice(0, 12)}
                      </Link>
                    </TableCell>
                    <TableCell className="font-semibold">{fmt(p.amount)}</TableCell>
                    <TableCell className="text-xs">{p.method || '—'}</TableCell>
                    <TableCell><Badge variant={p.status === 'COMPLETED' ? 'default' : 'secondary'} className="text-[10px]">{p.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(p.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/dashboard/payments/${encodeURIComponent(p.id)}`}
                        className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2.5 text-xs font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                        aria-label={`View payment ${p.reference || p.id.slice(0, 12)}`}
                      >
                        View
                        <ExternalLink className="h-3 w-3" />
                      </Link>
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
