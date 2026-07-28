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
  fmtNumber,
  fmtCurrency,
} from '@/components/role-ui';
import { PageBreadcrumbs } from '@/components/breadcrumbs';
import { Landmark, Clock } from 'lucide-react';
import { opsEngine } from '@/ops';
import type { TreasuryOperation } from '@/ops/types';
import { TreasuryOpsActions } from '@/components/ops/treasury-ops-actions';
import { RequestTreasuryOpDialog } from '@/components/ops/request-treasury-op-dialog';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  approved: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  executed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  failed: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  reversed: 'bg-gray-500/15 text-gray-600 dark:text-gray-400',
};

interface TreasuryOpsPageProps {
  searchParams: Promise<{ status?: string; type?: string }>;
}

export default async function TreasuryOpsPage({
  searchParams,
}: TreasuryOpsPageProps) {
  const sp = await searchParams;
  const [operations, pending] = await Promise.all([
    opsEngine.treasury.list({ status: sp.status, type: sp.type }),
    opsEngine.treasury.getPending(),
  ]);

  // KPIs
  const totalRequested = operations.reduce((sum, op) => sum + op.amount, 0);
  const pendingAmount = pending.reduce((sum, op) => sum + op.amount, 0);
  const executed = operations.filter((op) => op.status === 'executed');
  const executedAmount = executed.reduce((sum, op) => sum + op.amount, 0);

  return (
    <div className="space-y-6">
      <PageBreadcrumbs
        items={[
          { label: 'Operations', href: '/ops' },
          { label: 'Treasury Ops' },
        ]}
      />
      <PageHeader
        title="Treasury operations"
        description="Manual treasury operations: reserve adjustments, rebalances, withdrawals, deposits and FX hedges."
        action={<RequestTreasuryOpDialog />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pending
              </span>
              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {pending.length}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {fmtCurrency(pendingAmount, 'USD')} awaiting approval
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Executed (24h)
              </span>
              <Landmark className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {executed.length}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {fmtCurrency(executedAmount, 'USD')} total
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total (all)
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {operations.length}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {fmtCurrency(totalRequested, 'USD')} requested
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Failed / reversed
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {operations.filter((op) => op.status === 'failed' || op.status === 'reversed').length}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Needs review
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending first */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <div>
              <CardTitle className="text-base">Pending approval</CardTitle>
              <CardDescription>
                {pending.length} operation{pending.length === 1 ? '' : 's'} awaiting action
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <EmptyState
              icon={<Landmark className="h-6 w-6" />}
              title="No pending operations"
              description="All requested treasury operations have been actioned."
            />
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Requested by</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead>Rationale</TableHead>
                    <TableHead className="w-32">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((op) => (
                    <TableRow key={op.id}>
                      <TableCell>
                        <span className="text-xs font-semibold capitalize">
                          {op.type.replace(/_/g, ' ')}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="rounded bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-600 dark:text-teal-400">
                          {op.country} {op.currency}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(op.amount, 0)}
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
                        <TreasuryOpsActions op={op} />
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
              icon={<Landmark className="h-6 w-6" />}
              title="No operations"
              description="Use “Request operation” to open a new treasury operation."
            />
          ) : (
            <div className="max-h-[32rem] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Requested by</TableHead>
                    <TableHead>Approved by</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operations.map((op: TreasuryOperation) => (
                    <TableRow key={op.id}>
                      <TableCell>
                        <span className="text-xs font-semibold capitalize">
                          {op.type.replace(/_/g, ' ')}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="rounded bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-600 dark:text-teal-400">
                          {op.country} {op.currency}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(op.amount, 0)}
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
