import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  EmptyState,
  PageHeader,
  fmtDate,
} from '@/components/role-ui';
import { PageBreadcrumbs } from '@/components/breadcrumbs';
import { FlaskConical, ArrowRight } from 'lucide-react';
import { opsEngine } from '@/ops';
import type { OpsInvestigation } from '@/ops/types';
import { CreateInvestigationDialog } from '@/components/ops/create-investigation-dialog';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<string, string> = {
  open: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  in_progress: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  concluded: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
};

function InvestigationCard({ inv }: { inv: OpsInvestigation }) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">{inv.title}</CardTitle>
            {inv.incidentId && (
              <CardDescription className="mt-0.5">
                Linked incident:{' '}
                <Link
                  href={`/ops/incidents/${inv.incidentId}`}
                  className="font-mono text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  {inv.incidentId.slice(0, 12)}
                </Link>
              </CardDescription>
            )}
          </div>
          <Badge
            variant="secondary"
            className={`shrink-0 text-[10px] font-medium capitalize ${
              STATUS_CLASS[inv.status] ?? ''
            }`}
          >
            {inv.status.replace('_', ' ')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="text-xs text-muted-foreground">{inv.description}</p>
        {inv.findings && (
          <div className="rounded-lg border bg-card/50 p-2.5 text-xs">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Findings
            </div>
            <div className="mt-1 whitespace-pre-wrap text-foreground">
              {inv.findings}
            </div>
          </div>
        )}
        <div className="mt-auto flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            Assigned to{' '}
            <span className="font-mono">{inv.assignedTo}</span>
          </span>
          <span>
            {inv.concludedAt
              ? `concluded ${fmtDate(new Date(inv.concludedAt))}`
              : `opened ${fmtDate(new Date(inv.createdAt))}`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

interface InvestigationsPageProps {
  searchParams: Promise<{ status?: string; assignedTo?: string }>;
}

export default async function InvestigationsPage({
  searchParams,
}: InvestigationsPageProps) {
  const sp = await searchParams;
  const investigations = await opsEngine.investigations.list({
    status: sp.status,
    assignedTo: sp.assignedTo,
  });

  const open = investigations.filter((i) => i.status !== 'concluded');
  const concluded = investigations.filter((i) => i.status === 'concluded');

  return (
    <div className="space-y-6">
      <PageBreadcrumbs
        items={[
          { label: 'Operations', href: '/ops' },
          { label: 'Investigations' },
        ]}
      />
      <PageHeader
        title="Investigations"
        description="Deeper-dive investigations into incidents and anomalies."
        action={<CreateInvestigationDialog />}
      />

      <div className="flex flex-wrap gap-2">
        <Link
          href="/ops/investigations"
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
            !sp.status
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-border bg-card/50 text-muted-foreground hover:bg-emerald-500/5'
          }`}
        >
          All ({investigations.length})
        </Link>
        {['open', 'in_progress', 'concluded'].map((s) => {
          const count = investigations.filter((i) => i.status === s).length;
          return (
            <Link
              key={s}
              href={`/ops/investigations?status=${s}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition ${
                sp.status === s
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-border bg-card/50 text-muted-foreground hover:bg-emerald-500/5'
              }`}
            >
              {s.replace('_', ' ')} ({count})
            </Link>
          );
        })}
      </div>

      {open.length === 0 && concluded.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<FlaskConical className="h-6 w-6" />}
              title="No investigations"
              description="Open an investigation to capture the root cause of an incident or anomaly."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {open.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Active ({open.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {open.map((inv) => (
                  <InvestigationCard key={inv.id} inv={inv} />
                ))}
              </div>
            </div>
          )}
          {concluded.length > 0 && (
            <div>
              <h2 className="mb-2 mt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Concluded ({concluded.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {concluded.slice(0, 9).map((inv) => (
                  <InvestigationCard key={inv.id} inv={inv} />
                ))}
              </div>
              {concluded.length > 9 && (
                <div className="mt-2 flex justify-center">
                  <Link
                    href="/ops/investigations?status=concluded"
                    className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline dark:text-emerald-400"
                  >
                    Show all {concluded.length} concluded{' '}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
