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
  KpiCard,
  EmptyState,
  PageHeader,
  fmtDate,
} from '@/components/role-ui';
import { Search, Users, Building2, CreditCard } from 'lucide-react';
import { SearchBar } from '@/components/support/search-bar';

export const dynamic = 'force-dynamic';

export default async function SupportSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const sp = await searchParams;
  const initialQuery =
    typeof sp.q === 'string' ? sp.q.slice(0, 200) : '';

  // Recent entities surfaced as the "browse" view alongside the live search.
  const [recentUsers, recentMerchants, recentPayments] = await Promise.all([
    db.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { roles: true },
    }),
    db.merchant.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    db.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Search"
        description="Search across payments, payouts, merchants and customers — or browse the most recent records below."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Recent users"
          value={recentUsers.length.toString()}
          icon={<Users className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Recent merchants"
          value={recentMerchants.length.toString()}
          icon={<Building2 className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Recent payments"
          value={recentPayments.length.toString()}
          icon={<CreditCard className="h-4 w-4" />}
          tone="cyan"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Global search</CardTitle>
          <CardDescription>
            Type to search live across all four record types. Results are
            grouped by type and link to the relevant dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SearchBar initialQuery={initialQuery} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent users</CardTitle>
          <CardDescription>Latest sign-ups across the platform</CardDescription>
        </CardHeader>
        <CardContent>
          {recentUsers.length === 0 ? (
            <EmptyState
              icon={<Search className="h-6 w-6" />}
              title="No users found"
              description="New user registrations will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <span className="rounded bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-600 dark:text-teal-400">
                        {u.roles[0]?.role || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={u.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(u.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent merchants</CardTitle>
          <CardDescription>Latest merchant onboardings</CardDescription>
        </CardHeader>
        <CardContent>
          {recentMerchants.length === 0 ? (
            <EmptyState
              icon={<Building2 className="h-6 w-6" />}
              title="No merchants found"
              description="Newly onboarded merchants will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentMerchants.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{m.country}</TableCell>
                    <TableCell className="text-xs">{m.currency}</TableCell>
                    <TableCell>
                      <StatusBadge status={m.tier} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={m.status} />
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
