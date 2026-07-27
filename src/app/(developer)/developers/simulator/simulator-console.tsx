'use client';

import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  SkipForward,
  Cpu,
  GitBranch,
  ArrowRight,
  Zap,
  Shield,
  TrendingUp,
  Clock,
  Activity,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';

interface Scenario {
  id: string;
  label: string;
  description: string;
  category: string;
}

interface TimelineStep {
  name: string;
  description: string;
  status: 'success' | 'blocked' | 'skipped' | 'failed' | 'pending';
  detail?: string;
  frame?: number;
}

interface EventItem {
  id: string;
  type: string;
  aggregate: string;
  version: number;
  frame: number;
  ts: number;
  latencyMs: number;
  payload: Record<string, unknown>;
}

interface LedgerImpact {
  before: { account: string; balance: number; currency?: string }[];
  after: { account: string; balance: number; currency?: string; delta: number }[];
  entries: {
    id: string;
    accountId: string;
    accountLabel: string;
    currency: string;
    debit: number;
    credit: number;
    balanceAfter: number;
    memo: string;
    frame: number;
  }[];
}

interface Decision {
  step: string;
  rationale: string;
  policy: { passed: boolean; findings: { policy: string; severity: string; detail: string }[] };
  alternatives: {
    label: string;
    reason: string;
    weightedScore: number;
    costPercent: number;
    settlementTimeMs: number;
    riskScore: number;
  }[];
  constitution: { section: string; passed: boolean; checks: { invariant: string; passed: boolean; detail: string }[] }[];
  council: { strategy: string; weightedScore: number; objectiveScores: { objective: string; score: number; rationale: string }[] };
  expectedRoi: { costPercent: number; settlementTimeMs: number; confidence: number };
  risk: { score: number; label: string };
  approvalLevel: string;
}

interface RunResult {
  runId: string;
  kernelVersion: string;
  settled: boolean;
  scenarioId: string;
  scenarioLabel: string;
  timeline: TimelineStep[];
  events: EventItem[];
  ledger: LedgerImpact;
  decisions: Decision[];
  metrics: {
    costPercent: number;
    settlementTimeMs: number;
    settlementTimeLabel: string;
    riskScore: number;
    riskLabel: string;
    confidence: number;
    totalFees: number;
    fxRate: number;
  };
  amendments: { description: string; reason: string; recoveryStrategy: string; insertedAtFrame: number }[];
  twinTokens: { symbol: string; amount: number; currency: string; status: string }[];
  resultHash: string;
}

interface Props {
  scenarios: Scenario[];
}

const STATUS_ICON: Record<TimelineStep['status'], React.ReactNode> = {
  success: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
  blocked: <XCircle className="h-3.5 w-3.5 text-rose-500" />,
  failed: <XCircle className="h-3.5 w-3.5 text-rose-500" />,
  skipped: <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />,
  pending: <Clock className="h-3.5 w-3.5 text-amber-500" />,
};

export function SimulatorConsole({ scenarios }: Props) {
  const [scenarioId, setScenarioId] = React.useState<string>(
    scenarios[0]?.id ?? '',
  );
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<RunResult | null>(null);
  const [expandedDecision, setExpandedDecision] = React.useState<number | null>(0);

  async function handleRun() {
    if (!scenarioId) {
      toast.error('Select a scenario first');
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/developer/simulator/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Simulation failed');
      }
      setResult(data.run);
      toast.success(`Scenario "${data.run.scenarioLabel}" executed`, {
        description: data.run.settled ? 'Payment settled successfully' : 'Payment blocked by kernel',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Scenario picker */}
      <Card className="border-emerald-500/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4 text-emerald-500" />
            Scenario runner
          </CardTitle>
          <CardDescription>
            Pick a pre-built scenario and run it through the same kernel pipeline production uses.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Scenario
              </label>
              <Select value={scenarioId} onValueChange={setScenarioId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a scenario" />
                </SelectTrigger>
                <SelectContent>
                  {scenarios.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="font-medium">{s.label}</span>
                      <span className="ml-2 text-[10px] text-muted-foreground">({s.category})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Description
              </label>
              <div className="rounded-md border bg-card/50 p-3 text-xs text-muted-foreground">
                {scenarios.find((s) => s.id === scenarioId)?.description ?? '—'}
              </div>
            </div>
          </div>
          <Button
            onClick={handleRun}
            disabled={running || !scenarioId}
            className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white sm:w-auto"
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running through kernel…
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Run scenario
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <>
          {/* Verdict */}
          <Card className={result.settled ? 'border-emerald-500/30' : 'border-rose-500/30'}>
            <CardContent className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {result.settled ? (
                    <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                  ) : (
                    <XCircle className="h-8 w-8 text-rose-500" />
                  )}
                  <div>
                    <div className="text-lg font-bold">
                      {result.settled ? 'SETTLED' : 'BLOCKED'}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      run {result.runId.slice(0, 24)} · {result.scenarioLabel}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Kernel version</div>
                  <div className="text-sm font-mono">{result.kernelVersion}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Metrics */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium uppercase text-muted-foreground">Cost</span>
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                </div>
                <div className="mt-1 text-xl font-bold tabular-nums">{result.metrics.costPercent}%</div>
                <div className="text-[10px] text-muted-foreground">
                  {result.metrics.totalFees.toFixed(2)} fees
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium uppercase text-muted-foreground">Settlement time</span>
                  <Clock className="h-3.5 w-3.5 text-teal-500" />
                </div>
                <div className="mt-1 text-xl font-bold">{result.metrics.settlementTimeLabel}</div>
                <div className="text-[10px] text-muted-foreground">{result.metrics.settlementTimeMs}ms</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium uppercase text-muted-foreground">Risk</span>
                  <Shield className="h-3.5 w-3.5 text-amber-500" />
                </div>
                <div className="mt-1 text-xl font-bold tabular-nums">{result.metrics.riskScore.toFixed(2)}</div>
                <div className="text-[10px] text-muted-foreground">{result.metrics.riskLabel}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium uppercase text-muted-foreground">Confidence</span>
                  <Zap className="h-3.5 w-3.5 text-emerald-500" />
                </div>
                <div className="mt-1 text-xl font-bold tabular-nums">{result.metrics.confidence}%</div>
              </CardContent>
            </Card>
          </div>

          {/* Tabs: Timeline / Events / Ledger / Decisions */}
          <Tabs defaultValue="timeline">
            <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="events">Events ({result.events.length})</TabsTrigger>
              <TabsTrigger value="ledger">Ledger ({result.ledger.entries.length})</TabsTrigger>
              <TabsTrigger value="decisions">Decisions ({result.decisions.length})</TabsTrigger>
            </TabsList>

            {/* Timeline */}
            <TabsContent value="timeline">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <GitBranch className="h-4 w-4 text-teal-500" /> Pipeline timeline
                  </CardTitle>
                  <CardDescription>
                    Intent → Compiler → Policy → Council → Constitution → Coordinator → Treasury → Settlement → Marketplace → Ledger → Events → Projections
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ol className="relative space-y-1">
                    {result.timeline.map((step, idx) => (
                      <li
                        key={`${step.name}-${idx}`}
                        className="flex items-start gap-3 rounded-lg border bg-card/50 p-3"
                      >
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums">
                          {idx + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {STATUS_ICON[step.status]}
                            <span className="text-sm font-semibold">{step.name}</span>
                            <Badge variant="outline" className="text-[9px] capitalize">
                              {step.status}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
                          {step.detail && (
                            <pre className="mt-1.5 whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-[10px] leading-relaxed text-muted-foreground">
                              {step.detail}
                            </pre>
                          )}
                        </div>
                        {idx < result.timeline.length - 1 && (
                          <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                        )}
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Events */}
            <TabsContent value="events">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Activity className="h-4 w-4 text-emerald-500" /> Event stream
                  </CardTitle>
                  <CardDescription>
                    Every event emitted, with sequence number, aggregate, version, latency
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {result.events.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No events emitted.
                    </div>
                  ) : (
                    <ScrollArea className="max-h-[480px]">
                      <ul className="space-y-1">
                        {result.events.map((evt) => (
                          <li
                            key={evt.id}
                            className="flex items-center gap-2 rounded border bg-card/50 p-2 text-xs font-mono"
                          >
                            <span className="w-8 shrink-0 text-[10px] text-muted-foreground">
                              #{evt.version}
                            </span>
                            <span className="w-12 shrink-0 text-[10px] text-muted-foreground">
                              f{evt.frame}
                            </span>
                            <Badge variant="outline" className="shrink-0 text-[9px]">
                              {evt.type.split('.')[0]}
                            </Badge>
                            <span className="min-w-0 flex-1 truncate">{evt.type}</span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              agg: {evt.aggregate.slice(0, 16)}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {evt.latencyMs}ms
                            </span>
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Ledger */}
            <TabsContent value="ledger">
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Before</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {result.ledger.before.length === 0 ? (
                        <div className="text-xs text-muted-foreground">No prior balances.</div>
                      ) : (
                        <ul className="space-y-1 text-xs">
                          {result.ledger.before.map((b, i) => (
                            <li key={`${b.account}-${i}`} className="flex items-center justify-between font-mono">
                              <span className="truncate">{b.account}</span>
                              <span className="tabular-nums">
                                {b.balance.toFixed(2)} {b.currency ?? ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">After</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {result.ledger.after.length === 0 ? (
                        <div className="text-xs text-muted-foreground">No balances affected.</div>
                      ) : (
                        <ul className="space-y-1 text-xs">
                          {result.ledger.after.map((a, i) => (
                            <li key={`${a.account}-${i}`} className="flex items-center justify-between font-mono">
                              <span className="truncate">{a.account}</span>
                              <span className="flex items-center gap-2 tabular-nums">
                                <span>
                                  {a.balance.toFixed(2)} {a.currency ?? ''}
                                </span>
                                <span
                                  className={`text-[10px] ${
                                    a.delta > 0
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : a.delta < 0
                                        ? 'text-rose-600 dark:text-rose-400'
                                        : 'text-muted-foreground'
                                  }`}
                                >
                                  ({a.delta > 0 ? '+' : ''}
                                  {a.delta.toFixed(2)})
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Ledger entries ({result.ledger.entries.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="max-h-80">
                      <div className="space-y-1">
                        {result.ledger.entries.map((entry) => (
                          <div
                            key={entry.id}
                            className="flex items-center gap-2 rounded border p-2 text-xs font-mono"
                          >
                            <span className="w-8 shrink-0 text-[10px] text-muted-foreground">
                              f{entry.frame}
                            </span>
                            <span className="flex-1 truncate">{entry.accountLabel}</span>
                            {entry.debit > 0 && (
                              <Badge variant="outline" className="text-emerald-600 border-emerald-500/30">
                                DR {entry.debit.toFixed(2)}
                              </Badge>
                            )}
                            {entry.credit > 0 && (
                              <Badge variant="outline" className="text-rose-600 border-rose-500/30">
                                CR {entry.credit.toFixed(2)}
                              </Badge>
                            )}
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              Bal: {entry.balanceAfter.toFixed(2)} {entry.currency}
                            </span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                {/* Twin tokens + amendments */}
                {(result.twinTokens.length > 0 || result.amendments.length > 0) && (
                  <div className="grid gap-4 md:grid-cols-2">
                    {result.twinTokens.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-sm">Twin tokens ({result.twinTokens.length})</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {result.twinTokens.map((tt, i) => (
                              <div key={i} className="flex items-center gap-3 rounded border p-2 text-sm">
                                <Badge variant="outline" className="font-mono">
                                  {tt.symbol}
                                </Badge>
                                <span className="font-semibold tabular-nums">{tt.amount}</span>
                                <span className="text-muted-foreground">{tt.currency}</span>
                                <Badge variant={tt.status === 'minted' ? 'default' : 'secondary'} className="ml-auto text-[10px]">
                                  {tt.status}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                    {result.amendments.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-sm">
                            <AlertTriangle className="h-4 w-4 text-amber-500" /> Plan amendments ({result.amendments.length})
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {result.amendments.map((a, i) => (
                              <div key={i} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs">
                                <div className="font-medium">{a.description}</div>
                                <div className="text-muted-foreground mt-0.5">{a.reason}</div>
                                <div className="text-[10px] text-muted-foreground mt-1">
                                  Recovery: {a.recoveryStrategy} · inserted at frame {a.insertedAtFrame}
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Decisions */}
            <TabsContent value="decisions">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Activity className="h-4 w-4 text-violet-500" /> Decision inspector
                  </CardTitle>
                  <CardDescription>
                    Each decision with reason, alternatives, confidence, policy & constitution checks, council vote, expected ROI, risk, approval level
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {result.decisions.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No decisions recorded.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {result.decisions.map((d, idx) => {
                        const expanded = expandedDecision === idx;
                        return (
                          <li key={idx} className="rounded-lg border bg-card/50">
                            <button
                              type="button"
                              onClick={() => setExpandedDecision(expanded ? null : idx)}
                              className="flex w-full items-center gap-2 p-3 text-left"
                            >
                              <ChevronRight
                                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                                  expanded ? 'rotate-90' : ''
                                }`}
                              />
                              <span className="text-sm font-semibold">{d.step}</span>
                              <span className="ml-auto flex items-center gap-2">
                                <Badge variant="outline" className="text-[9px] capitalize">
                                  {d.approvalLevel.replace('_', ' ')}
                                </Badge>
                                <Badge
                                  variant="secondary"
                                  className={`text-[9px] ${
                                    d.policy.passed
                                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                      : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                                  }`}
                                >
                                  {d.policy.passed ? 'policy passed' : 'policy blocked'}
                                </Badge>
                              </span>
                            </button>
                            {expanded && (
                              <div className="space-y-3 border-t p-3 text-xs">
                                <div>
                                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Rationale
                                  </div>
                                  <p className="mt-1">{d.rationale}</p>
                                </div>

                                <Separator />

                                <div className="grid gap-3 sm:grid-cols-3">
                                  <div>
                                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Expected ROI
                                    </div>
                                    <div className="mt-1 space-y-0.5 font-mono text-[11px]">
                                      <div>Cost: {d.expectedRoi.costPercent}%</div>
                                      <div>Time: {d.expectedRoi.settlementTimeMs}ms</div>
                                      <div>Confidence: {d.expectedRoi.confidence}%</div>
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Risk
                                    </div>
                                    <div className="mt-1 space-y-0.5 font-mono text-[11px]">
                                      <div>Score: {d.risk.score.toFixed(2)}</div>
                                      <div>Label: {d.risk.label}</div>
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Council vote
                                    </div>
                                    <div className="mt-1 space-y-0.5 font-mono text-[11px]">
                                      <div>Strategy: {d.council.strategy}</div>
                                      <div>Score: {(d.council.weightedScore * 100).toFixed(1)}%</div>
                                    </div>
                                  </div>
                                </div>

                                <Separator />

                                {d.council.objectiveScores.length > 0 && (
                                  <div>
                                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Objective scores
                                    </div>
                                    <ul className="mt-1 space-y-0.5">
                                      {d.council.objectiveScores.map((o, i) => (
                                        <li key={i} className="text-[11px]">
                                          <span className="font-mono">{o.objective}:</span>{' '}
                                          <span className="font-semibold tabular-nums">{(o.score * 100).toFixed(0)}%</span>{' '}
                                          <span className="text-muted-foreground">— {o.rationale}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {d.alternatives.length > 0 && (
                                  <>
                                    <Separator />
                                    <div>
                                      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Alternatives considered
                                      </div>
                                      <ul className="mt-1 space-y-1">
                                        {d.alternatives.map((a, i) => (
                                          <li
                                            key={i}
                                            className="rounded border bg-card/50 p-2 text-[11px]"
                                          >
                                            <div className="flex items-center justify-between">
                                              <span className="font-semibold">{a.label}</span>
                                              <span className="text-muted-foreground">
                                                score {(a.weightedScore * 100).toFixed(1)}%
                                              </span>
                                            </div>
                                            <div className="mt-0.5 text-muted-foreground">{a.reason}</div>
                                            <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                                              cost {a.costPercent}% · time {a.settlementTimeMs}ms · risk{' '}
                                              {a.riskScore.toFixed(2)}
                                            </div>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  </>
                                )}

                                {d.policy.findings.length > 0 && (
                                  <>
                                    <Separator />
                                    <div>
                                      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Policy findings
                                      </div>
                                      <ul className="mt-1 space-y-1">
                                        {d.policy.findings.map((f, i) => (
                                          <li key={i} className="text-[11px]">
                                            <Badge
                                              variant="secondary"
                                              className={`mr-2 text-[9px] ${
                                                f.severity === 'block'
                                                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                                                  : f.severity === 'warn'
                                                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                                    : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                              }`}
                                            >
                                              {f.severity}
                                            </Badge>
                                            <span className="font-mono">{f.policy}:</span>{' '}
                                            <span className="text-muted-foreground">{f.detail}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  </>
                                )}

                                {d.constitution.length > 0 && (
                                  <>
                                    <Separator />
                                    <div>
                                      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Constitution checks
                                      </div>
                                      <ul className="mt-1 space-y-1">
                                        {d.constitution.map((c, i) => (
                                          <li key={i} className="text-[11px]">
                                            <div className="flex items-center gap-2">
                                              {c.passed ? (
                                                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                              ) : (
                                                <XCircle className="h-3 w-3 text-rose-500" />
                                              )}
                                              <span className="font-semibold">{c.section}</span>
                                            </div>
                                            <ul className="ml-5 mt-0.5 space-y-0.5 text-muted-foreground">
                                              {c.checks.map((chk, j) => (
                                                <li key={j}>
                                                  {chk.passed ? '✓' : '✗'} {chk.invariant} — {chk.detail}
                                                </li>
                                              ))}
                                            </ul>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                )}
              </CardContent>
            </Card>
            </TabsContent>
          </Tabs>

          {/* Result hash */}
          <div className="text-center text-xs text-muted-foreground font-mono">
            Result hash: {result.resultHash}
          </div>
        </>
      )}
    </div>
  );
}
