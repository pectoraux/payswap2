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
import { Database, Play, History, CheckCircle2 } from 'lucide-react';
import { opsEngine } from '@/ops';
import type { Migration, MigrationStep } from '@/ops/types';
import { MigrationActions } from '@/components/ops/migration-actions';
import { PlanMigrationDialog } from '@/components/ops/plan-migration-dialog';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<string, string> = {
  planned: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  in_progress: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  completed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  rolled_back: 'bg-gray-500/15 text-gray-600 dark:text-gray-400',
  failed: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

const TYPE_CLASS: Record<string, string> = {
  schema: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  data: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  code: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  config: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
};

const STEP_CLASS: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  in_progress: 'bg-amber-500 text-white',
  completed: 'bg-emerald-500 text-white',
  failed: 'bg-rose-500 text-white',
};

function StepList({ steps }: { steps: MigrationStep[] }) {
  return (
    <ol className="relative space-y-2 border-l border-emerald-500/30 pl-4">
      {steps.map((step) => (
        <li key={step.order} className="relative">
          <span
            className={`absolute -left-[1.4rem] top-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-background ${
              STEP_CLASS[step.status] ?? STEP_CLASS.pending
            }`}
          >
            {step.order}
          </span>
          <div className="rounded-lg border bg-card/50 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">
                {step.description}
              </span>
              <Badge
                variant="secondary"
                className={`text-[10px] font-medium capitalize ${
                  STATUS_CLASS[step.status] ?? ''
                }`}
              >
                {step.status.replace('_', ' ')}
              </Badge>
            </div>
            {(step.startedAt || step.completedAt) && (
              <div className="mt-1 text-[10px] text-muted-foreground">
                {step.startedAt && `started ${fmtDate(new Date(step.startedAt))}`}
                {step.startedAt && step.completedAt && ' · '}
                {step.completedAt && `done ${fmtDate(new Date(step.completedAt))}`}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function MigrationCard({ m }: { m: Migration }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">{m.name}</CardTitle>
            <CardDescription className="mt-1">{m.description}</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Badge
              variant="secondary"
              className={`text-[10px] font-medium capitalize ${
                TYPE_CLASS[m.type] ?? ''
              }`}
            >
              {m.type}
            </Badge>
            <Badge
              variant="secondary"
              className={`text-[10px] font-medium capitalize ${
                STATUS_CLASS[m.status] ?? ''
              }`}
            >
              {m.status.replace('_', ' ')}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3 text-xs">
          <div className="rounded-lg border bg-card/50 p-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Version
            </div>
            <div className="mt-0.5 font-mono text-[11px]">{m.version}</div>
          </div>
          <div className="rounded-lg border bg-card/50 p-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Started by
            </div>
            <div className="mt-0.5 font-mono text-[11px]">
              {m.startedBy.slice(0, 12)}
            </div>
          </div>
          <div className="rounded-lg border bg-card/50 p-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Steps
            </div>
            <div className="mt-0.5 text-[11px]">
              {m.steps.filter((s) => s.status === 'completed').length}/
              {m.steps.length} complete
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2.5 text-[11px]">
          <div className="font-semibold text-rose-600 dark:text-rose-400">
            Rollback plan
          </div>
          <div className="mt-0.5 whitespace-pre-wrap font-mono text-foreground">
            {m.rollbackPlan}
          </div>
        </div>
        <StepList steps={m.steps} />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {m.startedAt
              ? `started ${fmtDate(new Date(m.startedAt))}`
              : 'not started'}
            {m.completedAt && ` · done ${fmtDate(new Date(m.completedAt))}`}
          </span>
          <MigrationActions migration={m} />
        </div>
      </CardContent>
    </Card>
  );
}

interface MigrationsPageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function MigrationsPage({
  searchParams,
}: MigrationsPageProps) {
  const sp = await searchParams;
  const [active, planned, all] = await Promise.all([
    opsEngine.migrations.getActive(),
    opsEngine.migrations.list({ status: 'planned' }),
    opsEngine.migrations.list({ status: sp.status }),
  ]);

  const past = all.filter(
    (m) =>
      m.status === 'completed' ||
      m.status === 'rolled_back' ||
      m.status === 'failed',
  );

  return (
    <div className="space-y-6">
      <PageBreadcrumbs
        items={[
          { label: 'Operations', href: '/ops' },
          { label: 'Migrations' },
        ]}
      />
      <PageHeader
        title="Migrations"
        description="Plan and execute schema, data, code and config migrations with rollback plans."
        action={<PlanMigrationDialog />}
      />

      {/* Active banner */}
      {active && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <div>
                <CardTitle className="text-base">
                  In progress: {active.name}
                </CardTitle>
                <CardDescription>
                  v{active.version} · {active.steps.filter((s) => s.status === 'completed').length}/
                  {active.steps.length} steps complete
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <StepList steps={active.steps} />
            <div className="mt-3">
              <MigrationActions migration={active} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Planned */}
      <div>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Database className="h-4 w-4" /> Planned ({planned.length})
        </h2>
        {planned.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={<Database className="h-6 w-6" />}
                title="No planned migrations"
                description="Use “Plan migration” to draft a new migration with rollback plan."
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {planned.map((m) => (
              <MigrationCard key={m.id} m={m} />
            ))}
          </div>
        )}
      </div>

      {/* History */}
      <div>
        <h2 className="mb-2 mt-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <History className="h-4 w-4" /> History ({past.length})
        </h2>
        {past.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={<CheckCircle2 className="h-6 w-6" />}
                title="No migration history"
                description="Completed, rolled-back and failed migrations will appear here."
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {past.slice(0, 6).map((m) => (
              <MigrationCard key={m.id} m={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
