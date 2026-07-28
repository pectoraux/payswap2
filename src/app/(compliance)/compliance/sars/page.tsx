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
import { Badge } from '@/components/ui/badge';
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtCurrency,
  fmtDate,
} from '@/components/role-ui';
import { Send, FileText, Clock, CheckCircle2 } from 'lucide-react';
import { SarFileButton } from '@/components/compliance/sar-file-button';
import { CreateSarDialog } from '@/components/compliance/create-sar-dialog';
import { sarManager, amlPipeline } from '@/trust';

export const dynamic = 'force-dynamic';

export default async function ComplianceSarsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const statusFilter = sp.status as any;

  const sars = await sarManager.list({ status: statusFilter });
  const stats = await sarManager.stats();

  // Build alert options (open + investigating + escalated) for the create-SAR dialog.
  const alertOptions = (await amlPipeline
    .listAlerts())
    .filter(
      (a) =>
        a.status === 'open' ||
        a.status === 'investigating' ||
        a.status === 'escalated',
    )
    .slice(0, 30)
    .map((a) => ({
      id: a.id,
      label: `${a.ruleName} — ${a.entityType}:${a.entityId.slice(0, 8)}`,
    }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suspicious Activity Reports"
        description="Formal reports filed with the Financial Intelligence Unit when activity is suspicious."
        action={<CreateSarDialog alertOptions={alertOptions} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Draft"
          value={stats.draft}
          icon={<FileText className="h-4 w-4" />}
          tone="amber"
        />
        <KpiCard
          label="Filed"
          value={stats.filed}
          icon={<Send className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Acknowledged"
          value={stats.acknowledged}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Total amount"
          value={fmtCurrency(stats.totalAmount, 'USD')}
          hint={`${stats.total} SAR${stats.total === 1 ? '' : 's'}`}
          icon={<Clock className="h-4 w-4" />}
          tone="violet"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">All SARs</CardTitle>
              <CardDescription>
                {sars.length} SAR{sars.length === 1 ? '' : 's'} on record
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip
                href="/compliance/sars"
                label="All"
                active={!statusFilter}
              />
              <FilterChip
                href="/compliance/sars?status=draft"
                label="Draft"
                active={statusFilter === 'draft'}
              />
              <FilterChip
                href="/compliance/sars?status=filed"
                label="Filed"
                active={statusFilter === 'filed'}
              />
              <FilterChip
                href="/compliance/sars?status=acknowledged"
                label="Acknowledged"
                active={statusFilter === 'acknowledged'}
              />
              <FilterChip
                href="/compliance/sars?status=closed"
                label="Closed"
                active={statusFilter === 'closed'}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {sars.length === 0 ? (
            <EmptyState
              icon={<Send className="h-6 w-6" />}
              title="No SARs yet"
              description="Use “Create SAR” to draft a new suspicious activity report from one or more alerts."
            />
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SAR ID</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Narrative</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Regulator ref</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sars.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs font-semibold">
                        {s.id.slice(0, 14)}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate text-xs">
                        {s.subject}
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">
                        {s.narrative}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmtCurrency(s.amount, s.currency)}
                      </TableCell>
                      <TableCell>
                        <SarStatusPill status={s.status} />
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground">
                        {s.regulatorReference ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(new Date(s.createdAt))}
                      </TableCell>
                      <TableCell>
                        {s.status === 'draft' ? (
                          <SarFileButton sarId={s.id} />
                        ) : (
                          <span className="text-[10px] text-muted-foreground italic">
                            Filed
                          </span>
                        )}
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

function SarStatusPill({ status }: { status: string }) {
  const tone =
    status === 'filed'
      ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400'
      : status === 'acknowledged'
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : status === 'closed'
      ? 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400'
      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tone}`}
    >
      {status}
    </span>
  );
}

function FilterChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-border text-muted-foreground hover:bg-accent/40'
      }`}
    >
      {label}
    </Link>
  );
}
