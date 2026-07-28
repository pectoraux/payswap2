import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  PageHeader,
  fmtDate,
} from '@/components/role-ui';
import { PageBreadcrumbs } from '@/components/breadcrumbs';
import {
  ScrollText,
  ArrowRight,
  Terminal,
  CheckCircle2,
  ListChecks,
} from 'lucide-react';
import { opsEngine } from '@/ops';
import type { Runbook } from '@/ops/types';

export const dynamic = 'force-dynamic';

const CATEGORIES = [
  'incident',
  'treasury',
  'settlement',
  'maintenance',
  'migration',
  'security',
] as const;

const CATEGORY_CLASS: Record<string, string> = {
  incident: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  treasury: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  settlement: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  maintenance: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  migration: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  security: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
};

function RunbookCard({ runbook }: { runbook: Runbook }) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">{runbook.name}</CardTitle>
            <CardDescription className="mt-1 line-clamp-2">
              {runbook.description}
            </CardDescription>
          </div>
          <Badge
            variant="secondary"
            className={`shrink-0 text-[10px] font-semibold uppercase ${
              CATEGORY_CLASS[runbook.category] ?? ''
            }`}
          >
            {runbook.category}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="rounded-lg border bg-card/50 p-2.5 text-xs">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            When to use
          </div>
          <div className="mt-0.5 text-foreground">{runbook.trigger}</div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <ListChecks className="h-3 w-3" />
            {runbook.steps.length} steps
          </span>
          <span className="flex items-center gap-1">
            <Terminal className="h-3 w-3" />
            {runbook.steps.filter((s) => s.command).length} commands
          </span>
          <span>v{runbook.version}</span>
        </div>
        <div className="mt-auto flex items-center justify-between">
          <span className="font-mono text-[10px] text-muted-foreground">
            owner: {runbook.owner}
          </span>
          <Button asChild size="sm" variant="outline">
            <Link href={`/ops/runbooks/${runbook.id}`}>
              Open <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface RunbooksPageProps {
  searchParams: Promise<{ category?: string }>;
}

export default async function RunbooksPage({ searchParams }: RunbooksPageProps) {
  const sp = await searchParams;
  const category = sp.category?.toLowerCase();
  const runbooks = await opsEngine.runbooks.list({
    category: CATEGORIES.includes(category as (typeof CATEGORIES)[number])
      ? category
      : undefined,
  });

  // Group by category for display.
  const byCategory = new Map<string, Runbook[]>();
  for (const rb of runbooks) {
    const list = byCategory.get(rb.category) ?? [];
    list.push(rb);
    byCategory.set(rb.category, list);
  }

  return (
    <div className="space-y-6">
      <PageBreadcrumbs
        items={[
          { label: 'Operations', href: '/ops' },
          { label: 'Runbooks' },
        ]}
      />
      <PageHeader
        title="Runbooks"
        description="Operational playbooks for incidents, treasury, settlement, maintenance, migrations and security."
      />

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/ops/runbooks"
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
            !category
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-border bg-card/50 text-muted-foreground hover:bg-emerald-500/5'
          }`}
        >
          All ({runbooks.length})
        </Link>
        {CATEGORIES.map((cat) => {
          const count = byCategory.get(cat)?.length ?? 0;
          return (
            <Link
              key={cat}
              href={`/ops/runbooks?category=${cat}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition ${
                category === cat
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-border bg-card/50 text-muted-foreground hover:bg-emerald-500/5'
              }`}
            >
              {cat} ({count})
            </Link>
          );
        })}
      </div>

      {runbooks.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<ScrollText className="h-6 w-6" />}
              title="No runbooks"
              description="No runbooks match the current filter."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {runbooks.map((rb) => (
            <RunbookCard key={rb.id} runbook={rb} />
          ))}
        </div>
      )}

      {/* Most recent edits */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recently updated</CardTitle>
          <CardDescription>Runbook edit history</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {[...runbooks]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .slice(0, 8)
              .map((rb) => (
                <Link
                  key={rb.id}
                  href={`/ops/runbooks/${rb.id}`}
                  className="flex items-center justify-between rounded-lg border bg-card/50 p-3 transition hover:border-emerald-500/40 hover:bg-emerald-500/5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {rb.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      v{rb.version} · updated {fmtDate(new Date(rb.updatedAt))}
                    </div>
                  </div>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </Link>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
