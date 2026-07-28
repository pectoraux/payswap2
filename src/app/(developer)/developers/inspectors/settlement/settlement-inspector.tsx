'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeftRight, Loader2, ChevronRight, ChevronDown } from 'lucide-react';

interface SettlementActorView {
  settlementId: string;
  workflowState: string;
  currentStep: string;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
  lpId: string | null;
  amount: number;
  currency: string;
  strategy: string;
  totalDurationMs: number;
  timeoutCount: number;
  compensationCount: number;
  timers: Array<{
    timerId: string;
    timerType: string;
    firesAt: number;
    fired: boolean;
    action: string;
  }>;
  compensationPlan: Array<{
    step: number;
    action: string;
    description: string;
    executed: boolean;
  }>;
  history: Array<{
    step: number;
    fromState: string;
    toState: string;
    event: string;
    timestamp: number;
    durationMs: number;
    success: boolean;
    reason?: string;
  }>;
}

interface SettlementContractView {
  contractId: string;
  fromCountry: string;
  toCountry: string;
  amount: number;
  currency: string;
  lpId: string | null;
  stablecoinAmount: number;
  stablecoinCurrency: string;
  status: string;
  escrowLocked: boolean;
  createdAt: number;
  fundedAt: number | null;
  claimedAt: number | null;
  confirmedAt: number | null;
  releasedAt: number | null;
  closedAt: number | null;
  expiresAt: number;
  disputeId: string | null;
}

interface BandwidthPositionView {
  owner: string;
  country: string;
  assetType: string;
  capacity: number;
  reserved: number;
  used: number;
  available: number;
  escrow: number;
  bond: number;
  status: string;
  participationMode: string;
}

interface SettlementResponse {
  ok: boolean;
  actors?: SettlementActorView[];
  contracts?: SettlementContractView[];
  bandwidthPositions?: BandwidthPositionView[];
  stats?: {
    totalActors: number;
    activeActors: number;
    totalContracts: number;
    activeContracts: number;
    bandwidthPositions: number;
    actorStatusCounts: Record<string, number>;
    contractStatusCounts: Record<string, number>;
  };
  error?: string;
}

function fmtTime(ts: number | null): string {
  if (ts === null) return '—';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function workflowColor(state: string): string {
  if (['completed', 'released'].includes(state)) return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
  if (['failed', 'expired', 'cancelled', 'compensating'].includes(state)) return 'bg-rose-500/15 text-rose-600 dark:text-rose-400';
  if (['pending', 'funding', 'marketplace'].includes(state)) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
  return 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400';
}

function contractColor(status: string): string {
  if (['closed', 'released'].includes(status)) return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
  if (['expired', 'disputed'].includes(status)) return 'bg-rose-500/15 text-rose-600 dark:text-rose-400';
  if (['created', 'funded'].includes(status)) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
  return 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400';
}

export function SettlementInspector() {
  const [data, setData] = useState<SettlementResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedActor, setExpandedActor] = useState<string | null>(null);
  const [expandedContract, setExpandedContract] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/developer/inspectors/settlement', { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as SettlementResponse;
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

  const actors = data?.actors ?? [];
  const contracts = data?.contracts ?? [];
  const bandwidth = data?.bandwidthPositions ?? [];
  const stats = data?.stats;

  const sortedActors = useMemo(() => {
    return [...actors].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [actors]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Workflow actors</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{stats.totalActors}</div>
              <div className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">{stats.activeActors} active</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Settlement contracts</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{stats.totalContracts}</div>
              <div className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">{stats.activeContracts} active</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Bandwidth positions</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{stats.bandwidthPositions}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Actor status mix</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {Object.entries(stats.actorStatusCounts).slice(0, 4).map(([s, n]) => (
                  <Badge key={s} variant="secondary" className={`text-[9px] ${workflowColor(s)}`}>
                    {s}: {n}
                  </Badge>
                ))}
                {Object.keys(stats.actorStatusCounts).length === 0 && (
                  <span className="text-[10px] text-muted-foreground">none</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void fetchData()} disabled={loading}>
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" />}
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

      <Tabs defaultValue="actors">
        <TabsList>
          <TabsTrigger value="actors">Workflow Actors ({actors.length})</TabsTrigger>
          <TabsTrigger value="contracts">Contracts ({contracts.length})</TabsTrigger>
          <TabsTrigger value="bandwidth">Bandwidth ({bandwidth.length})</TabsTrigger>
        </TabsList>

        {/* Actors */}
        <TabsContent value="actors">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Settlement workflow actors</CardTitle>
              <CardDescription>
                Each row is a durable Saga — survives crashes, restarts, retries. Click to expand its stage timeline.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[70vh]">
                <div className="min-w-[900px]">
                  <div className="grid grid-cols-[180px_120px_120px_120px_100px_120px_1fr_40px] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <div>Settlement ID</div>
                    <div>State</div>
                    <div>Step</div>
                    <div>Amount</div>
                    <div>Strategy</div>
                    <div>LP</div>
                    <div>Updated</div>
                    <div />
                  </div>
                  {sortedActors.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No settlement actors. Run a payment through the simulator to create one.
                    </div>
                  ) : (
                    sortedActors.map((a) => (
                      <div key={a.settlementId} className="border-b last:border-b-0">
                        <button
                          type="button"
                          onClick={() => setExpandedActor(expandedActor === a.settlementId ? null : a.settlementId)}
                          className="grid w-full grid-cols-[180px_120px_120px_120px_100px_120px_1fr_40px] items-center gap-2 px-4 py-2 text-left text-xs hover:bg-emerald-500/5"
                        >
                          <div className="truncate font-mono text-[11px]" title={a.settlementId}>{a.settlementId}</div>
                          <div>
                            <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] ${workflowColor(a.workflowState)}`}>
                              {a.workflowState}
                            </span>
                          </div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground" title={a.currentStep}>{a.currentStep}</div>
                          <div className="font-mono text-[11px]">{a.amount.toLocaleString()} {a.currency}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{a.strategy}</div>
                          <div className="truncate font-mono text-[10px] text-muted-foreground" title={a.lpId ?? ''}>{a.lpId ?? '—'}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">{fmtTime(a.updatedAt)}</div>
                          <div>
                            {expandedActor === a.settlementId ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </div>
                        </button>
                        {expandedActor === a.settlementId && (
                          <div className="grid gap-3 bg-muted/30 px-4 py-3 lg:grid-cols-3">
                            <div className="space-y-2 text-xs">
                              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Metrics</div>
                              <div className="space-y-0.5 font-mono text-[11px]">
                                <div><span className="text-muted-foreground">retries:</span> {a.retryCount}/{a.maxRetries}</div>
                                <div><span className="text-muted-foreground">timeouts:</span> {a.timeoutCount}</div>
                                <div><span className="text-muted-foreground">compensations:</span> {a.compensationCount}</div>
                                <div><span className="text-muted-foreground">duration:</span> {fmtDuration(a.totalDurationMs)}</div>
                                <div><span className="text-muted-foreground">created:</span> {fmtTime(a.createdAt)}</div>
                              </div>
                              <div className="mt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Compensation plan</div>
                              <div className="space-y-0.5">
                                {a.compensationPlan.map((c) => (
                                  <div key={c.step} className="flex items-center gap-1.5 text-[11px]">
                                    <Badge variant="secondary" className={`text-[9px] ${c.executed ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                                      {c.executed ? 'done' : 'pending'}
                                    </Badge>
                                    <span className="font-mono text-[10px]">{c.action}</span>
                                  </div>
                                ))}
                                {a.compensationPlan.length === 0 && (
                                  <span className="text-[10px] text-muted-foreground">No compensation plan.</span>
                                )}
                              </div>
                            </div>
                            <div className="lg:col-span-2">
                              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Stage timeline</div>
                              <ScrollArea className="max-h-64">
                                <div className="space-y-1">
                                  {a.history.map((h, idx) => (
                                    <div key={idx} className="flex items-start gap-2 rounded border bg-card/50 px-2 py-1.5 text-[11px]">
                                      <span className="mt-0.5 font-mono text-[9px] text-muted-foreground">#{h.step}</span>
                                      <div className="flex-1">
                                        <div className="flex items-center gap-1.5">
                                          <span className={`inline-block rounded px-1 py-0.5 font-mono text-[9px] ${workflowColor(h.fromState)}`}>{h.fromState}</span>
                                          <span className="text-muted-foreground">→</span>
                                          <span className={`inline-block rounded px-1 py-0.5 font-mono text-[9px] ${workflowColor(h.toState)}`}>{h.toState}</span>
                                          <span className="ml-auto font-mono text-[9px] text-muted-foreground">{fmtTime(h.timestamp)}</span>
                                        </div>
                                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                                          event: <span className="font-mono">{h.event}</span>
                                          {h.reason && <span> · {h.reason}</span>}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                  {a.history.length === 0 && (
                                    <span className="text-[10px] text-muted-foreground">No history.</span>
                                  )}
                                </div>
                              </ScrollArea>
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

        {/* Contracts */}
        <TabsContent value="contracts">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Settlement contracts</CardTitle>
              <CardDescription>
                Each contract is an escrow on the settlement rail. Click to expand its lifecycle timestamps.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[70vh]">
                <div className="min-w-[900px]">
                  <div className="grid grid-cols-[180px_80px_80px_120px_100px_120px_1fr_40px] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <div>Contract ID</div>
                    <div>From</div>
                    <div>To</div>
                    <div>Amount</div>
                    <div>Status</div>
                    <div>Escrow</div>
                    <div>Created</div>
                    <div />
                  </div>
                  {contracts.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No settlement contracts in the projection.
                    </div>
                  ) : (
                    contracts.map((c) => (
                      <div key={c.contractId} className="border-b last:border-b-0">
                        <button
                          type="button"
                          onClick={() => setExpandedContract(expandedContract === c.contractId ? null : c.contractId)}
                          className="grid w-full grid-cols-[180px_80px_80px_120px_100px_120px_1fr_40px] items-center gap-2 px-4 py-2 text-left text-xs hover:bg-emerald-500/5"
                        >
                          <div className="truncate font-mono text-[11px]" title={c.contractId}>{c.contractId}</div>
                          <div className="font-mono text-[11px]">{c.fromCountry}</div>
                          <div className="font-mono text-[11px]">{c.toCountry}</div>
                          <div className="font-mono text-[11px]">{c.amount.toLocaleString()} {c.currency}</div>
                          <div>
                            <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] ${contractColor(c.status)}`}>
                              {c.status}
                            </span>
                          </div>
                          <div>
                            {c.escrowLocked ? (
                              <Badge variant="secondary" className="bg-emerald-500/15 text-[9px] text-emerald-600 dark:text-emerald-400">locked</Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-muted text-[9px] text-muted-foreground">unlocked</Badge>
                            )}
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground">{fmtTime(c.createdAt)}</div>
                          <div>
                            {expandedContract === c.contractId ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </div>
                        </button>
                        {expandedContract === c.contractId && (
                          <div className="bg-muted/30 px-4 py-3 text-xs">
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              <Field label="LP" value={c.lpId ?? '—'} mono />
                              <Field label="Stablecoin amount" value={`${c.stablecoinAmount.toLocaleString()} ${c.stablecoinCurrency}`} mono />
                              <Field label="Dispute" value={c.disputeId ?? '—'} mono />
                              <Field label="Funded at" value={fmtTime(c.fundedAt)} />
                              <Field label="Claimed at" value={fmtTime(c.claimedAt)} />
                              <Field label="Confirmed at" value={fmtTime(c.confirmedAt)} />
                              <Field label="Released at" value={fmtTime(c.releasedAt)} />
                              <Field label="Closed at" value={fmtTime(c.closedAt)} />
                              <Field label="Expires at" value={fmtTime(c.expiresAt)} />
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

        {/* Bandwidth */}
        <TabsContent value="bandwidth">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">LP bandwidth positions</CardTitle>
              <CardDescription>
                Bandwidth is a first-class runtime asset — capacity that can be reserved, used, escrowed, and slashed.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[70vh]">
                <div className="min-w-[900px]">
                  <div className="grid grid-cols-[180px_80px_100px_100px_100px_100px_100px_100px_100px] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <div>Owner (LP)</div>
                    <div>Country</div>
                    <div>Asset</div>
                    <div>Capacity</div>
                    <div>Reserved</div>
                    <div>Used</div>
                    <div>Available</div>
                    <div>Escrow</div>
                    <div>Bond</div>
                  </div>
                  {bandwidth.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No bandwidth positions registered.
                    </div>
                  ) : (
                    bandwidth.map((b, idx) => (
                      <div
                        key={`${b.owner}-${b.country}-${b.assetType}-${idx}`}
                        className="grid grid-cols-[180px_80px_100px_100px_100px_100px_100px_100px_100px] gap-2 border-b px-4 py-1.5 text-xs last:border-b-0"
                      >
                        <div className="truncate font-mono text-[11px]" title={b.owner}>{b.owner}</div>
                        <div className="font-mono text-[11px]">{b.country}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{b.assetType}</div>
                        <div className="font-mono text-[11px]">{b.capacity.toLocaleString()}</div>
                        <div className="font-mono text-[11px] text-amber-600 dark:text-amber-400">{b.reserved.toLocaleString()}</div>
                        <div className="font-mono text-[11px]">{b.used.toLocaleString()}</div>
                        <div className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">{b.available.toLocaleString()}</div>
                        <div className="font-mono text-[11px] text-rose-600 dark:text-rose-400">{b.escrow.toLocaleString()}</div>
                        <div className="font-mono text-[11px]">{b.bond.toLocaleString()}</div>
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

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-[11px] ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
