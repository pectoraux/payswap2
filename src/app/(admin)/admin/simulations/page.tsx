import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth-guards';
import { db } from '@/lib/db';
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
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { SimulationsTable } from './simulations-table';
import { History, Play, Filter, Activity } from 'lucide-react';

export const dynamic = 'force-dynamic';

const SCENARIO_FILTERS = [
  'ALL',
  'normal',
  'holiday',
  'outage',
  'growth',
  'stress',
  'custom',
] as const;

export default async function AdminSimulationsPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  const ctx = await requireAdmin().catch(() => null);
  if (!ctx) redirect('/unauthorized');
  const params = await searchParams;
  const activeScenario = params.scenario?.trim() || 'ALL';

  // Build where clause: scenarioName LIKE '%scenario%' (since it's stored as "scenario (duration)")
  const where = activeScenario === 'ALL'
    ? {}
    : { scenarioName: { contains: activeScenario } };

  const [runs, total, settledCount, last24hCount] = await Promise.all([
    db.simulationRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    db.simulationRun.count({ where }),
    db.simulationRun.count({ where: { settled: true } }),
    db.simulationRun.count({
      where: { createdAt: { gte: new Date(Date.now() - 86400000) } },
    }),
  ]);

  // Aggregate volume across all runs
  const totalVolumeAgg = await db.simulationRun.aggregate({
    _sum: { amount: true },
  });

  const fmtCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-6 w-6 text-emerald-500" />
            Simulations
          </h1>
          <p className="text-sm text-muted-foreground">
            History of every Digital Twin world simulation run.
          </p>
        </div>
        <Button asChild className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
          <Link href="/admin/runtime">
            <Play className="h-4 w-4" />
            Run New Simulation
          </Link>
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total Runs
              </span>
              <Activity className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">{total.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {last24hCount.toLocaleString()} in last 24h
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Settled
              </span>
              <History className="h-4 w-4 text-teal-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {settledCount.toLocaleString()}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              of {total.toLocaleString()} total
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Simulated Volume
              </span>
              <Activity className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {fmtCurrency(totalVolumeAgg._sum.amount || 0)}
              <span className="text-xs text-muted-foreground ml-1">GHS</span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">Across all runs</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Shown
              </span>
              <Filter className="h-4 w-4 text-cyan-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">{runs.length.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground mt-1">Latest 200</div>
          </CardContent>
        </Card>
      </div>

      {/* Filter chips */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <CardTitle className="text-base">Filter by scenario</CardTitle>
            <CardDescription className="ml-1">
              Showing {runs.length} run{runs.length === 1 ? '' : 's'} for{' '}
              <span className="font-mono text-foreground">{activeScenario}</span>
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {SCENARIO_FILTERS.map((s) => {
              const active = s === activeScenario;
              const href = s === 'ALL' ? '/admin/simulations' : `/admin/simulations?scenario=${encodeURIComponent(s)}`;
              return (
                <Link
                  key={s}
                  href={href}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'border-border text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  {s === 'ALL' ? 'All scenarios' : s.charAt(0).toUpperCase() + s.slice(1)}
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Simulations table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Simulation runs</CardTitle>
          <CardDescription>
            Click any row to inspect scenario parameters and result details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <History className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No simulation runs yet</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                {activeScenario === 'ALL'
                  ? 'Run a world simulation from the Runtime page to see history here.'
                  : `No runs match scenario "${activeScenario}". Try another filter.`}
              </p>
              <Button asChild className="mt-4 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                <Link href="/admin/runtime">
                  <Play className="h-4 w-4" />
                  Run simulation
                </Link>
              </Button>
            </div>
          ) : (
            <SimulationsTable runs={runs.map((r) => ({
              id: r.id,
              runId: r.runId,
              scenarioName: r.scenarioName,
              scenario: r.scenario,
              result: r.result,
              amount: r.amount,
              currency: r.currency,
              costPercent: r.costPercent,
              settlementMs: r.settlementMs,
              riskScore: r.riskScore,
              confidence: r.confidence,
              settled: r.settled,
              amendments: r.amendments,
              failures: r.failures,
              createdAt: r.createdAt.toISOString(),
            }))} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
