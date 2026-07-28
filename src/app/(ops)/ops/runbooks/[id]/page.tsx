import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader, fmtDate } from '@/components/role-ui';
import { PageBreadcrumbs } from '@/components/breadcrumbs';
import {
  ArrowLeft,
  Terminal,
  ListChecks,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { opsEngine } from '@/ops';

export const dynamic = 'force-dynamic';

const CATEGORY_CLASS: Record<string, string> = {
  incident: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  treasury: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  settlement: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  maintenance: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  migration: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  security: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
};

interface RunbookDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function RunbookDetailPage({
  params,
}: RunbookDetailPageProps) {
  const { id } = await params;
  if (!id) notFound();
  const runbook = await opsEngine.runbooks.get(id);
  if (!runbook) notFound();

  return (
    <div className="space-y-6">
      <PageBreadcrumbs
        items={[
          { label: 'Operations', href: '/ops' },
          { label: 'Runbooks', href: '/ops/runbooks' },
          { label: runbook.name },
        ]}
      />

      <div className="flex items-center gap-2 text-xs">
        <Link
          href="/ops/runbooks"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to runbooks
        </Link>
      </div>

      <PageHeader
        title={runbook.name}
        description={runbook.description}
        action={
          <Badge
            variant="secondary"
            className={`text-[10px] font-semibold uppercase ${
              CATEGORY_CLASS[runbook.category] ?? ''
            }`}
          >
            {runbook.category}
          </Badge>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card/50 p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Owner
          </div>
          <div className="mt-0.5 font-mono text-sm font-medium">
            {runbook.owner}
          </div>
        </div>
        <div className="rounded-lg border bg-card/50 p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Version
          </div>
          <div className="mt-0.5 text-sm font-medium">v{runbook.version}</div>
        </div>
        <div className="rounded-lg border bg-card/50 p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Updated
          </div>
          <div className="mt-0.5 text-sm font-medium">
            {fmtDate(new Date(runbook.updatedAt))}
          </div>
        </div>
        <div className="rounded-lg border bg-card/50 p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Steps
          </div>
          <div className="mt-0.5 text-sm font-medium">
            {runbook.steps.length} total ·{' '}
            {runbook.steps.filter((s) => s.command).length} with commands
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">When to use this runbook</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{runbook.trigger}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <div>
              <CardTitle className="text-base">Steps</CardTitle>
              <CardDescription>
                Follow these steps in order. Each step has an optional command,
                expected output, and validation check.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="relative space-y-4 border-l border-emerald-500/30 pl-4">
            {runbook.steps.map((step) => (
              <li key={step.order} className="relative">
                <span className="absolute -left-[1.4rem] top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white ring-2 ring-background">
                  {step.order}
                </span>
                <div className="rounded-lg border bg-card/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold">{step.title}</h4>
                    {step.command && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      >
                        <Terminal className="mr-1 h-3 w-3" /> CLI
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {step.description}
                  </p>
                  {step.command && (
                    <div className="mt-2 overflow-x-auto rounded-md bg-muted p-2">
                      <code className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                        $ {step.command}
                      </code>
                    </div>
                  )}
                  {step.expectedOutput && (
                    <div className="mt-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2 text-[11px]">
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        Expected:
                      </span>{' '}
                      <code className="font-mono text-foreground">
                        {step.expectedOutput}
                      </code>
                    </div>
                  )}
                  {step.validationCheck && (
                    <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span>
                        <span className="font-medium">Validate:</span>{' '}
                        {step.validationCheck}
                      </span>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <div>
              <CardTitle className="text-base">Notes</CardTitle>
              <CardDescription>
                Runbook steps are advisory — always verify with the live system
                before declaring an incident resolved.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          This runbook is part of the PaySwap Operations OS (M-OPS-42). Custom
          runbooks can be added via the RunbookManager API.
        </CardContent>
      </Card>
    </div>
  );
}
