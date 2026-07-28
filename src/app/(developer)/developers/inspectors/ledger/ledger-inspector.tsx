'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Landmark, Loader2, CheckCircle2, XCircle, Search } from 'lucide-react';

interface BalanceSheetView {
  assets: {
    fiatReserves: number;
    stablecoinReserves: number;
    escrow: number;
    receivables: number;
    treasuryInventory: number;
    outstandingLPAdvances: number;
    totalAssets: number;
  };
  liabilities: {
    twinTokensOutstanding: number;
    pendingSettlements: number;
    pendingRedemptions: number;
    lpRewards: number;
    treasuryObligations: number;
    totalLiabilities: number;
  };
  equity: {
    retainedEarnings: number;
    feesCollected: number;
    treasuryProfit: number;
    fxGainLoss: number;
    lpIncentiveExpense: number;
    totalEquity: number;
  };
  isBalanced: boolean;
  imbalance: number;
  generatedAt: number;
}

interface SolvencyView {
  reserveCoverage: number;
  twinCoverage: number;
  stablecoinCoverage: number;
  escrowCoverage: number;
  settlementExposure: number;
  lpExposure: number;
  countryExposure: Record<string, number>;
  networkSolvent: boolean;
  solvencyRatio: number;
}

interface ProofOfReservesView {
  fiatReserves: Record<string, number>;
  stablecoinReserves: Record<string, number>;
  totalFiat: number;
  totalStablecoins: number;
  totalReserves: number;
}

interface ProofOfTwinTokensView {
  twinTokenSupply: Record<string, number>;
  totalSupply: number;
  backedByFiat: number;
  backedByStablecoins: number;
  totalBacking: number;
  backingRatio: number;
  isFullyBacked: boolean;
}

interface JournalEntryView {
  entryId: string;
  eventId: string;
  timestamp: number;
  description: string;
  debits: Array<{ account: string; amount: number; description: string }>;
  credits: Array<{ account: string; amount: number; description: string }>;
  isBalanced: boolean;
}

interface LPLedgerView {
  lpId: string;
  capitalDeposited: number;
  bandwidth: number;
  escrow: number;
  feesEarned: number;
  slashed: number;
  currentExposure: number;
  netPosition: number;
}

interface AccountView {
  id: string;
  kind: string;
  ownerId: string;
  currency: string;
  availableBalance: number;
  reservedBalance: number;
  totalBalance: number;
  reference: string | null;
  isActive: boolean;
  createdAt: string;
  lastUpdated: string;
}

interface LedgerResponse {
  ok: boolean;
  balanceSheet?: BalanceSheetView;
  solvency?: SolvencyView;
  proofOfReserves?: ProofOfReservesView;
  proofOfTwinTokens?: ProofOfTwinTokensView;
  journalEntries?: JournalEntryView[];
  lpLedgers?: LPLedgerView[];
  treasuryLedger?: Record<string, number>;
  accounts?: AccountView[];
  currencies?: string[];
  stats?: {
    totalAccounts: number;
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    isBalanced: boolean;
    imbalance: number;
    networkSolvent: boolean;
    solvencyRatio: number;
  };
  error?: string;
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function kindColor(kind: string): string {
  switch (kind) {
    case 'reserve': return 'bg-violet-500/15 text-violet-600 dark:text-violet-400';
    case 'treasury': return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    case 'lp_position': return 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400';
    case 'fx_inventory': return 'bg-teal-500/15 text-teal-600 dark:text-teal-400';
    case 'settlement': return 'bg-orange-500/15 text-orange-600 dark:text-orange-400';
    default: return 'bg-muted text-muted-foreground';
  }
}

export function LedgerInspector() {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/developer/inspectors/ledger', { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as LedgerResponse;
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

  const bs = data?.balanceSheet;
  const solvency = data?.solvency;
  const proofReserves = data?.proofOfReserves;
  const proofTwin = data?.proofOfTwinTokens;
  const journal = data?.journalEntries ?? [];
  const lpLedgers = data?.lpLedgers ?? [];
  const accounts = data?.accounts ?? [];
  const currencies = data?.currencies ?? [];
  const treasuryLedger = data?.treasuryLedger;

  const filteredAccounts = useMemo(() => {
    let out = accounts;
    if (currencyFilter !== 'all') {
      out = out.filter((a) => a.currency === currencyFilter);
    }
    if (accountFilter.trim()) {
      const q = accountFilter.toLowerCase();
      out = out.filter((a) =>
        a.id.toLowerCase().includes(q) ||
        a.ownerId.toLowerCase().includes(q) ||
        (a.reference ?? '').toLowerCase().includes(q) ||
        a.kind.toLowerCase().includes(q),
      );
    }
    return out;
  }, [accounts, accountFilter, currencyFilter]);

  return (
    <div className="space-y-6">
      {/* Balance sheet summary */}
      {bs && (
        <Card className={bs.isBalanced ? 'border-emerald-500/40' : 'border-rose-500/40'}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Landmark className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <CardTitle className="text-base">Balance Sheet</CardTitle>
              </div>
              {bs.isBalanced ? (
                <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> balanced
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-rose-500/15 text-rose-600 dark:text-rose-400">
                  <XCircle className="mr-1 h-3 w-3" /> imbalanced ({fmtNum(bs.imbalance)})
                </Badge>
              )}
            </div>
            <CardDescription>
              The fundamental accounting identity: Assets = Liabilities + Equity. Verified after every event.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border bg-card/50 p-4">
                <div className="text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Assets</div>
                <div className="mt-2 space-y-1 text-xs">
                  <Row label="Fiat reserves" value={fmtNum(bs.assets.fiatReserves)} />
                  <Row label="Stablecoin reserves" value={fmtNum(bs.assets.stablecoinReserves)} />
                  <Row label="Escrow" value={fmtNum(bs.assets.escrow)} />
                  <Row label="Treasury inventory" value={fmtNum(bs.assets.treasuryInventory)} />
                  <Row label="LP advances" value={fmtNum(bs.assets.outstandingLPAdvances)} />
                  <Row label="Receivables" value={fmtNum(bs.assets.receivables)} />
                  <div className="mt-2 border-t pt-1.5">
                    <Row label="Total" value={fmtNum(bs.assets.totalAssets)} bold />
                  </div>
                </div>
              </div>
              <div className="rounded-lg border bg-card/50 p-4">
                <div className="text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">Liabilities</div>
                <div className="mt-2 space-y-1 text-xs">
                  <Row label="Twin tokens outstanding" value={fmtNum(bs.liabilities.twinTokensOutstanding)} />
                  <Row label="Pending settlements" value={fmtNum(bs.liabilities.pendingSettlements)} />
                  <Row label="Pending redemptions" value={fmtNum(bs.liabilities.pendingRedemptions)} />
                  <Row label="LP rewards" value={fmtNum(bs.liabilities.lpRewards)} />
                  <Row label="Treasury obligations" value={fmtNum(bs.liabilities.treasuryObligations)} />
                  <div className="mt-2 border-t pt-1.5">
                    <Row label="Total" value={fmtNum(bs.liabilities.totalLiabilities)} bold />
                  </div>
                </div>
              </div>
              <div className="rounded-lg border bg-card/50 p-4">
                <div className="text-[10px] font-medium uppercase tracking-wide text-cyan-600 dark:text-cyan-400">Equity</div>
                <div className="mt-2 space-y-1 text-xs">
                  <Row label="Retained earnings" value={fmtNum(bs.equity.retainedEarnings)} />
                  <Row label="Fees collected" value={fmtNum(bs.equity.feesCollected)} />
                  <Row label="Treasury profit" value={fmtNum(bs.equity.treasuryProfit)} />
                  <Row label="FX gain/loss" value={fmtNum(bs.equity.fxGainLoss)} />
                  <Row label="LP incentive expense" value={fmtNum(bs.equity.lpIncentiveExpense)} />
                  <div className="mt-2 border-t pt-1.5">
                    <Row label="Total" value={fmtNum(bs.equity.totalEquity)} bold />
                  </div>
                </div>
              </div>
            </div>

            {solvency && (
              <div className="mt-4 grid gap-2 sm:grid-cols-4">
                <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Solvency ratio</div>
                  <div className={`mt-0.5 font-mono text-sm font-bold ${solvency.networkSolvent ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {fmtPct(solvency.solvencyRatio)}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Twin coverage</div>
                  <div className={`mt-0.5 font-mono text-sm font-bold ${solvency.twinCoverage >= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {fmtPct(solvency.twinCoverage)}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Reserve coverage</div>
                  <div className="mt-0.5 font-mono text-sm font-bold">
                    {fmtPct(solvency.reserveCoverage)}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Network solvent</div>
                  <div className={`mt-0.5 font-mono text-sm font-bold ${solvency.networkSolvent ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {solvency.networkSolvent ? 'YES' : 'NO'}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void fetchData()} disabled={loading}>
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Landmark className="mr-1.5 h-3.5 w-3.5" />}
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

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Accounts ({accounts.length})</TabsTrigger>
          <TabsTrigger value="journal">Journal Entries ({journal.length})</TabsTrigger>
          <TabsTrigger value="reserves">Proof of Reserves</TabsTrigger>
          <TabsTrigger value="twin">Proof of Twin Tokens</TabsTrigger>
          <TabsTrigger value="lp">LP Ledgers ({lpLedgers.length})</TabsTrigger>
        </TabsList>

        {/* Accounts */}
        <TabsContent value="accounts">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Treasury accounts</CardTitle>
              <CardDescription>The 5 account types: reserve, treasury, lp_position, fx_inventory, settlement.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Filter</label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="id, owner, reference, kind"
                      value={accountFilter}
                      onChange={(e) => setAccountFilter(e.target.value)}
                      className="pl-8 text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Currency</label>
                  <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All currencies</SelectItem>
                      {currencies.map((c) => (
                        <SelectItem key={c} value={c} className="font-mono text-xs">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end text-[10px] text-muted-foreground">
                  Showing {filteredAccounts.length} of {accounts.length} accounts.
                </div>
              </div>

              <ScrollArea className="max-h-[60vh]">
                <div className="min-w-[900px]">
                  <div className="grid grid-cols-[220px_100px_180px_80px_120px_120px_120px_120px] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <div>Account ID</div>
                    <div>Kind</div>
                    <div>Owner</div>
                    <div>Currency</div>
                    <div>Available</div>
                    <div>Reserved</div>
                    <div>Total</div>
                    <div>Reference</div>
                  </div>
                  {filteredAccounts.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No accounts match the filter.
                    </div>
                  ) : (
                    filteredAccounts.map((a) => (
                      <div
                        key={a.id}
                        className="grid grid-cols-[220px_100px_180px_80px_120px_120px_120px_120px] gap-2 border-b px-4 py-1.5 text-xs last:border-b-0"
                      >
                        <div className="truncate font-mono text-[11px]" title={a.id}>{a.id}</div>
                        <div>
                          <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[9px] ${kindColor(a.kind)}`}>
                            {a.kind}
                          </span>
                        </div>
                        <div className="truncate font-mono text-[10px] text-muted-foreground" title={a.ownerId}>{a.ownerId}</div>
                        <div className="font-mono text-[11px]">{a.currency}</div>
                        <div className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">{fmtNum(a.availableBalance)}</div>
                        <div className="font-mono text-[11px] text-amber-600 dark:text-amber-400">{fmtNum(a.reservedBalance)}</div>
                        <div className="font-mono text-[11px] font-semibold">{fmtNum(a.totalBalance)}</div>
                        <div className="truncate font-mono text-[10px] text-muted-foreground" title={a.reference ?? ''}>{a.reference ?? '—'}</div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Journal entries */}
        <TabsContent value="journal">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Journal entries</CardTitle>
              <CardDescription>Double-entry accounting — every debit must equal every credit.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[60vh]">
                <div className="space-y-3 p-4">
                  {journal.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      No journal entries.
                    </div>
                  ) : (
                    journal.map((j) => {
                      const debitSum = j.debits.reduce((s, d) => s + d.amount, 0);
                      const creditSum = j.credits.reduce((s, c) => s + c.amount, 0);
                      return (
                        <div key={j.entryId} className="rounded-lg border bg-card/50 p-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] font-semibold">{j.entryId}</span>
                            <span className="text-xs text-muted-foreground">{j.description}</span>
                            {j.isBalanced ? (
                              <Badge variant="secondary" className="ml-auto bg-emerald-500/15 text-[9px] text-emerald-600 dark:text-emerald-400">
                                balanced
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="ml-auto bg-rose-500/15 text-[9px] text-rose-600 dark:text-rose-400">
                                imbalanced
                              </Badge>
                            )}
                          </div>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <div>
                              <div className="text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                                Debits · {fmtNum(debitSum)}
                              </div>
                              <div className="mt-1 space-y-0.5">
                                {j.debits.map((d, i) => (
                                  <div key={i} className="flex items-center justify-between text-[11px]">
                                    <span className="truncate font-mono text-muted-foreground" title={d.description}>{d.account}</span>
                                    <span className="ml-2 font-mono">{fmtNum(d.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                                Credits · {fmtNum(creditSum)}
                              </div>
                              <div className="mt-1 space-y-0.5">
                                {j.credits.map((c, i) => (
                                  <div key={i} className="flex items-center justify-between text-[11px]">
                                    <span className="truncate font-mono text-muted-foreground" title={c.description}>{c.account}</span>
                                    <span className="ml-2 font-mono">{fmtNum(c.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Proof of Reserves */}
        <TabsContent value="reserves">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Proof of reserves</CardTitle>
              <CardDescription>Reserves broken down by currency — fiat and stablecoin.</CardDescription>
            </CardHeader>
            <CardContent>
              {proofReserves ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Stat label="Total fiat reserves" value={fmtNum(proofReserves.totalFiat)} tone="emerald" />
                    <Stat label="Total stablecoin reserves" value={fmtNum(proofReserves.totalStablecoins)} tone="amber" />
                    <Stat label="Total reserves" value={fmtNum(proofReserves.totalReserves)} tone="cyan" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Fiat by currency</div>
                      <div className="mt-2 space-y-1">
                        {Object.entries(proofReserves.fiatReserves).map(([c, n]) => (
                          <div key={c} className="flex items-center justify-between rounded border bg-card/50 px-3 py-1.5 text-xs">
                            <span className="font-mono">{c}</span>
                            <span className="font-mono font-semibold">{fmtNum(n)}</span>
                          </div>
                        ))}
                        {Object.keys(proofReserves.fiatReserves).length === 0 && (
                          <div className="text-xs text-muted-foreground">No fiat reserves.</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Stablecoins by currency</div>
                      <div className="mt-2 space-y-1">
                        {Object.entries(proofReserves.stablecoinReserves).map(([c, n]) => (
                          <div key={c} className="flex items-center justify-between rounded border bg-card/50 px-3 py-1.5 text-xs">
                            <span className="font-mono">{c}</span>
                            <span className="font-mono font-semibold">{fmtNum(n)}</span>
                          </div>
                        ))}
                        {Object.keys(proofReserves.stablecoinReserves).length === 0 && (
                          <div className="text-xs text-muted-foreground">No stablecoin reserves.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No proof of reserves available.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Proof of Twin Tokens */}
        <TabsContent value="twin">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Proof of twin tokens</CardTitle>
              <CardDescription>
                Twin tokens must always be fully backed by reserves (backing ratio ≥ 1.0).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {proofTwin ? (
                <div className="space-y-4">
                  <Card className={proofTwin.isFullyBacked ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-rose-500/40 bg-rose-500/5'}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        {proofTwin.isFullyBacked ? (
                          <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <XCircle className="h-6 w-6 text-rose-600 dark:text-rose-400" />
                        )}
                        <div>
                          <div className="text-base font-semibold">
                            {proofTwin.isFullyBacked ? 'Twin tokens fully backed' : 'Twin tokens NOT fully backed'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            backing ratio: <span className="font-mono font-bold">{proofTwin.backingRatio.toFixed(4)}</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <Stat label="Total supply" value={fmtNum(proofTwin.totalSupply)} tone="cyan" />
                    <Stat label="Backed by fiat" value={fmtNum(proofTwin.backedByFiat)} tone="emerald" />
                    <Stat label="Backed by stablecoins" value={fmtNum(proofTwin.backedByStablecoins)} tone="amber" />
                  </div>

                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Supply by currency
                    </div>
                    <div className="mt-2 space-y-1">
                      {Object.entries(proofTwin.twinTokenSupply).map(([c, n]) => (
                        <div key={c} className="flex items-center justify-between rounded border bg-card/50 px-3 py-1.5 text-xs">
                          <span className="font-mono">{c}</span>
                          <span className="font-mono font-semibold">{fmtNum(n)}</span>
                        </div>
                      ))}
                      {Object.keys(proofTwin.twinTokenSupply).length === 0 && (
                        <div className="text-xs text-muted-foreground">No twin tokens minted.</div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No proof of twin tokens available.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* LP Ledgers */}
        <TabsContent value="lp">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">LP capital ledgers</CardTitle>
              <CardDescription>Per-LP balance sheet — capital, bandwidth, escrow, fees, slashes, exposure.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[60vh]">
                <div className="min-w-[900px]">
                  <div className="grid grid-cols-[180px_120px_120px_120px_120px_100px_120px_120px] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <div>LP ID</div>
                    <div>Capital</div>
                    <div>Bandwidth</div>
                    <div>Escrow</div>
                    <div>Fees earned</div>
                    <div>Slashed</div>
                    <div>Exposure</div>
                    <div>Net position</div>
                  </div>
                  {lpLedgers.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No LP ledgers. LPs appear once they register bandwidth.
                    </div>
                  ) : (
                    lpLedgers.map((l) => (
                      <div
                        key={l.lpId}
                        className="grid grid-cols-[180px_120px_120px_120px_120px_100px_120px_120px] gap-2 border-b px-4 py-1.5 text-xs last:border-b-0"
                      >
                        <div className="truncate font-mono text-[11px]" title={l.lpId}>{l.lpId}</div>
                        <div className="font-mono text-[11px]">{fmtNum(l.capitalDeposited)}</div>
                        <div className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">{fmtNum(l.bandwidth)}</div>
                        <div className="font-mono text-[11px] text-rose-600 dark:text-rose-400">{fmtNum(l.escrow)}</div>
                        <div className="font-mono text-[11px]">{fmtNum(l.feesEarned)}</div>
                        <div className="font-mono text-[11px] text-rose-600 dark:text-rose-400">{fmtNum(l.slashed)}</div>
                        <div className="font-mono text-[11px] text-amber-600 dark:text-amber-400">{fmtNum(l.currentExposure)}</div>
                        <div className={`font-mono text-[11px] font-semibold ${l.netPosition >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {fmtNum(l.netPosition)}
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

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${bold ? 'font-bold' : ''}`}>{value}</span>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'amber' | 'cyan' }) {
  const toneClass = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    cyan: 'text-cyan-600 dark:text-cyan-400',
  }[tone];
  return (
    <div className="rounded-lg border bg-card/50 p-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-xl font-bold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
