import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/empty-state';
import {
  Users, Building2, CreditCard, DollarSign, ArrowRight, Clock,
} from 'lucide-react';
import { requireAdmin } from '@/lib/auth-guards';
import { adminOverviewReadModel } from '@/runtime';
import { formatCurrency, formatDate, formatNumber, statusBadgeClass } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  await requireAdmin();

  const overview = await adminOverviewReadModel.get();
  const { merchantCount, userCount, paymentCount, totalVolume, pendingWaitlistCount, recentWaitlist } = overview;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform overview"
        description="Top-level stats across all merchants, users and payments on PaySwap."
        actions={
          <Button asChild className="bg-emerald-600 text-white hover:bg-emerald-700">
            <Link href="/admin/waitlist">
              Review waitlist <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Merchants"
          value={formatNumber(merchantCount)}
          icon={<Building2 className="h-5 w-5" />}
          hint="All statuses"
          color="emerald"
        />
        <StatCard
          label="Users"
          value={formatNumber(userCount)}
          icon={<Users className="h-5 w-5" />}
          hint="Total sign-ups"
          color="teal"
        />
        <StatCard
          label="Payments"
          value={formatNumber(paymentCount)}
          icon={<CreditCard className="h-5 w-5" />}
          hint="All-time"
          color="sky"
        />
        <StatCard
          label="Volume (completed)"
          value={formatCurrency(totalVolume, 'USD')}
          icon={<DollarSign className="h-5 w-5" />}
          hint="Settled"
          color="violet"
        />
      </div>

      {/* Pending waitlist alert */}
      {pendingWaitlistCount > 0 && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="flex items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">
                  {pendingWaitlistCount} waitlist {pendingWaitlistCount === 1 ? 'entry' : 'entries'} pending review
                </div>
                <div className="text-xs text-muted-foreground">
                  Approve or reject applicants to convert them into merchants.
                </div>
              </div>
            </div>
            <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Link href="/admin/waitlist">Review <ArrowRight className="h-3.5 w-3.5" /></Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Recent waitlist */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Recent waitlist entries</CardTitle>
            <CardDescription>Most recent applications to join PaySwap</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/waitlist">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {recentWaitlist.length === 0 ? (
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title="No waitlist entries"
              description="When prospective merchants sign up via the waitlist, they'll appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Applied</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentWaitlist.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell className="text-muted-foreground">{w.email}</TableCell>
                    <TableCell className="text-muted-foreground">{w.company ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{w.country}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusBadgeClass(w.status)}>
                        {w.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatDate(w.createdAt, true)}
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
