'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Loader2, Play, CheckCircle2, XCircle, AlertTriangle, TrendingUp, Activity, Gauge,
  FlaskConical, Calendar, DollarSign, Zap,
} from 'lucide-react';
import { postShowcase } from './shared';
import { RouteVisualizer } from './route-visualizer';

// ── Types (mirror the backend shapes) ──
interface SimSummary {
  totalDays: number; totalTransactions: number; totalSettled: number; totalBlocked: number; totalFailed: number;
  settlementRate: number; blockRate: number; totalVolume: number; avgDailyVolume: number; peakDailyVolume: number;
  peakDay: number; totalFeesPaid: number; avgCostPercent: number; avgLatencyMs: number;
  uniqueBlockReasons: number; topBlockReasons: Array<{ reason: string; count: number }>; growthMultiplier: number;
}
interface LiquidityAnalysis {
  startingReserves: number; startingStablecoin: number; startingLpCapacity: number;
  totalLiquidityConsumed: number; peakLiquidityDemand: number; daysWithInsufficientLiquidity: number;
  recommendedReserveBuffer: number; recommendedStablecoinBuffer: number; utilizationRate: number;
}
interface MultiYearResult {
  ok: boolean; horizon: string; summary: SimSummary; liquidityAnalysis: LiquidityAnalysis;
  invariantViolations: Array<{ day: number; type: string; detail: string }>;
  message: string;
}
interface EdgeCaseResult {
  id: string; category: string; description: string;
  expectedResult: string; actualSettled: boolean | 'error'; actualStrategy: string;
  blockReason: string | null; passed: boolean; ledgerEntries: number; eventCount: number;
  constitutionPassed: boolean; notes?: string;
}
interface EdgeCaseReport {
  ok: boolean; reportId: string; totalCases: number; passed: number; failed: number; errors: number;
  passRate: number; categories: Record<string, { total: number; passed: number; failed: number }>;
  results: EdgeCaseResult[]; findings: string[]; message: string;
}

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function StatTile({ label, value, sub, icon: Icon, color = 'emerald' }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color?: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600',
    rose: 'border-rose-500/20 bg-rose-500/5 text-rose-600',
    amber: 'border-amber-500/20 bg-amber-500/5 text-amber-600',
    sky: 'border-sky-500/20 bg-sky-500/5 text-sky-600',
    violet: 'border-violet-500/20 bg-violet-500/5 text-violet-600',
  };
  return (
    <div className={`rounded-md border p-3 ${colorMap[color] ?? colorMap.emerald}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide opacity-80">{label}</span>
        <Icon className="h-3.5 w-3.5 opacity-70" />
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] opacity-70">{sub}</div>}
    </div>
  );
}

function MultiYearCard({ horizon, result, loading, onRun }: {
  horizon: '1y' | '2y' | '3y';
  result: MultiYearResult | null;
  loading: boolean;
  onRun: () => void;
}) {
  return (
    <Card className="border-emerald-500/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-emerald-500" /> {horizon} simulation
          </CardTitle>
          <Button size="sm" className="h-7 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onRun} disabled={loading}>
            {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
            {loading ? 'Running…' : `Run ${horizon}`}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {result ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile label="Transactions" value={fmt(result.summary.totalTransactions)} icon={Activity} />
              <StatTile label="Settled" value={`${result.summary.settlementRate}%`} sub={`${result.summary.totalSettled} tx`} icon={CheckCircle2} />
              <StatTile label="Blocked" value={`${result.summary.blockRate}%`} sub={`${result.summary.totalBlocked} tx`} icon={XCircle} color="rose" />
              <StatTile label="Volume" value={fmt(result.summary.totalVolume)} sub={`peak ${fmt(result.summary.peakDailyVolume)}/day`} icon={TrendingUp} color="sky" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile label="Fees" value={fmt(result.summary.totalFeesPaid)} icon={DollarSign} color="amber" />
              <StatTile label="Avg cost" value={`${result.summary.avgCostPercent}%`} icon={Gauge} />
              <StatTile label="Growth" value={`${result.summary.growthMultiplier}x`} sub="over period" icon={Zap} color="violet" />
              <StatTile label="Violations" value={result.invariantViolations.length} sub="invariants" icon={AlertTriangle} color={result.invariantViolations.length > 0 ? 'amber' : 'emerald'} />
            </div>
            <Separator />
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Liquidity analysis</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
                  <div className="text-[10px] text-muted-foreground">Total consumed</div>
                  <div className="font-bold tabular-nums">{fmt(result.liquidityAnalysis.totalLiquidityConsumed)}</div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
                  <div className="text-[10px] text-muted-foreground">Peak demand</div>
                  <div className="font-bold tabular-nums">{fmt(result.liquidityAnalysis.peakLiquidityDemand)}</div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
                  <div className="text-[10px] text-muted-foreground">Insufficient days</div>
                  <div className="font-bold tabular-nums">{result.liquidityAnalysis.daysWithInsufficientLiquidity}</div>
                </div>
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2 text-xs">
                  <div className="text-[10px] text-muted-foreground">Rec. reserve buffer</div>
                  <div className="font-bold tabular-nums text-emerald-600">{fmt(result.liquidityAnalysis.recommendedReserveBuffer)}</div>
                </div>
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2 text-xs">
                  <div className="text-[10px] text-muted-foreground">Rec. stablecoin buffer</div>
                  <div className="font-bold tabular-nums text-emerald-600">{fmt(result.liquidityAnalysis.recommendedStablecoinBuffer)}</div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
                  <div className="text-[10px] text-muted-foreground">Utilization</div>
                  <div className="font-bold tabular-nums">{result.liquidityAnalysis.utilizationRate}%</div>
                </div>
              </div>
            </div>
            {result.summary.topBlockReasons.length > 0 && (
              <>
                <Separator />
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Top block reasons</div>
                  <div className="space-y-1">
                    {result.summary.topBlockReasons.map((r, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px]">
                        <span className="truncate text-muted-foreground">{r.reason.slice(0, 70)}</span>
                        <span className="ml-2 font-semibold tabular-nums">{r.count}x</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
            {result.invariantViolations.length > 0 && (
              <>
                <Separator />
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-600">⚠ Invariant violations ({result.invariantViolations.length})</div>
                  <ScrollArea className="max-h-32 pr-2">
                    <div className="space-y-1">
                      {result.invariantViolations.slice(0, 10).map((v, i) => (
                        <div key={i} className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[10px]">
                          <span className="font-mono text-amber-600">day {v.day} · {v.type}</span>: {v.detail.slice(0, 100)}
                        </div>
                      ))}
                      {result.invariantViolations.length > 10 && (
                        <div className="text-[10px] text-muted-foreground">+ {result.invariantViolations.length - 10} more…</div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex h-28 flex-col items-center justify-center text-center text-xs text-muted-foreground">
            <Calendar className="mb-2 h-6 w-6 opacity-30" />
            Run a {horizon} Monte Carlo simulation ({horizon === '1y' ? '365' : horizon === '2y' ? '730' : '1095'} days, {horizon === '1y' ? '~1,095' : horizon === '2y' ? '~2,190' : '~3,285'} transactions).
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EdgeCaseCard({ report, loading, onRun }: {
  report: EdgeCaseReport | null;
  loading: boolean;
  onRun: () => void;
}) {
  return (
    <Card className="border-emerald-500/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FlaskConical className="h-4 w-4 text-emerald-500" /> Edge case probe (systematic)
          </CardTitle>
          <Button size="sm" className="h-7 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onRun} disabled={loading}>
            {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
            {loading ? 'Probing…' : 'Run probe'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {report ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile label="Cases" value={report.totalCases} icon={FlaskConical} />
              <StatTile label="Passed" value={report.passed} icon={CheckCircle2} />
              <StatTile label="Failed" value={report.failed} icon={XCircle} color="rose" />
              <StatTile label="Pass rate" value={`${report.passRate}%`} icon={Gauge} color={report.passRate >= 95 ? 'emerald' : 'amber'} />
            </div>
            {report.findings.length > 0 && (
              <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-600">⚠ Findings</div>
                <ul className="space-y-1">
                  {report.findings.map((f, i) => (
                    <li key={i} className="text-[11px] leading-snug text-amber-700 dark:text-amber-300">• {f}</li>
                  ))}
                </ul>
              </div>
            )}
            <Separator />
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">By category</div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {Object.entries(report.categories).map(([cat, v]) => (
                  <div key={cat} className="rounded border border-border/60 bg-muted/20 px-2 py-1.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{cat}</span>
                      <Badge variant="outline" className={v.failed === 0 ? 'border-emerald-500/40 text-emerald-600' : 'border-amber-500/40 text-amber-600'}>
                        {v.passed}/{v.total}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {report.results.filter((r) => !r.passed).length > 0 && (
              <>
                <Separator />
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-rose-600">Failed cases</div>
                  <ScrollArea className="max-h-48 pr-2">
                    <div className="space-y-1">
                      {report.results.filter((r) => !r.passed).map((r) => (
                        <div key={r.id} className="rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1.5 text-[11px]">
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-semibold">{r.id}</span>
                            <span className="text-[10px] text-muted-foreground">{r.category}</span>
                          </div>
                          <div className="text-muted-foreground">{r.description}</div>
                          <div className="text-[10px] text-rose-500">expected {r.expectedResult}, got {String(r.actualSettled)}</div>
                          {r.notes && <div className="mt-0.5 text-[10px] text-amber-600">↳ {r.notes}</div>}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex h-28 flex-col items-center justify-center text-center text-xs text-muted-foreground">
            <FlaskConical className="mb-2 h-6 w-6 opacity-30" />
            Probes 68+ edge cases systematically — capacity boundaries, every failure type, freeze variations, negative/NaN amounts, extreme values.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SimulationTab() {
  const [sim1y, setSim1y] = useState<MultiYearResult | null>(null);
  const [sim2y, setSim2y] = useState<MultiYearResult | null>(null);
  const [sim3y, setSim3y] = useState<MultiYearResult | null>(null);
  const [loading1y, setLoading1y] = useState(false);
  const [loading2y, setLoading2y] = useState(false);
  const [loading3y, setLoading3y] = useState(false);
  const [edgeReport, setEdgeReport] = useState<EdgeCaseReport | null>(null);
  const [edgeLoading, setEdgeLoading] = useState(false);

  async function runSim(horizon: '1y' | '2y' | '3y') {
    const setLoading = horizon === '1y' ? setLoading1y : horizon === '2y' ? setLoading2y : setLoading3y;
    const setResult = horizon === '1y' ? setSim1y : horizon === '2y' ? setSim2y : setSim3y;
    setLoading(true); setResult(null);
    toast.loading(`Running ${horizon} Monte Carlo simulation…`, { id: `sim-${horizon}` });
    try {
      const r = await postShowcase<MultiYearResult>({ action: 'multiYearSim', horizon, seed: 42 });
      setResult(r);
      toast.success(`${horizon}: ${r.summary.totalTransactions} tx, ${r.summary.settlementRate}% settled, ${r.invariantViolations.length} violations.`, { id: `sim-${horizon}` });
    } catch (e) {
      toast.error(`${horizon} sim failed: ${e instanceof Error ? e.message : 'error'}`, { id: `sim-${horizon}` });
    } finally {
      setLoading(false);
    }
  }

  async function runEdge() {
    setEdgeLoading(true); setEdgeReport(null);
    toast.loading('Probing 68+ edge cases…', { id: 'edge' });
    try {
      const r = await postShowcase<EdgeCaseReport>({ action: 'edgeCaseProbe' });
      setEdgeReport(r);
      toast.success(`Edge probe: ${r.passed}/${r.totalCases} passed (${r.passRate}%), ${r.findings.length} findings.`, { id: 'edge' });
    } catch (e) {
      toast.error(`Edge probe failed: ${e instanceof Error ? e.message : 'error'}`, { id: 'edge' });
    } finally {
      setEdgeLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Visual payment routing — shows 5 candidates, 8 objectives, execution flow */}
      <RouteVisualizer />

      <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-teal-500/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Activity className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold">Multi-year simulation & edge-case probing</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Runs the kernel's Digital Twin across 1/2/3 years of simulated payment traffic (Monte Carlo with growth, seasonality, and random failure injection) plus a systematic probe of 68+ edge cases. Analyzes liquidity requirements, settlement rates, invariant violations, and technical issues.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <MultiYearCard horizon="1y" result={sim1y} loading={loading1y} onRun={() => runSim('1y')} />
        <MultiYearCard horizon="2y" result={sim2y} loading={loading2y} onRun={() => runSim('2y')} />
        <MultiYearCard horizon="3y" result={sim3y} loading={loading3y} onRun={() => runSim('3y')} />
      </div>

      <EdgeCaseCard report={edgeReport} loading={edgeLoading} onRun={runEdge} />
    </div>
  );
}
