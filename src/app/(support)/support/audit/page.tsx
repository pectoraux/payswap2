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
import { History, Activity, ShieldCheck, AlertTriangle } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function SupportAuditPage() {
  const session = await getServerSession(authOptions);

  const [logs, total, successCount, failCount] = await Promise.all([
    db.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: true },
    }),
    db.auditLog.count(),
    db.auditLog.count({ where: { result: 'SUCCESS' } }),
    db.auditLog.count({ where: { result: { not: 'SUCCESS' } } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit trail"
        description="Immutable record of every action taken on the platform."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total entries"
          value={total.toLocaleString()}
          icon={<History className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Successful"
          value={successCount.toLocaleString()}
          icon={<ShieldCheck className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Failed"
          value={failCount.toLocaleString()}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={failCount > 0 ? 'rose' : 'amber'}
        />
        <KpiCard
          label="Shown"
          value={logs.length.toString()}
          hint="Latest 100"
          icon={<Activity className="h-4 w-4" />}
          tone="cyan"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit log</CardTitle>
          <CardDescription>
            {logs.length} entr{logs.length === 1 ? 'y' : 'ies'} shown
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <EmptyState
              icon={<History className="h-6 w-6" />}
              title="No audit entries"
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
                {logs.map((l) => (
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
