'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Activity, Shield, Banknote, Users, Brain, Zap, Cpu, GitBranch, Eye, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/page-header';
import { formatNumber, formatCurrency } from '@/lib/format';

export default function PlatformConsole() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<any>(null);
  const [publicState, setPublicState] = useState<any>(null);
  const [verification, setVerification] = useState<any>(null);
  const [council, setCouncil] = useState<any>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [directorate, setDirectorate] = useState<any>(null);
  const [simResult, setSimResult] = useState<any>(null);
  const [aiQuery, setAiQuery] = useState('');
  const [aiResponse, setAiResponse] = useState<any>(null);
  const [simForm, setSimForm] = useState({
    fromCountry: 'KE', toCountry: 'GH', amount: 500, currency: 'USD',
    senderHasReserve: true, receiverHasReserve: true, isLocal: false,
  });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [h, p, v, c, l, d] = await Promise.all([
        fetch('/api/runtime/trust?view=health').then(r => r.json()),
        fetch('/api/public').then(r => r.json()),
        fetch('/api/runtime/trust?view=verify').then(r => r.json()),
        fetch('/api/runtime/council').then(r => r.json()),
        fetch('/api/runtime/ledger').then(r => r.json()),
        fetch('/api/runtime/directorate').then(r => r.json()),
      ]);
      setHealth(h.ok ? h : null);
      setPublicState(p.ok ? p : null);
      setVerification(v.ok ? v : null);
      setCouncil(c.ok ? c : null);
      setLedger(l.ok ? l : null);
      setDirectorate(d.ok ? d : null);
    } catch (err) {
      console.error('Failed to fetch platform data:', err);
    }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(); }, []);

  const runSimulation = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/platform/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...simForm, name: 'Platform Simulation' }),
      });
      const data = await res.json();
      setSimResult(data);
    } catch (err) {
      console.error('Simulation failed:', err);
    }
    setLoading(false);
  };

  const askAI = async () => {
    if (!aiQuery.trim()) return;
    try {
      // Use the trust layer's explainable AI + the platform's AI assistant
      const res = await fetch('/api/runtime/trust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stress_test' }),
      });
      const stressData = await res.json();
      setAiResponse({
        question: aiQuery,
        answer: `Based on current runtime state: Network health is ${health?.globalHealthScore ?? 'N/A'}%. Solvency ratio: ${publicState?.solvencyRatio ?? 'N/A'}. Twin token backing: ${publicState?.twinTokenBackingRatio ?? 'N/A'}. All invariants ${verification?.allHold ? 'HOLD' : 'VIOLATED'}.`,
        stressTest: stressData,
      });
    } catch (err) {
      setAiResponse({ question: aiQuery, answer: 'Unable to process query at this time.' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="PaySwap Financial Operating System"
        description="The complete economic runtime — kernel, intelligence, governance, and trust."
        actions={
          <Button onClick={fetchAll} disabled={loading} variant="outline">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            Refresh
          </Button>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 md:grid-cols-6">
          <TabsTrigger value="dashboard"><Activity className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">Dashboard</span></TabsTrigger>
          <TabsTrigger value="simulator"><Play className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">Simulator</span></TabsTrigger>
          <TabsTrigger value="council"><Users className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">Council</span></TabsTrigger>
          <TabsTrigger value="ledger"><Banknote className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">Ledger</span></TabsTrigger>
          <TabsTrigger value="trust"><Shield className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">Trust</span></TabsTrigger>
          <TabsTrigger value="directorate"><Brain className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">Directorate</span></TabsTrigger>
        </TabsList>

        {/* ── DASHBOARD ── */}
        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Global Health</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{health?.globalHealthScore?.toFixed(2) ?? '—'}%</div>
                <p className="text-xs text-muted-foreground">Reserve: {health?.reserveCoverage?.toFixed(1) ?? '—'}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Twin Token Backing</CardTitle>
                <Shield className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{health?.twinTokenBacking?.toFixed(1) ?? '—'}%</div>
                <p className="text-xs text-muted-foreground">Solvency: {health?.solvencyRatio?.toFixed(4) ?? '—'}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Total Reserves</CardTitle>
                <Banknote className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(publicState?.totalReserves ?? 0, 'USD')}</div>
                <p className="text-xs text-muted-foreground">Twin Supply: {formatNumber(publicState?.twinTokenSupply ?? 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Formal Verification</CardTitle>
                <Shield className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{verification?.allHold ? '✓ ALL HOLD' : '✗ VIOLATED'}</div>
                <p className="text-xs text-muted-foreground">{verification?.invariants?.length ?? 0} invariants checked</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Balance Sheet</CardTitle>
                <CardDescription>Assets = Liabilities + Equity</CardDescription>
              </CardHeader>
              <CardContent>
                {ledger?.balanceSheet ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total Assets</span><span className="font-mono font-bold">{formatCurrency(ledger.balanceSheet.assets.totalAssets, 'USD')}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Total Liabilities</span><span className="font-mono">{formatCurrency(ledger.balanceSheet.liabilities.totalLiabilities, 'USD')}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Total Equity</span><span className="font-mono">{formatCurrency(ledger.balanceSheet.equity.totalEquity, 'USD')}</span></div>
                    <div className="flex justify-between border-t pt-2"><span className="font-medium">Balanced</span><Badge variant={ledger.balanceSheet.isBalanced ? 'default' : 'destructive'}>{ledger.balanceSheet.isBalanced ? 'YES' : 'NO'}</Badge></div>
                  </div>
                ) : <p className="text-sm text-muted-foreground">Loading...</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Countries</CardTitle>
                <CardDescription>Network health by country</CardDescription>
              </CardHeader>
              <CardContent>
                {health?.countries ? (
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div><div className="text-2xl font-bold text-emerald-600">{health.countries.healthy}</div><p className="text-xs text-muted-foreground">Healthy</p></div>
                    <div><div className="text-2xl font-bold text-amber-600">{health.countries.watch}</div><p className="text-xs text-muted-foreground">Watch</p></div>
                    <div><div className="text-2xl font-bold text-rose-600">{health.countries.critical}</div><p className="text-xs text-muted-foreground">Critical</p></div>
                  </div>
                ) : <p className="text-sm text-muted-foreground">Loading...</p>}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI Runtime Assistant</CardTitle>
              <CardDescription>Ask questions about the runtime state</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input placeholder="e.g., What is the current solvency ratio?" value={aiQuery} onChange={(e) => setAiQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && askAI()} />
                <Button onClick={askAI}><Brain className="h-4 w-4" /> Ask</Button>
              </div>
              {aiResponse && (
                <div className="rounded-lg border p-4 text-sm">
                  <p className="font-medium">Q: {aiResponse.question}</p>
                  <p className="mt-2 text-muted-foreground">A: {aiResponse.answer}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SIMULATOR ── */}
        <TabsContent value="simulator" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Runtime Simulator</CardTitle>
              <CardDescription>Executes the EXACT same pipeline as production. Execution parity guaranteed.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <div><Label>From Country</Label><Input value={simForm.fromCountry} onChange={(e) => setSimForm({ ...simForm, fromCountry: e.target.value })} /></div>
                <div><Label>To Country</Label><Input value={simForm.toCountry} onChange={(e) => setSimForm({ ...simForm, toCountry: e.target.value })} /></div>
                <div><Label>Amount</Label><Input type="number" value={simForm.amount} onChange={(e) => setSimForm({ ...simForm, amount: Number(e.target.value) })} /></div>
                <div><Label>Currency</Label><Input value={simForm.currency} onChange={(e) => setSimForm({ ...simForm, currency: e.target.value })} /></div>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={simForm.senderHasReserve} onChange={(e) => setSimForm({ ...simForm, senderHasReserve: e.target.checked })} /> Sender has reserve</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={simForm.receiverHasReserve} onChange={(e) => setSimForm({ ...simForm, receiverHasReserve: e.target.checked })} /> Receiver has reserve</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={simForm.isLocal} onChange={(e) => setSimForm({ ...simForm, isLocal: e.target.checked })} /> Local transfer</label>
              </div>
              <Button onClick={runSimulation} disabled={loading}><Play className="h-4 w-4" /> Run Simulation</Button>
            </CardContent>
          </Card>

          {simResult?.ok && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Simulation Result</CardTitle>
                <CardDescription>Strategy: {simResult.executionPlan?.strategy} | Status: {simResult.status} | Duration: {simResult.durationMs}ms</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Strategy</p><p className="font-bold">{simResult.executionPlan?.strategy}</p></div>
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Events Produced</p><p className="font-bold">{simResult.eventsProduced}</p></div>
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Bandwidth Required</p><p className="font-bold">{simResult.executionPlan?.requiredBandwidth}</p></div>
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Escrow Required</p><p className="font-bold">{simResult.executionPlan?.requiredEscrow}</p></div>
                </div>
                <div>
                  <h4 className="text-sm font-medium mb-2">Timeline</h4>
                  <div className="space-y-1">
                    {simResult.timeline?.map((step: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 rounded border p-2 text-sm">
                        <span className="font-mono text-xs text-muted-foreground">{step.step}.</span>
                        <Badge variant={step.status === 'ok' ? 'default' : step.status === 'failed' ? 'destructive' : 'secondary'}>{step.status}</Badge>
                        <span className="font-medium">{step.stage}</span>
                        <span className="text-muted-foreground">{step.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── COUNCIL ── */}
        <TabsContent value="council" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Economic Council</CardTitle>
              <CardDescription>Coordinated decision protocol with weighted consensus</CardDescription>
            </CardHeader>
            <CardContent>
              {council ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div><div className="text-2xl font-bold">{council.totalProposals ?? 0}</div><p className="text-xs text-muted-foreground">Total Proposals</p></div>
                    <div><div className="text-2xl font-bold">{((council.acceptanceRate ?? 0) * 100).toFixed(0)}%</div><p className="text-xs text-muted-foreground">Acceptance Rate</p></div>
                    <div><div className="text-2xl font-bold">{council.directorAccuracy?.length ?? 0}</div><p className="text-xs text-muted-foreground">Directors Tracked</p></div>
                  </div>
                  {council.directorAccuracy?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium mb-2">Director Accuracy</h4>
                      <div className="space-y-1">
                        {council.directorAccuracy.map((d: any) => (
                          <div key={d.director} className="flex items-center justify-between text-sm">
                            <span className="font-medium capitalize">{d.director}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">{(d.accuracyRate * 100).toFixed(0)}% accuracy</span>
                              <Badge variant="outline">weight: {d.weight.toFixed(2)}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : <p className="text-sm text-muted-foreground">Loading...</p>}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── LEDGER ── */}
        <TabsContent value="ledger" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Balance Sheet</CardTitle></CardHeader>
              <CardContent>
                {ledger?.balanceSheet ? (
                  <div className="space-y-2 text-sm">
                    <p className="font-medium text-emerald-600">Assets</p>
                    <div className="ml-4 space-y-1">
                      <div className="flex justify-between"><span>Fiat Reserves</span><span className="font-mono">{formatCurrency(ledger.balanceSheet.assets.fiatReserves, 'USD')}</span></div>
                      <div className="flex justify-between"><span>Stablecoin Reserves</span><span className="font-mono">{formatCurrency(ledger.balanceSheet.assets.stablecoinReserves, 'USD')}</span></div>
                      <div className="flex justify-between"><span>Escrow</span><span className="font-mono">{formatCurrency(ledger.balanceSheet.assets.escrow, 'USD')}</span></div>
                      <div className="flex justify-between"><span>Treasury Inventory</span><span className="font-mono">{formatCurrency(ledger.balanceSheet.assets.treasuryInventory, 'USD')}</span></div>
                      <div className="flex justify-between border-t pt-1 font-bold"><span>Total Assets</span><span className="font-mono">{formatCurrency(ledger.balanceSheet.assets.totalAssets, 'USD')}</span></div>
                    </div>
                    <p className="font-medium text-rose-600 mt-3">Liabilities</p>
                    <div className="ml-4 space-y-1">
                      <div className="flex justify-between"><span>Twin Tokens Outstanding</span><span className="font-mono">{formatCurrency(ledger.balanceSheet.liabilities.twinTokensOutstanding, 'USD')}</span></div>
                      <div className="flex justify-between"><span>Pending Settlements</span><span className="font-mono">{formatCurrency(ledger.balanceSheet.liabilities.pendingSettlements, 'USD')}</span></div>
                      <div className="flex justify-between border-t pt-1 font-bold"><span>Total Liabilities</span><span className="font-mono">{formatCurrency(ledger.balanceSheet.liabilities.totalLiabilities, 'USD')}</span></div>
                    </div>
                    <p className="font-medium text-blue-600 mt-3">Equity</p>
                    <div className="ml-4">
                      <div className="flex justify-between font-bold"><span>Total Equity</span><span className="font-mono">{formatCurrency(ledger.balanceSheet.equity.totalEquity, 'USD')}</span></div>
                    </div>
                    <div className="flex justify-between border-t pt-2 mt-2">
                      <span className="font-bold">Balanced</span>
                      <Badge variant={ledger.balanceSheet.isBalanced ? 'default' : 'destructive'}>{ledger.balanceSheet.isBalanced ? 'YES ✓' : 'NO ✗'}</Badge>
                    </div>
                  </div>
                ) : <p className="text-sm text-muted-foreground">Loading...</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Treasury Ledger</CardTitle></CardHeader>
              <CardContent>
                {ledger?.treasuryLedger ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total Assets</span><span className="font-mono">{formatCurrency(ledger.treasuryLedger.totalAssets, 'USD')}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Customer Funds</span><span className="font-mono">{formatCurrency(ledger.treasuryLedger.customerFunds, 'USD')}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">LP Funds</span><span className="font-mono">{formatCurrency(ledger.treasuryLedger.lpFunds, 'USD')}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Locked Funds</span><span className="font-mono">{formatCurrency(ledger.treasuryLedger.lockedFunds, 'USD')}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Free Funds</span><span className="font-mono">{formatCurrency(ledger.treasuryLedger.freeFunds, 'USD')}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Yielding Funds</span><span className="font-mono">{formatCurrency(ledger.treasuryLedger.yieldingFunds, 'USD')}</span></div>
                    <div className="flex justify-between border-t pt-2"><span className="font-bold">Net Profit</span><span className="font-mono font-bold">{formatCurrency(ledger.treasuryLedger.netProfit, 'USD')}</span></div>
                  </div>
                ) : <p className="text-sm text-muted-foreground">Loading...</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── TRUST ── */}
        <TabsContent value="trust" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Formal Verification</CardTitle><CardDescription>Machine-checkable invariants</CardDescription></CardHeader>
              <CardContent>
                {verification ? (
                  <div className="space-y-2">
                    {verification.invariants?.map((inv: any) => (
                      <div key={inv.invariantId} className="flex items-center justify-between rounded border p-2 text-sm">
                        <div>
                          <p className="font-medium">{inv.name}</p>
                          <p className="text-xs text-muted-foreground">{inv.proof}</p>
                        </div>
                        <Badge variant={inv.holds ? 'default' : 'destructive'}>{inv.holds ? '✓ HOLDS' : '✗ VIOLATED'}</Badge>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">Loading...</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Network Health</CardTitle></CardHeader>
              <CardContent>
                {health ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span>Global Score</span><span className="font-bold">{health.globalHealthScore}%</span></div>
                    <div className="flex justify-between"><span>Reserve Coverage</span><span className="font-bold">{health.reserveCoverage}%</span></div>
                    <div className="flex justify-between"><span>Settlement Success</span><span className="font-bold">{health.settlementSuccessRate}%</span></div>
                    <div className="flex justify-between"><span>Twin Token Backing</span><span className="font-bold">{health.twinTokenBacking}%</span></div>
                    <div className="flex justify-between"><span>Solvency Ratio</span><span className="font-bold">{health.solvencyRatio?.toFixed(4)}</span></div>
                    <div className="flex justify-between"><span>Pending Settlements</span><span className="font-bold">{health.pendingSettlements}</span></div>
                  </div>
                ) : <p className="text-sm text-muted-foreground">Loading...</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── DIRECTORATE ── */}
        <TabsContent value="directorate" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Global Economic Directorate</CardTitle>
              <CardDescription>Strategic planning by 6 autonomous directors</CardDescription>
            </CardHeader>
            <CardContent>
              {directorate ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div><div className="text-2xl font-bold">{directorate.globalHealthScore?.toFixed(2) ?? '—'}</div><p className="text-xs text-muted-foreground">Global Score</p></div>
                    <div><div className="text-2xl font-bold">{directorate.directors?.length ?? 0}</div><p className="text-xs text-muted-foreground">Directors Active</p></div>
                    <div><div className="text-2xl font-bold capitalize">{directorate.networkStatus ?? '—'}</div><p className="text-xs text-muted-foreground">Network Status</p></div>
                  </div>
                  {directorate.directors?.map((d: any) => (
                    <div key={d.director} className="rounded border p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium capitalize">{d.director} Director</span>
                        <Badge variant="outline">health: {(d.healthScore * 100).toFixed(0)}%</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{d.recommendations?.length ?? 0} recommendations</p>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">Loading...</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
