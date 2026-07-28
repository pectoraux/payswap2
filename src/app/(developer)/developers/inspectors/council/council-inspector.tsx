'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Users2, Loader2, ChevronRight, ChevronDown, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface DirectorOpinionView {
  director: string;
  position: 'support' | 'neutral' | 'oppose';
  confidence: number;
  reason: string;
  expectedROI: number;
  expectedRisk: number;
  alternatives: string[];
  submittedAt: number;
}

interface CouncilDecisionView {
  decisionId: string;
  proposedBy: string;
  action: string;
  description: string;
  targetCountries: string[];
  amount?: number;
  currency?: string;
  expectedROI: number;
  expectedRisk: number;
  confidence: number;
  status: string;
  approvalClass: string;
  decidedAt: number;
  consensus: {
    outcome: string;
    weightedScore: number;
    supportWeight: number;
    opposeWeight: number;
    neutralWeight: number;
    rationale: string;
    directorWeights: Record<string, number>;
  };
  constitutionalReview: {
    passed: boolean;
    violations: string[];
  };
  opinions: DirectorOpinionView[];
}

interface DirectorAccuracyView {
  director: string;
  totalDecisions: number;
  correctDecisions: number;
  accuracyRate: number;
  weight: number;
  recentTrend: string;
}

interface CouncilMemoryView {
  memoryId: string;
  decisionId: string;
  proposal: { action: string; description: string; countries: string[] };
  consensus: string;
  outcome: string;
  actualROI?: number;
  actualRisk?: number;
  lessonsLearned: string[];
  timestamp: number;
}

interface CouncilResponse {
  ok: boolean;
  decisions?: CouncilDecisionView[];
  directorAccuracy?: DirectorAccuracyView[];
  memory?: CouncilMemoryView[];
  stats?: {
    totalProposals: number;
    accepted: number;
    acceptanceRate: number;
    avgConfidence: number;
    avgWeightedScore: number;
    activeProposals: number;
  };
  error?: string;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function positionColor(pos: DirectorOpinionView['position']): string {
  if (pos === 'support') return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
  if (pos === 'oppose') return 'bg-rose-500/15 text-rose-600 dark:text-rose-400';
  return 'bg-muted text-muted-foreground';
}

function statusColor(status: string): string {
  if (status === 'approved') return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
  if (status === 'rejected') return 'bg-rose-500/15 text-rose-600 dark:text-rose-400';
  if (status === 'requires_governance') return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
  return 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400';
}

function trendIcon(trend: string) {
  if (trend === 'improving') return <TrendingUp className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />;
  if (trend === 'declining') return <TrendingDown className="h-3 w-3 text-rose-600 dark:text-rose-400" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

export function CouncilInspector() {
  const [data, setData] = useState<CouncilResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/developer/inspectors/council', { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as CouncilResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const decisions = data?.decisions ?? [];
  const accuracy = data?.directorAccuracy ?? [];
  const memory = data?.memory ?? [];
  const stats = data?.stats;

  const sortedAccuracy = useMemo(() => {
    return [...accuracy].sort((a, b) => b.weight - a.weight);
  }, [accuracy]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Total proposals</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{stats.totalProposals}</div>
              <div className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">{stats.accepted} accepted</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Acceptance rate</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{pct(stats.acceptanceRate)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Avg confidence</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{pct(stats.avgConfidence)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Avg weighted score</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{stats.avgWeightedScore.toFixed(2)}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">[-1, +1] scale</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void fetchData()} disabled={loading}>
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Users2 className="mr-1.5 h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-rose-500/40">
          <CardContent className="p-4 text-sm text-rose-600 dark:text-rose-400">
            Error: {error}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="decisions">
        <TabsList>
          <TabsTrigger value="decisions">Decisions ({decisions.length})</TabsTrigger>
          <TabsTrigger value="directors">Directors ({accuracy.length})</TabsTrigger>
          <TabsTrigger value="memory">Memory ({memory.length})</TabsTrigger>
        </TabsList>

        {/* Decisions */}
        <TabsContent value="decisions">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Council decisions</CardTitle>
              <CardDescription>
                Each decision is a proposal that went through the council debate → consensus → constitutional review pipeline.
                Click to expand director opinions.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[70vh]">
                <div className="min-w-[900px]">
                  <div className="grid grid-cols-[160px_140px_120px_120px_100px_100px_1fr_40px] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <div>Action</div>
                    <div>Status</div>
                    <div>Score</div>
                    <div>Confidence</div>
                    <div>ROI</div>
                    <div>Risk</div>
                    <div>Decided</div>
                    <div />
                  </div>
                  {decisions.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No council decisions. The council hasn&apos;t been convened yet — refresh to convene.
                    </div>
                  ) : (
                    decisions.map((d) => (
                      <div key={d.decisionId} className="border-b last:border-b-0">
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === d.decisionId ? null : d.decisionId)}
                          className="grid w-full grid-cols-[160px_140px_120px_120px_100px_100px_1fr_40px] items-center gap-2 px-4 py-2 text-left text-xs hover:bg-emerald-500/5"
                        >
                          <div className="truncate font-mono text-[11px]" title={d.action}>{d.action}</div>
                          <div>
                            <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] ${statusColor(d.status)}`}>
                              {d.status}
                            </span>
                          </div>
                          <div className={`font-mono text-[11px] ${d.consensus.weightedScore > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {d.consensus.weightedScore.toFixed(2)}
                          </div>
                          <div className="font-mono text-[11px]">{pct(d.confidence)}</div>
                          <div className="font-mono text-[11px]">{pct(d.expectedROI)}</div>
                          <div className="font-mono text-[11px] text-amber-600 dark:text-amber-400">{pct(d.expectedRisk)}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">{fmtTime(d.decidedAt)}</div>
                          <div>
                            {expanded === d.decisionId ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </div>
                        </button>
                        {expanded === d.decisionId && (
                          <div className="space-y-3 bg-muted/30 px-4 py-3">
                            <div className="text-xs">
                              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Description</div>
                              <div className="mt-0.5">{d.description}</div>
                              {d.targetCountries.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {d.targetCountries.map((c) => (
                                    <Badge key={c} variant="secondary" className="text-[9px]">{c}</Badge>
                                  ))}
                                </div>
                              )}
                              {d.amount !== undefined && (
                                <div className="mt-1 font-mono text-[11px]">
                                  amount: {d.amount.toLocaleString()} {d.currency ?? ''}
                                </div>
                              )}
                            </div>

                            <div className="rounded border bg-card/50 p-3 text-xs">
                              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Consensus</div>
                              <div className="mt-1 font-mono text-[11px]">{d.consensus.rationale}</div>
                              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                                <div>
                                  <span className="text-muted-foreground">support: </span>
                                  <span className="font-mono text-emerald-600 dark:text-emerald-400">{d.consensus.supportWeight.toFixed(2)}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">oppose: </span>
                                  <span className="font-mono text-rose-600 dark:text-rose-400">{d.consensus.opposeWeight.toFixed(2)}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">neutral: </span>
                                  <span className="font-mono text-muted-foreground">{d.consensus.neutralWeight.toFixed(2)}</span>
                                </div>
                              </div>
                            </div>

                            <div className="rounded border bg-card/50 p-3 text-xs">
                              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Constitutional review
                              </div>
                              {d.constitutionalReview.passed ? (
                                <div className="mt-1 text-emerald-600 dark:text-emerald-400">PASSED — no violations.</div>
                              ) : (
                                <div className="mt-1 space-y-0.5">
                                  <div className="text-rose-600 dark:text-rose-400">FAILED — {d.constitutionalReview.violations.length} violation(s):</div>
                                  <ul className="ml-4 list-disc text-[11px]">
                                    {d.constitutionalReview.violations.map((v, i) => (
                                      <li key={i}>{v}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>

                            <div>
                              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Director opinions ({d.opinions.length})
                              </div>
                              <div className="mt-2 space-y-1.5">
                                {d.opinions.map((o) => (
                                  <div key={o.director} className="rounded border bg-card/50 px-3 py-2 text-xs">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-[11px] font-semibold">{o.director}</span>
                                      <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[9px] ${positionColor(o.position)}`}>
                                        {o.position}
                                      </span>
                                      <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                                        conf: {pct(o.confidence)} · roi: {pct(o.expectedROI)} · risk: {pct(o.expectedRisk)}
                                      </span>
                                    </div>
                                    <div className="mt-1 text-[11px] text-muted-foreground">{o.reason}</div>
                                    {o.alternatives.length > 0 && (
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {o.alternatives.map((a, i) => (
                                          <Badge key={i} variant="secondary" className="text-[9px]">alt: {a}</Badge>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Directors */}
        <TabsContent value="directors">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Director accuracy</CardTitle>
              <CardDescription>
                Council weights come from historical accuracy — directors who were right more often weigh more.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[70vh]">
                <div className="min-w-[700px]">
                  <div className="grid grid-cols-[120px_100px_100px_120px_100px_120px] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <div>Director</div>
                    <div>Total</div>
                    <div>Correct</div>
                    <div>Accuracy</div>
                    <div>Weight</div>
                    <div>Trend</div>
                  </div>
                  {sortedAccuracy.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No director accuracy records yet.
                    </div>
                  ) : (
                    sortedAccuracy.map((a) => (
                      <div
                        key={a.director}
                        className="grid grid-cols-[120px_100px_100px_120px_100px_120px] items-center gap-2 border-b px-4 py-2 text-xs last:border-b-0"
                      >
                        <div className="font-mono text-[11px] font-semibold">{a.director}</div>
                        <div className="font-mono text-[11px]">{a.totalDecisions}</div>
                        <div className="font-mono text-[11px]">{a.correctDecisions}</div>
                        <div className="font-mono text-[11px]">
                          <span className={a.accuracyRate >= 0.7 ? 'text-emerald-600 dark:text-emerald-400' : a.accuracyRate < 0.4 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}>
                            {pct(a.accuracyRate)}
                          </span>
                        </div>
                        <div className="font-mono text-[11px]">{a.weight.toFixed(2)}</div>
                        <div className="flex items-center gap-1.5">
                          {trendIcon(a.recentTrend)}
                          <span className="text-[10px] text-muted-foreground">{a.recentTrend}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Memory */}
        <TabsContent value="memory">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Council memory</CardTitle>
              <CardDescription>
                The council records the outcome of every decision and adjusts director weights based on accuracy.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[70vh]">
                <div className="min-w-[700px]">
                  <div className="grid grid-cols-[140px_140px_100px_1fr] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <div>Timestamp</div>
                    <div>Action</div>
                    <div>Outcome</div>
                    <div>Lessons</div>
                  </div>
                  {memory.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No memory entries. The council learns from each decision outcome.
                    </div>
                  ) : (
                    memory.map((m) => (
                      <div
                        key={m.memoryId}
                        className="grid grid-cols-[140px_140px_100px_1fr] gap-2 border-b px-4 py-2 text-xs last:border-b-0"
                      >
                        <div className="font-mono text-[11px] text-muted-foreground">{fmtTime(m.timestamp)}</div>
                        <div className="truncate font-mono text-[11px]" title={m.proposal.description}>
                          {m.proposal.action}
                        </div>
                        <div>
                          <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[9px] ${
                            m.outcome === 'success' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' :
                            m.outcome === 'failure' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' :
                            'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          }`}>
                            {m.outcome}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {m.lessonsLearned.length > 0 ? m.lessonsLearned.join(' · ') : '—'}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
