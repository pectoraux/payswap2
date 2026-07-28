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
} from '@/components/role-ui';
import { Gauge, TrendingUp, AlertTriangle, ShieldCheck } from 'lucide-react';
import { RiskRecomputeButton } from '@/components/compliance/risk-recompute-button';
import { riskEngine } from '@/trust';

export const dynamic = 'force-dynamic';

export default async function ComplianceRiskPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string }>;
}) {
  const sp = await searchParams;
  const levelFilter = sp.level as any;

  let scores = riskEngine.listScores();
  if (levelFilter) {
    scores = scores.filter((s) => s.level === levelFilter);
  }
  scores.sort((a, b) => b.score - a.score);

  const allScores = riskEngine.listScores();
  const avg =
    allScores.length === 0
      ? 0
      : allScores.reduce((s, r) => s + r.score, 0) / allScores.length;
  const counts = {
    critical: allScores.filter((s) => s.level === 'critical').length,
    high: allScores.filter((s) => s.level === 'high').length,
    medium: allScores.filter((s) => s.level === 'medium').length,
    low: allScores.filter((s) => s.level === 'low').length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk scores"
        description="0–100 risk scores for every entity the Trust Engine has evaluated."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Critical"
          value={counts.critical}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="rose"
        />
        <KpiCard
          label="High"
          value={counts.high}
          icon={<Gauge className="h-4 w-4" />}
          tone="amber"
        />
        <KpiCard
          label="Medium"
          value={counts.medium}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Average score"
          value={avg.toFixed(1)}
          hint={`${allScores.length} entities scored`}
          icon={<ShieldCheck className="h-4 w-4" />}
          tone={avg >= 50 ? 'rose' : 'emerald'}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Entities by risk</CardTitle>
              <CardDescription>
                {scores.length} score{scores.length === 1 ? '' : 's'} recorded
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip
                href="/compliance/risk"
                label="All"
                active={!levelFilter}
              />
              <FilterChip
                href="/compliance/risk?level=critical"
                label="Critical"
                active={levelFilter === 'critical'}
              />
              <FilterChip
                href="/compliance/risk?level=high"
                label="High"
                active={levelFilter === 'high'}
              />
              <FilterChip
                href="/compliance/risk?level=medium"
                label="Medium"
                active={levelFilter === 'medium'}
              />
              <FilterChip
                href="/compliance/risk?level=low"
                label="Low"
                active={levelFilter === 'low'}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {scores.length === 0 ? (
            <EmptyState
              icon={<Gauge className="h-6 w-6" />}
              title="No risk scores yet"
              description="Run a transaction through the monitor or trigger a recompute to populate scores."
            />
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Factors</TableHead>
                    <TableHead>Computed</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scores.map((s) => (
                    <TableRow key={s.entityId}>
                      <TableCell className="font-mono text-xs">
                        {s.entityId.slice(0, 14)}
                      </TableCell>
                      <TableCell>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase">
                          {s.entityType}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums font-semibold">
                            {s.score.toFixed(1)}
                          </span>
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${
                                s.level === 'critical'
                                  ? 'bg-rose-500'
                                  : s.level === 'high'
                                  ? 'bg-amber-500'
                                  : s.level === 'medium'
                                  ? 'bg-teal-500'
                                  : 'bg-emerald-500'
                              }`}
                              style={{ width: `${s.score}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <LevelPill level={s.level} />
                      </TableCell>
                      <TableCell className="text-xs">
                        {s.factors.length} factor
                        {s.factors.length === 1 ? '' : 's'}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {s.factors.slice(0, 3).map((f) => (
                            <span
                              key={f.name}
                              className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[9px] text-muted-foreground"
                              title={f.detail}
                            >
                              {f.name} (+{f.weight})
                            </span>
                          ))}
                          {s.factors.length > 3 && (
                            <span className="text-[9px] text-muted-foreground">
                              +{s.factors.length - 3}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(s.computedAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </TableCell>
                      <TableCell>
                        <RiskRecomputeButton entityId={s.entityId} />
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

function LevelPill({ level }: { level: string }) {
  const tone =
    level === 'critical'
      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
      : level === 'high'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
      : level === 'medium'
      ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400'
      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tone}`}
    >
      {level}
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
