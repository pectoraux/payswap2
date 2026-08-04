'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Target, Play, Loader2, Sparkles, Cpu, Boxes, ChevronRight, GitBranch, AlertCircle,
} from 'lucide-react';
import {
  type ShowcaseData, type ProveResult, type ProofStepNode, postShowcase,
} from './shared';

function ProofTree({ node }: { node: ProofStepNode }) {
  const kindColor: Record<string, string> = {
    GOAL: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
    CAPABILITY: 'border-teal-500/40 bg-teal-500/5 text-teal-700 dark:text-teal-300',
    INPUT: 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300',
    SETTLEMENT: 'border-violet-500/40 bg-violet-500/5 text-violet-700 dark:text-violet-300',
  };
  return (
    <div className="space-y-1">
      <div className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${kindColor[node.kind] ?? 'border-border bg-muted'}`}>
        <Badge variant="outline" className="border-current/30 px-1.5 py-0 text-[9px] font-bold">{node.kind}</Badge>
        <span className="font-medium">
          {node.goalName ?? node.capabilityName ?? node.entityName ?? 'step'}
        </span>
        {node.entityLabel && (
          <span className="text-[10px] opacity-70">· {node.entityLabel}</span>
        )}
      </div>
      {node.children.length > 0 && (
        <div className="ml-3 space-y-1 border-l border-border/60 pl-3">
          {node.children.map((c, i) => (
            <ProofTree key={i} node={c} />
          ))}
        </div>
      )}
    </div>
  );
}

export function GraphTab({ showcase }: { showcase: ShowcaseData | null }) {
  const goals = showcase?.ekg.goals ?? [];
  const capabilities = showcase?.ekg.capabilities ?? [];
  const entities = showcase?.ekg.entities ?? [];
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const [result, setResult] = useState<ProveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runProve(goalId: string) {
    setSelectedGoal(goalId);
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await postShowcase<ProveResult>({ action: 'prove', goalId });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'prove failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Target className="h-4 w-4 text-emerald-500" />
          <h3 className="text-sm font-semibold">resolve() — graph theorem proving</h3>
          <span className="text-xs text-muted-foreground">— pick a goal, the planner proves it by backward-chaining through capabilities</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-5">
          {/* Goal picker */}
          <Card className="border-emerald-500/10 lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Select a goal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <ScrollArea className="max-h-72 pr-3">
                {goals.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => runProve(g.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                      selectedGoal === g.id ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-border/60 hover:border-emerald-500/30 hover:bg-muted/40'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{g.name}</div>
                      <div className="truncate text-[10px] text-muted-foreground">{g.targetAsset}</div>
                    </div>
                    {selectedGoal === g.id && loading ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-500" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                ))}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Proof result */}
          <Card className="border-emerald-500/10 lg:col-span-3">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4 text-emerald-500" />
                Proof
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedGoal && !loading && (
                <div className="flex h-48 flex-col items-center justify-center text-center text-xs text-muted-foreground">
                  <Target className="mb-2 h-8 w-8 opacity-30" />
                  Select a goal to run prove().
                </div>
              )}
              {loading && (
                <div className="flex h-48 flex-col items-center justify-center text-center text-xs text-muted-foreground">
                  <Loader2 className="mb-2 h-6 w-6 animate-spin text-emerald-500" />
                  Proving… backward-chaining through the capability graph.
                </div>
              )}
              {error && (
                <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600">
                  <AlertCircle className="h-4 w-4" /> {error}
                </div>
              )}
              {result && !loading && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      {result.proofCount} proof{result.proofCount === 1 ? '' : 's'}
                    </Badge>
                    {result.best && (
                      <>
                        <Badge variant="outline" className="border-border">
                          score {(result.best as { plannerScore?: number }).plannerScore ?? '—'}
                        </Badge>
                        <Badge variant="outline" className="border-border">
                          {(result.best as { capabilityCount?: number }).capabilityCount ?? 0} capabilities
                        </Badge>
                        <Badge variant="outline" className="border-border">
                          {(result.best as { entityCount?: number }).entityCount ?? 0} entities
                        </Badge>
                      </>
                    )}
                  </div>
                  {result.message && (
                    <div className="rounded-md bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                      {result.message}
                    </div>
                  )}
                  {result.proofs.length > 0 && (
                    <div>
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ranked proofs</div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {result.proofs.map((p, i) => (
                          <div key={p.id} className="rounded-md border border-border/60 bg-muted/30 p-2.5 text-[11px]">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">#{i + 1} · score {p.plannerScore}</span>
                              <span className="text-muted-foreground">{p.status}</span>
                            </div>
                            <Separator className="my-1.5" />
                            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-muted-foreground">
                              <span>cost: <span className="font-medium text-foreground">{p.totalCost}</span></span>
                              <span>latency: <span className="font-medium text-foreground">{p.totalLatencyMs}ms</span></span>
                              <span>trust: <span className="font-medium text-foreground">{p.trustScore}</span></span>
                              <span>carbon: <span className="font-medium text-foreground">{p.carbon}</span></span>
                              <span>caps: <span className="font-medium text-foreground">{p.capabilityCount}</span></span>
                              <span>success: <span className="font-medium text-foreground">{(p.predictedSuccessRate * 100).toFixed(0)}%</span></span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {result.best?.root && (
                    <div>
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Best proof — decomposition tree</div>
                      <ScrollArea className="max-h-64 pr-3">
                        <ProofTree node={result.best.root} />
                      </ScrollArea>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Capabilities + Entities */}
      <section className="grid gap-3 lg:grid-cols-2">
        <Card className="border-emerald-500/10">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Cpu className="h-4 w-4 text-emerald-500" /> Capabilities ({capabilities.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-80 pr-3">
              <div className="space-y-1.5">
                {capabilities.map((c) => (
                  <div key={c.id} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{c.name}</span>
                      <Badge variant="outline" className="border-border px-1.5 py-0 text-[9px]">{c.category}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                      {c.produces.slice(0, 3).map((a) => (
                        <span key={a} className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">+ {a}</span>
                      ))}
                      {c.requires.slice(0, 2).map((a) => (
                        <span key={a} className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-600 dark:text-amber-400">− {a}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/10">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Boxes className="h-4 w-4 text-emerald-500" /> Entities ({entities.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-80 pr-3">
              <div className="grid gap-1.5 sm:grid-cols-2">
                {entities.map((e) => (
                  <div key={e.id} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                    <div className="text-xs font-medium">{e.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {e.labels.map((l) => (
                        <span key={l} className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{l}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
