'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Scale, Loader2, ChevronRight, ChevronDown, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

interface ViolationView {
  invariantId: string;
  message: string;
  severity: 'error' | 'warning';
  lastRun: number | null;
}

interface InvariantView {
  id: string;
  description: string;
  handles: string[];
  healthy: boolean;
  lastRun: number | null;
  violationCount: number;
  recentViolations: Array<{
    invariantId: string;
    message: string;
    severity: 'error' | 'warning';
    event?: { type: string; streamId: string; globalPosition: number };
    projection?: { name: string; id: string };
    command?: { intentId: string; correlationId: string };
  }>;
}

interface ConstitutionalRule {
  ruleId: string;
  name: string;
  description: string;
  enforced: boolean;
}

interface ConstitutionResponse {
  ok: boolean;
  invariants?: InvariantView[];
  constitutionalRules?: ConstitutionalRule[];
  violations?: ViolationView[];
  stats?: {
    total: number;
    healthy: number;
    unhealthy: number;
    rulesEnforced: number;
    rulesTotal: number;
    violationsTotal: number;
    errorViolations: number;
    warningViolations: number;
  };
  error?: string;
}

function fmtTime(ts: number | null): string {
  if (ts === null) return 'never';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function severityColor(sev: 'error' | 'warning'): string {
  return sev === 'error'
    ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
}

function sectionColor(handles: string[]): string {
  if (handles.some((h) => h.startsWith('payment.'))) return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
  if (handles.some((h) => h.startsWith('reserve.'))) return 'bg-violet-500/15 text-violet-600 dark:text-violet-400';
  if (handles.some((h) => h.startsWith('wallet.'))) return 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400';
  if (handles.some((h) => h.startsWith('ledger.'))) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
  if (handles.some((h) => h.startsWith('refund.'))) return 'bg-rose-500/15 text-rose-600 dark:text-rose-400';
  return 'bg-muted text-muted-foreground';
}

function sectionLabel(handles: string[]): string {
  if (handles.length === 0) return 'general';
  return handles[0].split('.')[0];
}

export function ConstitutionInspector() {
  const [data, setData] = useState<ConstitutionResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/developer/inspectors/constitution', { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as ConstitutionResponse;
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

  const invariants = data?.invariants ?? [];
  const rules = data?.constitutionalRules ?? [];
  const violations = data?.violations ?? [];
  const stats = data?.stats;

  const grouped = useMemo(() => {
    const bySection: Record<string, InvariantView[]> = {};
    for (const inv of invariants) {
      const sec = sectionLabel(inv.handles);
      if (!bySection[sec]) bySection[sec] = [];
      bySection[sec].push(inv);
    }
    return bySection;
  }, [invariants]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <>
          <Card className={stats.unhealthy === 0 ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-rose-500/40 bg-rose-500/5'}>
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <Scale className={`h-6 w-6 ${stats.unhealthy === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`} />
                <div>
                  <div className="text-base font-semibold">
                    {stats.unhealthy === 0
                      ? 'All invariants passing — the constitution holds.'
                      : `${stats.unhealthy} invariant(s) failing — the constitution is under stress.`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {stats.healthy}/{stats.total} invariants healthy · {stats.rulesEnforced}/{stats.rulesTotal} constitutional rules enforced · {stats.violationsTotal} recent violation(s)
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Invariants</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{stats.total}</div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" /> {stats.healthy} passing
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Failing</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{stats.unhealthy}</div>
                {stats.unhealthy > 0 && (
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400">
                    <XCircle className="h-3 w-3" /> needs investigation
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Constitutional rules</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{stats.rulesEnforced}/{stats.rulesTotal}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">enforced</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Recent violations</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{stats.violationsTotal}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px]">
                  <span className="text-rose-600 dark:text-rose-400">{stats.errorViolations} errors</span>
                  <span className="text-amber-600 dark:text-amber-400">{stats.warningViolations} warnings</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void fetchData()} disabled={loading}>
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Scale className="mr-1.5 h-3.5 w-3.5" />}
          Re-verify
        </Button>
      </div>

      {error && (
        <Card className="border-rose-500/40">
          <CardContent className="p-4 text-sm text-rose-600 dark:text-rose-400">
            Error: {error}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="invariants">
        <TabsList>
          <TabsTrigger value="invariants">Invariants ({invariants.length})</TabsTrigger>
          <TabsTrigger value="rules">Constitutional Rules ({rules.length})</TabsTrigger>
          <TabsTrigger value="violations">Recent Violations ({violations.length})</TabsTrigger>
        </TabsList>

        {/* Invariants */}
        <TabsContent value="invariants">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Economic invariants</CardTitle>
              <CardDescription>
                Every event append goes through <code className="rounded bg-muted px-1 py-0.5 text-[10px]">invariants.verify()</code> — if any error-severity
                invariant fails, the append is rejected.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[70vh]">
                <div className="min-w-[900px]">
                  <div className="grid grid-cols-[160px_120px_1fr_140px_80px_40px] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <div>Section</div>
                    <div>Status</div>
                    <div>Description</div>
                    <div>Last checked</div>
                    <div>Violations</div>
                    <div />
                  </div>
                  {invariants.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No invariants registered.
                    </div>
                  ) : (
                    invariants.map((inv) => (
                      <div key={inv.id} className="border-b last:border-b-0">
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === inv.id ? null : inv.id)}
                          className="grid w-full grid-cols-[160px_120px_1fr_140px_80px_40px] items-center gap-2 px-4 py-2 text-left text-xs hover:bg-emerald-500/5"
                        >
                          <div className="flex items-center gap-1.5">
                            <Badge variant="secondary" className={`text-[9px] ${sectionColor(inv.handles)}`}>
                              {sectionLabel(inv.handles)}
                            </Badge>
                          </div>
                          <div>
                            {inv.healthy ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="h-3 w-3" /> passing
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400">
                                <XCircle className="h-3 w-3" /> failing
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[11px]" title={inv.description}>{inv.description}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{fmtTime(inv.lastRun)}</div>
                          <div className="text-center">
                            {inv.violationCount > 0 ? (
                              <Badge variant="secondary" className="bg-rose-500/15 text-[10px] text-rose-600 dark:text-rose-400">
                                {inv.violationCount}
                              </Badge>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">0</span>
                            )}
                          </div>
                          <div>
                            {expanded === inv.id ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </div>
                        </button>
                        {expanded === inv.id && (
                          <div className="bg-muted/30 px-4 py-3 text-xs">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div>
                                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Invariant ID</div>
                                <div className="font-mono text-[11px]">{inv.id}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Handles</div>
                                <div className="flex flex-wrap gap-1">
                                  {inv.handles.map((h) => (
                                    <Badge key={h} variant="secondary" className="text-[9px]">{h}</Badge>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <div className="mt-3">
                              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Recent violations</div>
                              {inv.recentViolations.length === 0 ? (
                                <div className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                                  No recent violations.
                                </div>
                              ) : (
                                <div className="mt-1 space-y-1.5">
                                  {inv.recentViolations.map((v, i) => (
                                    <div key={i} className="rounded border bg-card/50 p-2 text-[11px]">
                                      <div className="flex items-center gap-1.5">
                                        <Badge variant="secondary" className={`text-[9px] ${severityColor(v.severity)}`}>
                                          {v.severity}
                                        </Badge>
                                        <span className="text-muted-foreground">{v.message}</span>
                                      </div>
                                      {v.event && (
                                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                          event: {v.event.type} @ seq {v.event.globalPosition} ({v.event.streamId})
                                        </div>
                                      )}
                                      {v.projection && (
                                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                          projection: {v.projection.name}/{v.projection.id}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
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

        {/* Constitutional Rules */}
        <TabsContent value="rules">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Constitutional rules</CardTitle>
              <CardDescription>
                The Economic Constitution — immutable during runtime execution. No AI, operator, or director may violate these.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[70vh]">
                <div className="min-w-[700px]">
                  <div className="grid grid-cols-[200px_1fr_100px] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <div>Rule</div>
                    <div>Description</div>
                    <div>Status</div>
                  </div>
                  {rules.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No constitutional rules.
                    </div>
                  ) : (
                    rules.map((r) => (
                      <div
                        key={r.ruleId}
                        className="grid grid-cols-[200px_1fr_100px] items-center gap-2 border-b px-4 py-2 text-xs last:border-b-0"
                      >
                        <div className="font-mono text-[11px] font-semibold">{r.name}</div>
                        <div className="text-[11px] text-muted-foreground">{r.description}</div>
                        <div>
                          {r.enforced ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" /> enforced
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <AlertTriangle className="h-3 w-3" /> disabled
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Violations */}
        <TabsContent value="violations">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent violations</CardTitle>
              <CardDescription>
                All violations across all invariants (most recent first). Errors block the append; warnings are logged only.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[70vh]">
                <div className="min-w-[700px]">
                  <div className="grid grid-cols-[160px_100px_160px_1fr] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <div>Timestamp</div>
                    <div>Severity</div>
                    <div>Invariant</div>
                    <div>Message</div>
                  </div>
                  {violations.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="mx-auto mb-2 h-8 w-8 opacity-50" />
                      No recent violations. The constitution is intact.
                    </div>
                  ) : (
                    violations.map((v, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-[160px_100px_160px_1fr] gap-2 border-b px-4 py-2 text-xs last:border-b-0"
                      >
                        <div className="font-mono text-[10px] text-muted-foreground">{fmtTime(v.lastRun)}</div>
                        <div>
                          <Badge variant="secondary" className={`text-[9px] ${severityColor(v.severity)}`}>
                            {v.severity}
                          </Badge>
                        </div>
                        <div className="truncate font-mono text-[11px]" title={v.invariantId}>{v.invariantId}</div>
                        <div className="text-[11px] text-muted-foreground">{v.message}</div>
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
