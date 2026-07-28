import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  EmptyState,
  PageHeader,
  fmtDate,
} from '@/components/role-ui';
import { PageBreadcrumbs } from '@/components/breadcrumbs';
import { Repeat2, AlertTriangle, RotateCw } from 'lucide-react';
import { opsEngine } from '@/ops';
import { SettlementOpsActions } from '@/components/ops/settlement-ops-actions';
import { RequestSettlementOpDialog } from '@/components/ops/request-settlement-op-dialog';
import { RetrySettlementButton } from '@/components/ops/retry-settlement-button';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  approved: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  executed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  failed: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

const TYPE_CLASS: Record<string, string> = {
  manual_settlement: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  retry_failed: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  force_complete: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  reverse: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  reconcile: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
};

interface SettlementOpsPageProps {
  searchParams: Promise<{ status?: string; type?: string }>;
}

export default async function SettlementOpsPage({
  searchParams,
}: SettlementOpsPageProps) {
  const sp = await searchParams;
  const [operations, failed] = await Promise.all([
    opsEngine.settlement.list({ status: sp.status, type: sp.type }),
    opsEngine.settlement.getFailedSettlements(),
  ]);

  const pending = operations.filter((op) => op.status === 'pending');

  return (
    <div className="space-y-6">
      <PageBreadcrumbs
        items={[
          { label: 'Operations', href: '/ops' },
          { label: 'Settlement Ops' },
        ]}
      />
      <PageHeader
        title="Settlement operations"
        description="Manual settlements, retries, force-completes, reversals and reconciliations."
        action={<RequestSettlementOpDialog />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pending
              </span>
              <Repeat2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {pending.length}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              awaiting approval/execution
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Failed (24h)
              </span>
              <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {failed.length}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              eligible for retry
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total operations
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {operations.length}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              all-time in Operations OS
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Failed first */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              <div>
                <CardTitle className="text-base">Failed settlements</CardTitle>
                <CardDescription>
                  {failed.length} failed settlement
                  {failed.length === 1 ? '' : 's'} — eligible for retry
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {failed.length === 0 ? (
            <EmptyState
              icon={<RotateCw className="h-6 w-6" />}
              title="No failed settlements"
              description="All settlements have landed cleanly."
            />
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Requested by</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead>Rationale</TableHead>
                    <TableHead className="w-24">Retry</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {failed.map((op) => (
                    <TableRow key={op.id}>
                      <TableCell className="font-mono text-[10px]">
                        {op.transactionId}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] font-medium capitalize ${
                            TYPE_CLASS[op.type] ?? ''
                          }`}
                        >
                          {op.type.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-[10px]">
                        {op.requestedBy.slice(0, 10)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(new Date(op.createdAt))}
                      </TableCell>
                      <TableCell className="max-w-[16rem] truncate text-xs">
                        {op.rationale}
                      </TableCell>
                      <TableCell>
                        <RetrySettlementButton transactionId={op.transactionId} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending approval */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Repeat2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <div>
              <CardTitle className="text-base">Pending approval</CardTitle>
              <CardDescription>
                {pending.length} operation
                {pending.length === 1 ? '' : 's'} awaiting action
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <EmptyState
              icon={<Repeat2 className="h-6 w-6" />}
              title="No pending operations"
              description="All requested settlement operations have been actioned."
            />
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Requested by</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead>Rationale</TableHead>
                    <TableHead className="w-32">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((op) => (
                    <TableRow key={op.id}>
                      <TableCell className="font-mono text-[10px]">
                        {op.transactionId}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] font-medium capitalize ${
                            TYPE_CLASS[op.type] ?? ''
                          }`}
                        >
                          {op.type.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-[10px]">
                        {op.requestedBy.slice(0, 10)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(new Date(op.createdAt))}
                      </TableCell>
                      <TableCell className="max-w-[16rem] truncate text-xs">
                        {op.rationale}
                      </TableCell>
                      <TableCell>
                        <SettlementOpsActions op={op} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* All operations */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="text-base">All operations</CardTitle>
            <CardDescription>
              {operations.length} total operation
              {operations.length === 1 ? '' : 's'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {operations.length === 0 ? (
            <EmptyState
              icon={<Repeat2 className="h-6 w-6" />}
              title="No operations"
              description="Use “Request operation” to open a new settlement operation."
            />
          ) : (
            <div className="max-h-[32rem] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Requested by</TableHead>
                    <TableHead>Approved by</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operations.map((op) => (
                    <TableRow key={op.id}>
                      <TableCell className="font-mono text-[10px]">
                        {op.transactionId}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] font-medium capitalize ${
                            TYPE_CLASS[op.type] ?? ''
                          }`}
                        >
                          {op.type.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] font-medium capitalize ${
                            STATUS_CLASS[op.status] ?? ''
                          }`}
                        >
                          {op.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-[10px]">
                        {op.requestedBy.slice(0, 10)}
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground">
                        {op.approvedBy?.slice(0, 10) ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(new Date(op.createdAt))}
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
