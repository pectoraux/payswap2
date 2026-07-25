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
import { QuickSearch } from '@/components/support/quick-search';
import {
  History,
  Users,
  CreditCard,
  Building2,
  Search,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function SupportOverviewPage() {
  const session = await getServerSession(authOptions);

  const [recentLogs, users, merchants, payments, auditCount] = await Promise.all([
    db.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { user: true },
    }),
    db.user.count({ where: { deletedAt: null } }),
    db.merchant.count(),
    db.payment.count(),
    db.auditLog.count(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support overview"
        description="Search the platform and review recent activity."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick search</CardTitle>
          <CardDescription>
            Find users, payments, merchants and more across the platform.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QuickSearch />
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <Search className="h-3.5 w-3.5" />
            Search is a placeholder in this build. Connect it to your search index to enable.
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total users"
          value={users.toLocaleString()}
          icon={<Users className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Merchants"
          value={merchants.toLocaleString()}
          icon={<Building2 className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Payments"
          value={payments.toLocaleString()}
          icon={<CreditCard className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Audit entries"
          value={auditCount.toLocaleString()}
          icon={<History className="h-4 w-4" />}
          tone="amber"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent audit logs</CardTitle>
          <CardDescription>Latest platform activity</CardDescription>
        </CardHeader>
        <CardContent>
          {recentLogs.length === 0 ? (
            <EmptyState
              icon={<History className="h-6 w-6" />}
              title="No audit logs yet"
              description="Audit log entries will appear here as users interact with the platform."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentLogs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{l.action}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {l.resourceType}
                      {l.resourceId ? `:${l.resourceId.slice(0, 8)}` : ''}
                    </TableCell>
                    <TableCell className="text-xs">
                      {l.user?.email || (l.userId ? l.userId.slice(0, 8) : 'system')}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={l.result} />
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
                      {l.ip || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(l.createdAt)}
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
