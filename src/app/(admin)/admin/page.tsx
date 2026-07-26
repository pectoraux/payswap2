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
  Building2,
  Users,
  CreditCard,
  Clock,
  TrendingUp,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const session = await getServerSession(authOptions);

  const [merchants, users, payments, pendingWaitlist, volumeAgg, recentWaitlist] =
    await Promise.all([
      db.merchant.count(),
      db.user.count(),
      db.payment.count(),
      db.waitlistEntry.count({ where: { status: 'PENDING' } }),
      db.payment.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      db.waitlistEntry.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ]);

  const volume = volumeAgg._sum.amount || 0;
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'GHS',
      maximumFractionDigits: 0,
    }).format(n);
  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const kpis = [
    {
      label: 'Merchants',
      value: merchants.toLocaleString(),
      icon: <Building2 className="h-4 w-4 text-emerald-500" />,
      hint: 'Onboarded accounts',
    },
    {
      label: 'Users',
      value: users.toLocaleString(),
      icon: <Users className="h-4 w-4 text-teal-500" />,
      hint: 'Registered accounts',
    },
    {
      label: 'Payments',
      value: payments.toLocaleString(),
      icon: <CreditCard className="h-4 w-4 text-emerald-500" />,
      hint: 'Total transactions',
    },
    {
      label: 'Pending waitlist',
      value: pendingWaitlist.toLocaleString(),
      icon: <Clock className="h-4 w-4 text-amber-500" />,
      hint: 'Awaiting review',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin overview</h1>
        <p className="text-sm text-muted-foreground">
          Platform health and onboarding pipeline at a glance.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {k.label}
                </span>
                {k.icon}
              </div>
              <div className="mt-2 text-2xl font-bold tabular-nums">{k.value}</div>
              <div className="text-[10px] text-muted-foreground mt-1">{k.hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">Processed volume</CardTitle>
              <CardDescription>Total completed payment value</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {fmt(volume)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent waitlist entries</CardTitle>
          <CardDescription>Latest sign-ups awaiting review</CardDescription>
        </CardHeader>
        <CardContent>
          {recentWaitlist.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Clock className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No waitlist entries</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                New sign-ups will show up here for review.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentWaitlist.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {w.email}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {w.company || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {w.country}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={w.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(w.createdAt)}
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
