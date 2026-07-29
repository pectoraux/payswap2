import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth-guards';
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
import { Badge } from '@/components/ui/badge';
import { Repeat } from 'lucide-react';
import { CreateSubscriptionDialog } from '@/components/merchant/create-subscription-dialog';

export const dynamic = 'force-dynamic';

export default async function SubscriptionsPage() {
  const ctx = await requireMerchant().catch(() => null);
  if (!ctx) redirect('/unauthorized');
  const { merchant } = ctx;
  const merchantId = merchant.id;

  const subscriptions = await db.subscription.findMany({
    where: { merchantId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const fmt = (n: number, c: string = merchant?.currency || 'GHS') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);
  const fmtDate = (d: Date | null) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

  const active = subscriptions.filter((s) => s.status === 'ACTIVE').length;
  const recurringMrr = subscriptions
    .filter((s) => s.status === 'ACTIVE')
    .reduce((s, sub) => {
      // Normalize all intervals to monthly.
      const amt = Number(sub.amount);
      const monthly =
        sub.interval === 'YEARLY'
          ? amt / 12
          : sub.interval === 'WEEKLY'
            ? amt * 4.33
            : sub.interval === 'DAILY'
              ? amt * 30
              : amt;
      return s + monthly;
    }, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">
            Recurring billing plans and active subscriber relationships.
          </p>
        </div>
        <CreateSubscriptionDialog />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Active subscriptions
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {active}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total plans
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {subscriptions.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Est. monthly recurring
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums text-teal-600 dark:text-teal-400">
              {fmt(recurringMrr)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All subscriptions</CardTitle>
          <CardDescription>
            {subscriptions.length} subscription{subscriptions.length === 1 ? '' : 's'} on record
          </CardDescription>
        </CardHeader>
        <CardContent>
          {subscriptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Repeat className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No subscriptions yet</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Create a recurring plan to let customers subscribe to your service.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Interval</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Current period</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.planName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.customerId ? s.customerId.slice(0, 12) : '—'}
                    </TableCell>
                    <TableCell className="font-semibold tabular-nums">
                      {fmt(Number(s.amount), s.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className="bg-teal-500/10 text-teal-600 dark:text-teal-400"
                      >
                        {s.interval}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(s.currentPeriodStart)} – {fmtDate(s.currentPeriodEnd)}
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
