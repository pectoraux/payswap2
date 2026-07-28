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
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtCurrency,
  fmtDate,
} from '@/components/role-ui';
import { Plane, Send, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { TravelRuleTransmitButton } from '@/components/compliance/travel-rule-transmit-button';
import { travelRuleService } from '@/trust';

export const dynamic = 'force-dynamic';

export default async function ComplianceTravelRulePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const statusFilter = sp.status as any;

  const records = travelRuleService.list({ status: statusFilter });
  const stats = travelRuleService.stats();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Travel rule"
        description="FATF Recommendation 16 — originator & beneficiary data must travel with transfers above the threshold."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Pending"
          value={stats.pending}
          icon={<Plane className="h-4 w-4" />}
          tone={stats.pending > 0 ? 'amber' : 'emerald'}
        />
        <KpiCard
          label="Transmitted"
          value={stats.transmitted}
          icon={<Send className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Failed"
          value={stats.failed}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={stats.failed > 0 ? 'rose' : 'emerald'}
        />
        <KpiCard
          label="Total"
          value={stats.total}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="cyan"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Travel rule records</CardTitle>
              <CardDescription>
                {records.length} record{records.length === 1 ? '' : 's'} on file
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip
                href="/compliance/travel-rule"
                label="All"
                active={!statusFilter}
              />
              <FilterChip
                href="/compliance/travel-rule?status=pending"
                label="Pending"
                active={statusFilter === 'pending'}
              />
              <FilterChip
                href="/compliance/travel-rule?status=transmitted"
                label="Transmitted"
                active={statusFilter === 'transmitted'}
              />
              <FilterChip
                href="/compliance/travel-rule?status=failed"
                label="Failed"
                active={statusFilter === 'failed'}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <EmptyState
              icon={<Plane className="h-6 w-6" />}
              title="No travel rule records"
              description="Records are created automatically when a transaction exceeds the threshold (USD 1,000 / EUR 1,000)."
            />
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction</TableHead>
                    <TableHead>Originator → Beneficiary</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Threshold</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Transmitted</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">
                        {r.transactionId.slice(0, 14)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col text-xs">
                          <span className="font-medium">
                            {r.originator.name}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {r.originator.account.slice(0, 14)}
                          </span>
                          <span className="mt-0.5 text-muted-foreground">→</span>
                          <span className="font-medium">
                            {r.beneficiary.name}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {r.beneficiary.account.slice(0, 14)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmtCurrency(r.amount, r.currency)}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {fmtCurrency(r.threshold, r.currency)}
                      </TableCell>
                      <TableCell>
                        <TravelRuleStatusPill status={r.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.transmittedAt ? fmtDate(new Date(r.transmittedAt)) : '—'}
                      </TableCell>
                      <TableCell>
                        {r.status === 'pending' ? (
                          <TravelRuleTransmitButton recordId={r.id} />
                        ) : (
                          <span className="text-[10px] text-muted-foreground italic">
                            —
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

function TravelRuleStatusPill({ status }: { status: string }) {
  const tone =
    status === 'transmitted'
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : status === 'failed'
      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
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
