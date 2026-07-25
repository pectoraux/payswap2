import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth-guards';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { History, Filter, ShieldCheck } from 'lucide-react';

export const dynamic = 'force-dynamic';

const FILTER_LIMIT = 12;

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const ctx = await requireAdmin().catch(() => null);
  if (!ctx) redirect('/unauthorized');
  const params = await searchParams;
  const activeAction = params.action?.trim() || 'ALL';

  const where = activeAction === 'ALL' ? {} : { action: activeAction };

  const [logs, total, successCount, failCount, distinctActions] =
    await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { user: true },
      }),
      db.auditLog.count(),
      db.auditLog.count({ where: { result: 'SUCCESS' } }),
      db.auditLog.count({ where: { result: { not: 'SUCCESS' } } }),
      db.auditLog.findMany({
        distinct: ['action'],
        orderBy: { action: 'asc' },
        select: { action: true },
        take: 50,
      }),
    ]);

  const actionOptions = ['ALL', ...distinctActions.map((a) => a.action)].slice(
    0,
    FILTER_LIMIT,
  );

  const fmtDate = (d: Date) =>
    new Date(d).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit trail</h1>
        <p className="text-sm text-muted-foreground">
          Immutable record of every action taken on the PaySwap platform.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total entries
              </span>
              <History className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {total.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Successful
              </span>
              <ShieldCheck className="h-4 w-4 text-teal-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {successCount.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Failed
              </span>
              <ShieldCheck className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {failCount.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Shown
              </span>
              <History className="h-4 w-4 text-cyan-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {logs.length.toLocaleString()}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">Latest 100</div>
          </CardContent>
        </Card>
      </div>

      {/* Filter chips */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <CardTitle className="text-base">Filter by action</CardTitle>
            <CardDescription className="ml-1">
              Showing {logs.length} entr{logs.length === 1 ? 'y' : 'ies'} for{' '}
              <span className="font-mono text-foreground">{activeAction}</span>
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex gap-2 pb-2">
              {actionOptions.map((a) => {
                const active = a === activeAction;
                const href =
                  a === 'ALL' ? '/admin/audit' : `/admin/audit?action=${encodeURIComponent(a)}`;
                return (
                  <Link
                    key={a}
                    href={href}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'border-border text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    {a}
                  </Link>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Audit table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit log</CardTitle>
          <CardDescription>
            {logs.length} entr{logs.length === 1 ? 'y' : 'ies'} shown
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <History className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No audit entries</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                {activeAction === 'ALL'
                  ? 'Audit log entries will appear here as users interact with the platform.'
                  : `No entries match action "${activeAction}". Try another filter.`}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                      {fmtDate(l.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {l.user?.email ||
                        (l.userId ? l.userId.slice(0, 8) : 'system')}
                    </TableCell>
                    <TableCell className="font-mono text-[11px]">{l.action}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {l.resourceType}
                      {l.resourceId ? `:${l.resourceId.slice(0, 8)}` : ''}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={l.result} />
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
