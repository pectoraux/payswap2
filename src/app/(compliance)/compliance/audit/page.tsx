import Link from 'next/link';
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
import { Input } from '@/components/ui/input';
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtDate,
} from '@/components/role-ui';
import { ScrollText, CheckCircle2, XCircle, AlertOctagon } from 'lucide-react';
import { complianceAuditTrail } from '@/trust';

export const dynamic = 'force-dynamic';

export default async function ComplianceAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    action?: string;
    actorId?: string;
    entityType?: string;
    entityId?: string;
    result?: string;
    limit?: string;
  }>;
}) {
  const sp = await searchParams;
  const limit = sp.limit
    ? Math.min(500, Math.max(1, parseInt(sp.limit, 10) || 100))
    : 100;

  const entries = await complianceAuditTrail.query({
    action: sp.action,
    actorId: sp.actorId,
    entityType: sp.entityType,
    entityId: sp.entityId,
    result: sp.result as any,
    limit,
  });
  const stats = await complianceAuditTrail.stats();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance audit trail"
        description="Every trust-engine action: alert disposition, KYC decision, SAR filing, sanctions resolution, transmission, risk recompute."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total events"
          value={stats.total}
          icon={<ScrollText className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Success"
          value={stats.success}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Denied"
          value={stats.denied}
          icon={<XCircle className="h-4 w-4" />}
          tone="amber"
        />
        <KpiCard
          label="Errors"
          value={stats.error}
          icon={<AlertOctagon className="h-4 w-4" />}
          tone="rose"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter</CardTitle>
          <CardDescription>
            Narrow by action, actor, entity or result
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Input
              name="action"
              placeholder="action (substring)"
              defaultValue={sp.action ?? ''}
            />
            <Input
              name="actorId"
              placeholder="actor id"
              defaultValue={sp.actorId ?? ''}
            />
            <Input
              name="entityType"
              placeholder="entity type"
              defaultValue={sp.entityType ?? ''}
            />
            <Input
              name="entityId"
              placeholder="entity id"
              defaultValue={sp.entityId ?? ''}
            />
            <Input
              name="result"
              placeholder="result (success|denied|error)"
              defaultValue={sp.result ?? ''}
            />
            <button
              type="submit"
              className="hidden"
              aria-hidden
            />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit entries</CardTitle>
          <CardDescription>
            {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} (showing last {limit})
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <EmptyState
              icon={<ScrollText className="h-6 w-6" />}
              title="No audit entries match the filter"
              description="Adjust the filter above to see more results."
            />
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-xs">
                        {e.action}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {e.actorId.slice(0, 14)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <Link
                          href={`/compliance/audit?entityType=${encodeURIComponent(
                            e.entityType,
                          )}&entityId=${encodeURIComponent(e.entityId)}`}
                          className="hover:underline"
                        >
                          {e.entityType}:{e.entityId.slice(0, 8)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <ResultPill result={e.result ?? 'SUCCESS'} />
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate font-mono text-[10px] text-muted-foreground">
                        {Object.keys(e.details).length > 0
                          ? JSON.stringify(e.details)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(new Date(e.createdAt ?? e.timestamp))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ResultPill({ result }: { result: string }) {
  const tone =
    result === 'success'
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : result === 'denied'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
      : 'bg-rose-500/10 text-rose-600 dark:text-rose-400';
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tone}`}
    >
      {result}
    </span>
  );
}
