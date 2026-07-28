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
  fmtDate,
} from '@/components/role-ui';
import { Ban, AlertTriangle, ShieldCheck, Search } from 'lucide-react';
import { SanctionsResolveActions } from '@/components/compliance/sanctions-resolve-actions';
import { sanctionsScreener } from '@/trust';

export const dynamic = 'force-dynamic';

export default async function ComplianceSanctionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const statusFilter = sp.status as any;

  const screenings = sanctionsScreener.list({
    status: statusFilter,
  });
  const stats = sanctionsScreener.stats();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sanctions screening"
        description="Fuzzy matches against OFAC, UN, EU, UK HMT and PaySwap internal watchlists."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total hits"
          value={stats.total}
          icon={<Ban className="h-4 w-4" />}
          tone={stats.total > 0 ? 'rose' : 'emerald'}
        />
        <KpiCard
          label="Pending"
          value={stats.pending}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="amber"
        />
        <KpiCard
          label="True positive"
          value={stats.truePositives}
          icon={<ShieldCheck className="h-4 w-4" />}
          tone="rose"
        />
        <KpiCard
          label="False positive"
          value={stats.falsePositives}
          icon={<Search className="h-4 w-4" />}
          tone="teal"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Screening hits</CardTitle>
              <CardDescription>
                {screenings.length} hit{screenings.length === 1 ? '' : 's'} recorded
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip
                href="/compliance/sanctions"
                label="All"
                active={!statusFilter}
              />
              <FilterChip
                href="/compliance/sanctions?status=pending"
                label="Pending"
                active={statusFilter === 'pending'}
              />
              <FilterChip
                href="/compliance/sanctions?status=true_positive"
                label="True positive"
                active={statusFilter === 'true_positive'}
              />
              <FilterChip
                href="/compliance/sanctions?status=false_positive"
                label="False positive"
                active={statusFilter === 'false_positive'}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {screenings.length === 0 ? (
            <EmptyState
              icon={<Ban className="h-6 w-6" />}
              title="No sanctions hits"
              description="When the screener matches an entity against a watchlist, the hit will appear here."
            />
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity</TableHead>
                    <TableHead>Matched name</TableHead>
                    <TableHead>List</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Screened</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {screenings.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold">
                            {s.entityName}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {s.entityId.slice(0, 12)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{s.matchedName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {s.matchedList}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums font-semibold">
                            {s.matchScore}
                          </span>
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${
                                s.matchScore >= 85
                                  ? 'bg-rose-500'
                                  : s.matchScore >= 60
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                              }`}
                              style={{ width: `${s.matchScore}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <SanctionsStatusPill status={s.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(new Date(s.screenedAt))}
                      </TableCell>
                      <TableCell>
                        <SanctionsResolveActions
                          screeningId={s.id}
                          status={s.status}
                        />
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

function SanctionsStatusPill({ status }: { status: string }) {
  const tone =
    status === 'true_positive'
      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
      : status === 'false_positive'
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : status === 'review'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
      : 'bg-teal-500/10 text-teal-600 dark:text-teal-400';
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tone}`}
    >
      {status.replace('_', ' ')}
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
