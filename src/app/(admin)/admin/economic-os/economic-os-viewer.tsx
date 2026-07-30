'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  Cpu, Coins, Puzzle, Workflow, Zap, ArrowRight, Play, RefreshCw,
  Network, Layers, Activity, Shield, TrendingUp, Sparkles, CheckCircle2,
  XCircle, GitBranch, DollarSign, Star, Globe, Award, FileText,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// DTO TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type EconomicAssetType = 'CURRENCY' | 'CLAIM' | 'CREDENTIAL' | 'RIGHT' | 'RESERVATION' | 'DEBT' | 'EQUITY' | 'INSURANCE' | 'REPUTATION' | 'CAPABILITY' | 'BANDWIDTH' | 'LICENSE' | 'EVIDENCE' | 'RECEIPT';
export type ActorStatus = 'ACTIVE' | 'PAUSED' | 'SUSPENDED';
export type CompositionNodeKind = 'INPUT' | 'ACTOR' | 'OUTPUT' | 'OPPORTUNISTIC';
export type CompositionNodeStatus = 'pending' | 'selected' | 'executing' | 'completed' | 'failed' | 'skipped';
export type CompositionGraphStatus = 'compiled' | 'executing' | 'settled' | 'failed' | 'policy_blocked';

export interface AssetBinding { assetId: string; amount: number; holderId?: string; }
export interface IntentConstraints { maxCost?: number; maxLatencyMs?: number; minTrust?: number; region?: string; regulatoryJurisdiction?: string; preferCheapest?: boolean; preferFastest?: boolean; preferMostTrusted?: boolean; }
export interface IntentDTO {
  id: string; name: string; description: string; goal: string;
  inputs: AssetBinding[]; desiredOutputs?: string[]; constraints?: IntentConstraints;
  category: string; createdAt: string;
}
export interface AssetDTO {
  id: string; name: string; type: EconomicAssetType; issuer: string; unit: string;
  fungible: boolean; transferable: boolean; consumable: boolean; timeLimited: boolean;
  description: string; color: string; totalSupply: number; holderCount: number;
}
export interface ActorPolicy { id: string; name: string; description: string; rule: string; enforcement: 'BLOCK' | 'WARN' | 'REQUIRE_APPROVAL'; }
export interface ActorContracts { produces: string[]; consumes: string[]; capabilities: string[]; policies: ActorPolicy[]; }
export interface ActorDTO {
  id: string; name: string; version: string; status: ActorStatus; category: string; description: string;
  reputation: number; trustScore: number; treasury: Record<string, number>;
  revenue: number; costs: number; profit: number;
  balanceSheetAssets: number; balanceSheetLiabilities: number;
  invocations: number; successfulInvocations: number; failedInvocations: number; avgLatencyMs: number;
  registeredAt: string; contracts: ActorContracts;
}
export interface CapabilityDTO {
  id: string; actorId: string; name: string; description: string;
  produces: string[]; consumes: string[];
  pricePerInvocation: number; priceAsset?: string; latencyMs: number;
  slaSuccessRate: number; trustScore: number; region: string; regulatoryApproved: string[];
}
export interface CompositionNodeDTO {
  id: string; kind: CompositionNodeKind; actorId?: string; actorName?: string;
  capability?: string; capabilityAdId?: string;
  produces: AssetBinding[]; consumes: AssetBinding[];
  cost: number; latencyMs: number; trustScore: number;
  reasoning?: string; status: CompositionNodeStatus;
  alternatives?: Array<{ actorId: string; actorName: string; cost: number; latencyMs: number; trustScore: number; reason: string }>;
}
export interface CompositionEdgeDTO { from: string; to: string; assetId: string; amount: number; }
export interface GraphDTO {
  id: string; intentId: string; intentName: string;
  nodes: CompositionNodeDTO[]; edges: CompositionEdgeDTO[];
  totalCost: number; totalLatencyMs: number; trustScore: number;
  actorCount: number; opportunisticCount: number;
  status: CompositionGraphStatus; policyViolations?: Array<{ policyId: string; policyName: string; actorId: string; rule: string; severity: string; message: string }>;
  compiledAt: string;
}
export interface SettlementStepDTO {
  nodeId: string; actorId?: string; actorName?: string; capability?: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  producedAssets: AssetBinding[]; consumedAssets: AssetBinding[];
  revenue: number; cost: number; detail: string; ts: string;
}
export interface SettlementDTO {
  id: string; graphId: string; intentId: string; intentName: string;
  steps: SettlementStepDTO[]; status: 'RUNNING' | 'SETTLED' | 'FAILED';
  totalRevenue: number; totalCost: number;
  startedAt: string; completedAt: string | null; durationMs?: number;
}
export interface OverviewDTO {
  actorCount: number; activeActorCount: number; assetTypeCount: number; assetCount: number;
  intentCount: number; capabilityCount: number; compilationCount: number;
  settlementCount: number; settledCount: number; totalRevenue: number; totalProfit: number; totalTreasuryValue: number;
}
export interface EconomicOSDTO {
  intents: IntentDTO[]; assets: AssetDTO[]; actors: ActorDTO[];
  capabilities: CapabilityDTO[]; graphs: GraphDTO[]; settlements: SettlementDTO[];
  overview: OverviewDTO;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const COLOR_CLS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/20', dot: 'bg-emerald-500' },
  amber:   { bg: 'bg-amber-500/10',   text: 'text-amber-600 dark:text-amber-400',   border: 'border-amber-500/20',   dot: 'bg-amber-500' },
  sky:     { bg: 'bg-sky-500/10',     text: 'text-sky-600 dark:text-sky-400',       border: 'border-sky-500/20',     dot: 'bg-sky-500' },
  teal:    { bg: 'bg-teal-500/10',    text: 'text-teal-600 dark:text-teal-400',     border: 'border-teal-500/20',    dot: 'bg-teal-500' },
  violet:  { bg: 'bg-violet-500/10',  text: 'text-violet-600 dark:text-violet-400', border: 'border-violet-500/20',  dot: 'bg-violet-500' },
  cyan:    { bg: 'bg-cyan-500/10',    text: 'text-cyan-600 dark:text-cyan-400',     border: 'border-cyan-500/20',    dot: 'bg-cyan-500' },
  rose:    { bg: 'bg-rose-500/10',    text: 'text-rose-600 dark:text-rose-400',     border: 'border-rose-500/20',    dot: 'bg-rose-500' },
  fuchsia: { bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-600 dark:text-fuchsia-400',border: 'border-fuchsia-500/20', dot: 'bg-fuchsia-500' },
  indigo:  { bg: 'bg-indigo-500/10',  text: 'text-indigo-600 dark:text-indigo-400', border: 'border-indigo-500/20',  dot: 'bg-indigo-500' },
  lime:    { bg: 'bg-lime-500/10',    text: 'text-lime-600 dark:text-lime-400',     border: 'border-lime-500/20',    dot: 'bg-lime-500' },
  orange:  { bg: 'bg-orange-500/10',  text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-500/20',  dot: 'bg-orange-500' },
  slate:   { bg: 'bg-slate-500/10',   text: 'text-slate-600 dark:text-slate-400',   border: 'border-slate-500/20',   dot: 'bg-slate-500' },
  purple:  { bg: 'bg-purple-500/10',  text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500/20',  dot: 'bg-purple-500' },
  gray:    { bg: 'bg-gray-500/10',    text: 'text-gray-600 dark:text-gray-400',     border: 'border-gray-500/20',    dot: 'bg-gray-500' },
};
function colorOf(c: string) { return COLOR_CLS[c] ?? COLOR_CLS.slate; }
function fmtUsd(n: number, max = 2): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(max)}`;
}
function fmtNum(n: number, max = 0): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}
function fmtTime(iso: string): string {
  const d = new Date(iso); const diff = Date.now() - d.getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleString();
}

const ASSET_TYPE_COLOR: Record<EconomicAssetType, string> = {
  CURRENCY: 'emerald', CLAIM: 'teal', CREDENTIAL: 'sky', RIGHT: 'violet',
  RESERVATION: 'amber', DEBT: 'rose', EQUITY: 'indigo', INSURANCE: 'cyan',
  REPUTATION: 'fuchsia', CAPABILITY: 'orange', BANDWIDTH: 'lime',
  LICENSE: 'slate', EVIDENCE: 'purple', RECEIPT: 'gray',
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN VIEWER
// ═══════════════════════════════════════════════════════════════════════════

export function EconomicOSViewer({ initial }: { initial: EconomicOSDTO }) {
  const [data, setData] = useState<EconomicOSDTO>(initial);
  const [activeTab, setActiveTab] = useState('compiler');

  const refresh = useCallback(async () => {
    try {
      const [actors, capabilities, graphs, settlements, overview] = await Promise.all([
        fetch('/api/economic-os/actors').then((r) => r.json()),
        fetch('/api/economic-os/capabilities').then((r) => r.json()),
        fetch('/api/economic-os/compile').then((r) => r.json()),
        fetch('/api/economic-os/executions?limit=10').then((r) => r.json()),
        fetch('/api/economic-os/overview').then((r) => r.json()),
      ]);
      setData((d) => ({
        ...d,
        actors: actors.actors, capabilities: capabilities.capabilities,
        graphs: graphs.graphs, settlements: settlements.settlements,
        overview: overview.overview,
      }));
      toast.success('Economic OS refreshed');
    } catch { toast.error('Refresh failed'); }
  }, []);

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="compiler" className="gap-1.5"><Cpu className="h-3.5 w-3.5" />Intent Compiler</TabsTrigger>
            <TabsTrigger value="assets" className="gap-1.5"><Coins className="h-3.5 w-3.5" />Assets</TabsTrigger>
            <TabsTrigger value="actors" className="gap-1.5"><Puzzle className="h-3.5 w-3.5" />Actors</TabsTrigger>
            <TabsTrigger value="marketplace" className="gap-1.5"><GitBranch className="h-3.5 w-3.5" />Marketplace</TabsTrigger>
            <TabsTrigger value="settlements" className="gap-1.5"><Activity className="h-3.5 w-3.5" />Settlements</TabsTrigger>
          </TabsList>
          <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>
        </div>

        <TabsContent value="compiler" className="space-y-4"><CompilerTab data={data} onData={setData} /></TabsContent>
        <TabsContent value="assets" className="space-y-4"><AssetsTab data={data} /></TabsContent>
        <TabsContent value="actors" className="space-y-4"><ActorsTab data={data} /></TabsContent>
        <TabsContent value="marketplace" className="space-y-4"><MarketplaceTab data={data} /></TabsContent>
        <TabsContent value="settlements" className="space-y-4"><SettlementsTab data={data} /></TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string; hint: string; tone: string }) {
  const c = colorOf(tone);
  return (
    <div className={`rounded-lg border ${c.border} ${c.bg} p-4`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className={c.text}>{icon}</span>
      </div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${c.text}`}>{value}</div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// INTENT COMPILER TAB — the hero
// ═══════════════════════════════════════════════════════════════════════════

function CompilerTab({ data, onData }: { data: EconomicOSDTO; onData: (d: EconomicOSDTO) => void }) {
  const [selectedIntentId, setSelectedIntentId] = useState(data.intents[0]?.id ?? '');
  const [compiling, setCompiling] = useState(false);
  const [settling, setSettling] = useState(false);
  const [compiledGraph, setCompiledGraph] = useState<GraphDTO | null>(null);
  const [lastExecution, setLastExecution] = useState<SettlementDTO | null>(null);
  const [selectedNode, setSelectedNode] = useState<CompositionNodeDTO | null>(null);
  const [compileStage, setCompileStage] = useState<string>('');

  const selectedIntent = useMemo(() => data.intents.find((i) => i.id === selectedIntentId), [data.intents, selectedIntentId]);

  const compile = async () => {
    if (!selectedIntent) return;
    setCompiling(true);
    setCompiledGraph(null);
    setLastExecution(null);
    setCompileStage('Parsing intent…');
    await new Promise((r) => setTimeout(r, 350));
    setCompileStage('Walking Produces/Consumes contracts…');
    await new Promise((r) => setTimeout(r, 450));
    setCompileStage('Scoring capability providers…');
    await new Promise((r) => setTimeout(r, 400));
    setCompileStage('Discovering opportunistic actors…');
    await new Promise((r) => setTimeout(r, 350));
    setCompileStage('Running policy engine…');
    await new Promise((r) => setTimeout(r, 300));
    try {
      const res = await fetch('/api/economic-os/compile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentId: selectedIntent.id }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Compile failed');
      setCompiledGraph(j.graph);
      setCompileStage('');
      toast.success(`Compiled: ${j.graph.nodes.length} nodes · ${j.graph.actorCount} actors · $${j.graph.totalCost.toFixed(4)}`);
      onData({ ...data, graphs: [j.graph, ...data.graphs].slice(0, 10) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Compile failed');
      setCompileStage('');
    } finally { setCompiling(false); }
  };

  const settle = async () => {
    if (!compiledGraph) return;
    setSettling(true);
    try {
      const res = await fetch('/api/economic-os/execute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graphId: compiledGraph.id }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Settle failed');
      setLastExecution(j.execution);
      toast.success(`Settled: ${j.execution.steps.length} steps · revenue $${j.execution.totalRevenue.toFixed(4)}`);
      // refresh actors (P&L changed) + settlements
      const [actors, settlements] = await Promise.all([
        fetch('/api/economic-os/actors').then((r) => r.json()),
        fetch('/api/economic-os/executions?limit=10').then((r) => r.json()),
      ]);
      onData({ ...data, actors: actors.actors, settlements: settlements.settlements });
      // also update the graph status
      setCompiledGraph((g) => g ? { ...g, status: j.execution.status === 'SETTLED' ? 'settled' : 'failed' } : g);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Settle failed');
    } finally { setSettling(false); }
  };

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <KpiCard icon={<Puzzle className="h-4 w-4" />} tone="emerald" label="Actors" value={fmtNum(data.overview.actorCount)} hint={`${data.overview.activeActorCount} active`} />
        <KpiCard icon={<Coins className="h-4 w-4" />} tone="amber" label="Assets" value={fmtNum(data.overview.assetCount)} hint={`${data.overview.assetTypeCount} types`} />
        <KpiCard icon={<Cpu className="h-4 w-4" />} tone="violet" label="Intents" value={fmtNum(data.overview.intentCount)} hint="catalog" />
        <KpiCard icon={<GitBranch className="h-4 w-4" />} tone="sky" label="Capabilities" value={fmtNum(data.overview.capabilityCount)} hint="marketplace" />
        <KpiCard icon={<Activity className="h-4 w-4" />} tone="rose" label="Settlements" value={fmtNum(data.overview.settlementCount)} hint={`${data.overview.settledCount} settled`} />
        <KpiCard icon={<DollarSign className="h-4 w-4" />} tone="teal" label="Total Revenue" value={fmtUsd(data.overview.totalRevenue)} hint={`profit ${fmtUsd(data.overview.totalProfit)}`} />
      </div>

      {/* The architecture diagram */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Network className="h-4 w-4 text-violet-500" />Economic OS Architecture</CardTitle>
        </CardHeader>
        <CardContent>
          <ArchitectureDiagram />
        </CardContent>
      </Card>

      {/* Intent selector + compile */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Cpu className="h-4 w-4 text-violet-500" />Intent Compiler</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label className="text-xs">Express an intent</Label>
              <Select value={selectedIntentId} onValueChange={setSelectedIntentId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {data.intents.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      <span className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[9px]">{i.category}</Badge>
                        {i.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={compile} disabled={compiling || !selectedIntent} className="gap-1.5">
                {compiling ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Cpu className="h-3.5 w-3.5" />}
                {compiling ? 'Compiling…' : 'Compile Intent'}
              </Button>
              {compiledGraph && compiledGraph.status === 'compiled' && (
                <Button onClick={settle} disabled={settling} variant="default" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                  {settling ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {settling ? 'Settling…' : 'Settle Graph'}
                </Button>
              )}
            </div>
          </div>

          {selectedIntent && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="font-medium">{selectedIntent.description}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                <Badge className="bg-violet-500/15 text-violet-600 dark:text-violet-400">goal: {selectedIntent.goal}</Badge>
                <span className="text-muted-foreground">inputs:</span>
                {selectedIntent.inputs.map((i, idx) => (
                  <Badge key={idx} variant="outline" className="text-[9px]">{i.assetId} ×{i.amount}</Badge>
                ))}
                {selectedIntent.desiredOutputs && (
                  <>
                    <span className="text-muted-foreground">desired:</span>
                    {selectedIntent.desiredOutputs.map((o, idx) => (
                      <Badge key={idx} variant="outline" className="text-[9px]">{o}</Badge>
                    ))}
                  </>
                )}
                {selectedIntent.constraints && (
                  <>
                    <span className="text-muted-foreground">constraints:</span>
                    {selectedIntent.constraints.maxCost !== undefined && <Badge variant="outline" className="text-[9px]">maxCost ${selectedIntent.constraints.maxCost}</Badge>}
                    {selectedIntent.constraints.maxLatencyMs !== undefined && <Badge variant="outline" className="text-[9px]">maxLatency {selectedIntent.constraints.maxLatencyMs}ms</Badge>}
                    {selectedIntent.constraints.minTrust !== undefined && <Badge variant="outline" className="text-[9px]">minTrust {selectedIntent.constraints.minTrust}</Badge>}
                    {selectedIntent.constraints.region && <Badge variant="outline" className="text-[9px]">region {selectedIntent.constraints.region}</Badge>}
                    {selectedIntent.constraints.preferCheapest && <Badge variant="outline" className="text-[9px]">prefer cheapest</Badge>}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Compile stage animation */}
          <AnimatePresence>
            {compiling && compileStage && (
              <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="rounded-md border border-violet-500/30 bg-violet-500/5 p-3 text-xs">
                <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400">
                  <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                  <span className="font-medium">{compileStage}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Discovered composition DAG */}
      {compiledGraph && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-emerald-500" />Discovered Composition DAG</span>
              <div className="flex items-center gap-2 text-[10px] font-normal">
                <Badge className={compiledGraph.status === 'settled' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : compiledGraph.status === 'policy_blocked' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-violet-500/15 text-violet-600 dark:text-violet-400'}>{compiledGraph.status}</Badge>
                <span className="text-muted-foreground">{compiledGraph.nodes.length} nodes · {compiledGraph.actorCount} actors · {compiledGraph.opportunisticCount} opportunistic</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-emerald-600 dark:text-emerald-400">cost ${compiledGraph.totalCost.toFixed(4)}</span>
                <span className="text-muted-foreground">·</span>
                <span>{compiledGraph.totalLatencyMs}ms</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-amber-600 dark:text-amber-400">trust {compiledGraph.trustScore}</span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CompositionDAG graph={compiledGraph} assets={data.assets} onSelectNode={setSelectedNode} selectedNode={selectedNode} />
            {compiledGraph.policyViolations && compiledGraph.policyViolations.length > 0 && (
              <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/5 p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-rose-600 dark:text-rose-400"><XCircle className="h-3.5 w-3.5" />Policy Violations</div>
                <div className="mt-1.5 space-y-1">
                  {compiledGraph.policyViolations.map((v, i) => (
                    <div key={i} className="text-[11px] text-muted-foreground">
                      <Badge variant="outline" className="text-[9px] mr-1">{v.severity}</Badge>
                      <span className="font-medium">{v.policyName}</span> on <span className="font-mono">{v.actorId}</span> — {v.message}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Settlement trace */}
      {lastExecution && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-emerald-500" />Settlement Trace
              <Badge className={lastExecution.status === 'SETTLED' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'}>{lastExecution.status}</Badge>
              <span className="text-[10px] font-normal text-muted-foreground">{lastExecution.durationMs}ms · revenue ${lastExecution.totalRevenue.toFixed(4)} · cost ${lastExecution.totalCost.toFixed(4)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {lastExecution.steps.map((s, i) => {
                const icon = s.status === 'SUCCESS' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : s.status === 'FAILED' ? <XCircle className="h-3.5 w-3.5 text-rose-500" /> : <span className="text-[10px] text-muted-foreground">SKIP</span>;
                return (
                  <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                    className={`rounded-md border p-2.5 text-xs ${s.status === 'FAILED' ? 'border-rose-500/30 bg-rose-500/5' : s.status === 'SUCCESS' ? 'border-emerald-500/20 bg-emerald-500/5' : 'bg-muted/20'}`}>
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-background text-[10px] font-bold">{i + 1}</span>
                      {icon}
                      {s.actorName && <span className="font-medium">{s.actorName}</span>}
                      {s.capability && <Badge variant="outline" className="text-[9px] font-mono">{s.capability}</Badge>}
                      <span className="ml-auto flex items-center gap-2 text-[10px]">
                        {s.revenue > 0 && <span className="text-emerald-600 dark:text-emerald-400">+${s.revenue.toFixed(4)}</span>}
                        {s.cost > 0 && <span className="text-rose-600 dark:text-rose-400">-${s.cost.toFixed(4)}</span>}
                      </span>
                    </div>
                    <div className="mt-1 pl-7 text-[10px] text-muted-foreground">{s.detail}</div>
                  </motion.div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Node detail sheet */}
      <Sheet open={!!selectedNode} onOpenChange={(o) => !o && setSelectedNode(null)}>
        <SheetContent side="right" className="w-[480px] overflow-y-auto sm:max-w-[480px]">
          {selectedNode && <NodeDetail node={selectedNode} assets={data.assets} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Architecture Diagram ─────────────────────────────────────────────────────
function ArchitectureDiagram() {
  const stages = [
    { label: 'Intent', sub: 'user goal', color: 'violet', icon: <Cpu className="h-3.5 w-3.5" /> },
    { label: 'Economic Compiler', sub: 'discovers DAG', color: 'emerald', icon: <GitBranch className="h-3.5 w-3.5" /> },
    { label: 'Composition Graph', sub: 'typed assets', color: 'sky', icon: <Network className="h-3.5 w-3.5" /> },
    { label: 'Autonomous Actors', sub: 'P&L businesses', color: 'amber', icon: <Puzzle className="h-3.5 w-3.5" /> },
    { label: 'Economic Assets', sub: '14 types', color: 'teal', icon: <Coins className="h-3.5 w-3.5" /> },
    { label: 'Settlement Kernel', sub: 'atomic + P&L', color: 'rose', icon: <Activity className="h-3.5 w-3.5" /> },
  ];
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {stages.map((s, i) => {
        const c = colorOf(s.color);
        return (
          <div key={i} className="flex items-center gap-2">
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.06 }}
              className={`flex flex-col gap-1 rounded-lg border ${c.border} ${c.bg} p-3 min-w-[140px]`}>
              <div className={`flex items-center gap-1.5 ${c.text}`}>{s.icon}</div>
              <div className="text-xs font-bold">{s.label}</div>
              <div className="text-[10px] text-muted-foreground">{s.sub}</div>
            </motion.div>
            {i < stages.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Composition DAG (SVG) ────────────────────────────────────────────────────
function CompositionDAG({ graph, assets, onSelectNode, selectedNode }: {
  graph: GraphDTO; assets: AssetDTO[];
  onSelectNode: (n: CompositionNodeDTO) => void; selectedNode: CompositionNodeDTO | null;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    // Layered layout: INPUT (left) → ACTOR (middle, by topological depth) → OUTPUT (right)
    // Opportunistic nodes attach at the bottom of their trigger layer.
    const W = 1100, H = 580;
    const pos = new Map<string, { x: number; y: number; depth: number }>();

    // Compute depth via BFS from input nodes
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const n of graph.nodes) { inDegree.set(n.id, 0); adj.set(n.id, []); }
    for (const e of graph.edges) {
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from)!.push(e.to);
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    }
    const depth = new Map<string, number>();
    const queue: string[] = [];
    for (const n of graph.nodes) if ((inDegree.get(n.id) ?? 0) === 0) { depth.set(n.id, 0); queue.push(n.id); }
    while (queue.length) {
      const id = queue.shift()!;
      const d = depth.get(id) ?? 0;
      for (const next of adj.get(id) ?? []) {
        depth.set(next, Math.max(depth.get(next) ?? 0, d + 1));
        inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
        if (inDegree.get(next) === 0) queue.push(next);
      }
    }

    // Group by depth
    const byDepth = new Map<number, string[]>();
    for (const n of graph.nodes) {
      const d = depth.get(n.id) ?? 0;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(n.id);
    }

    const maxDepth = Math.max(...Array.from(byDepth.keys()), 0);
    const colWidth = (W - 120) / Math.max(maxDepth, 1);
    for (const [d, ids] of byDepth.entries()) {
      const x = 60 + d * colWidth;
      const sorted = ids.sort((a, b) => {
        const na = graph.nodes.find((n) => n.id === a)!;
        const nb = graph.nodes.find((n) => n.id === b)!;
        // opportunistic at the bottom
        if (na.kind === 'OPPORTUNISTIC' && nb.kind !== 'OPPORTUNISTIC') return 1;
        if (nb.kind === 'OPPORTUNISTIC' && na.kind !== 'OPPORTUNISTIC') return -1;
        return 0;
      });
      const step = sorted.length > 1 ? (H - 120) / (sorted.length - 1) : 0;
      const startY = sorted.length > 1 ? 60 : H / 2;
      sorted.forEach((id, i) => pos.set(id, { x, y: startY + i * step, depth: d }));
    }

    return { pos, W, H, maxDepth };
  }, [graph]);

  const nodeColor = (n: CompositionNodeDTO): string => {
    if (n.kind === 'INPUT') return 'slate';
    if (n.kind === 'OUTPUT') return 'emerald';
    if (n.kind === 'OPPORTUNISTIC') return 'fuchsia';
    const actor = n.actorId;
    const assetMap: Record<string, string> = { identity: 'sky', treasury: 'teal', marketplace: 'emerald', lending: 'amber', ai: 'violet', storage: 'cyan', bandwidth: 'lime', rewards: 'fuchsia', insurance: 'indigo', carbon: 'lime', education: 'orange', employment: 'orange', compliance: 'slate', compute: 'orange' };
    return assetMap[actor ?? ''] ?? 'violet';
  };

  const isFocused = (id: string) => {
    if (!selectedNode && !hover) return true;
    const focus = hover ?? selectedNode?.id;
    if (focus === id) return true;
    return graph.edges.some((e) => (e.from === focus && e.to === id) || (e.to === focus && e.from === id));
  };

  return (
    <div className="overflow-x-auto rounded-md border bg-gradient-to-br from-background to-muted/20">
      <svg width={layout.W} height={layout.H} className="min-w-full" style={{ minWidth: layout.W }}>
        {/* edges */}
        {graph.edges.map((e, i) => {
          const from = layout.pos.get(e.from); const to = layout.pos.get(e.to);
          if (!from || !to) return null;
          const focused = (!selectedNode && !hover) || e.from === (hover ?? selectedNode?.id) || e.to === (hover ?? selectedNode?.id);
          const asset = assets.find((a) => a.id === e.assetId);
          const c = colorOf(asset?.color ?? 'slate');
          const midX = (from.x + to.x) / 2;
          const path = `M ${from.x + 60} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x - 60} ${to.y}`;
          return (
            <g key={i}>
              <path d={path} fill="none" stroke={asset ? `currentColor` : '#94a3b8'} strokeWidth={focused ? 2 : 1}
                strokeOpacity={focused ? 0.85 : 0.2} className={c.text} />
              {focused && (
                <text x={midX} y={(from.y + to.y) / 2 - 4} textAnchor="middle" className="fill-muted-foreground pointer-events-none select-none" style={{ fontSize: 8 }}>
                  {asset?.id ?? e.assetId}
                </text>
              )}
            </g>
          );
        })}
        {/* nodes */}
        {graph.nodes.map((n) => {
          const p = layout.pos.get(n.id); if (!p) return null;
          const c = colorOf(nodeColor(n));
          const focused = isFocused(n.id);
          const isSel = selectedNode?.id === n.id;
          const w = 120, h = 44;
          return (
            <g key={n.id} transform={`translate(${p.x - w / 2}, ${p.y - h / 2})`}
              style={{ cursor: 'pointer', opacity: focused ? 1 : 0.3 }}
              onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
              onClick={() => onSelectNode(n)}>
              <rect width={w} height={h} rx={6}
                className={`${c.bg} ${isSel ? 'ring-2 ring-emerald-500' : ''}`}
                stroke="currentColor" strokeWidth={1.5} style={{ color: 'currentColor' }} />
              <text x={w / 2} y={16} textAnchor="middle" className={`fill-current ${c.text} pointer-events-none select-none`} style={{ fontSize: 9, fontWeight: 700 }}>
                {n.kind === 'INPUT' ? 'INPUT' : n.kind === 'OUTPUT' ? 'GOAL' : n.actorName?.slice(0, 14) ?? n.capability}
              </text>
              <text x={w / 2} y={30} textAnchor="middle" className="fill-muted-foreground pointer-events-none select-none" style={{ fontSize: 8 }}>
                {n.kind === 'INPUT' ? `${n.produces.length} assets` : n.kind === 'OUTPUT' ? n.consumes[0]?.assetId ?? '' : n.capability ?? ''}
              </text>
              <text x={w / 2} y={40} textAnchor="middle" className={`fill-current ${c.text} pointer-events-none select-none`} style={{ fontSize: 7, opacity: 0.7 }}>
                {n.kind === 'INPUT' || n.kind === 'OUTPUT' ? '' : `$${n.cost.toFixed(4)} · ${n.latencyMs}ms`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function NodeDetail({ node, assets }: { node: CompositionNodeDTO; assets: AssetDTO[] }) {
  const c = colorOf(node.kind === 'INPUT' ? 'slate' : node.kind === 'OUTPUT' ? 'emerald' : node.kind === 'OPPORTUNISTIC' ? 'fuchsia' : 'violet');
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${c.bg} ${c.text}`}>
            {node.kind === 'INPUT' ? <Coins className="h-4 w-4" /> : node.kind === 'OUTPUT' ? <CheckCircle2 className="h-4 w-4" /> : node.kind === 'OPPORTUNISTIC' ? <Sparkles className="h-4 w-4" /> : <Puzzle className="h-4 w-4" />}
          </div>
          {node.actorName ?? node.kind}
        </SheetTitle>
        <SheetDescription>
          {node.kind === 'INPUT' && 'User-provided input assets'}
          {node.kind === 'OUTPUT' && 'The intent goal — satisfied when upstream produces it'}
          {node.kind === 'OPPORTUNISTIC' && `Opportunistic attachment · reacts to produced assets to add value`}
          {node.kind === 'ACTOR' && `Actor invocation · capability: ${node.capability}`}
        </SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-3 text-xs">
        {node.reasoning && (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Optimizer Reasoning</div>
            <div className="mt-1 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">{node.reasoning}</div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border bg-card/40 p-2"><div className="text-[9px] uppercase text-muted-foreground">Cost</div><div className="font-semibold">{fmtUsd(node.cost, 4)}</div></div>
          <div className="rounded-md border bg-card/40 p-2"><div className="text-[9px] uppercase text-muted-foreground">Latency</div><div className="font-semibold">{node.latencyMs}ms</div></div>
          <div className="rounded-md border bg-card/40 p-2"><div className="text-[9px] uppercase text-muted-foreground">Trust</div><div className="font-semibold">{node.trustScore}</div></div>
        </div>
        {node.produces.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Produces</div>
            <div className="flex flex-wrap gap-1.5">
              {node.produces.map((p, i) => {
                const a = assets.find((x) => x.id === p.assetId);
                const pc = colorOf(a?.color ?? 'slate');
                return <Badge key={i} className={`text-[9px] ${pc.bg} ${pc.text}`}>{a?.name ?? p.assetId}</Badge>;
              })}
            </div>
          </div>
        )}
        {node.consumes.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Consumes</div>
            <div className="flex flex-wrap gap-1.5">
              {node.consumes.map((p, i) => {
                const a = assets.find((x) => x.id === p.assetId);
                return <Badge key={i} variant="outline" className="text-[9px]">{a?.name ?? p.assetId}</Badge>;
              })}
            </div>
          </div>
        )}
        {node.alternatives && node.alternatives.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Alternative Providers Considered</div>
            <div className="space-y-1.5">
              {node.alternatives.map((alt, i) => (
                <div key={i} className="rounded-md border bg-card/40 p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{alt.actorName}</span>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>${alt.cost.toFixed(4)}</span><span>·</span><span>{alt.latencyMs}ms</span><span>·</span><span>trust {alt.trustScore}</span>
                    </div>
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{alt.reason}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSETS TAB — the typed asset registry (all 14 types)
// ═══════════════════════════════════════════════════════════════════════════

function AssetsTab({ data }: { data: EconomicOSDTO }) {
  const [filterType, setFilterType] = useState<EconomicAssetType | 'ALL'>('ALL');
  const types = useMemo(() => {
    const counts = new Map<EconomicAssetType, number>();
    for (const a of data.assets) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [data.assets]);

  const filtered = filterType === 'ALL' ? data.assets : data.assets.filter((a) => a.type === filterType);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {types.map(([type, count]) => {
          const c = colorOf(ASSET_TYPE_COLOR[type]);
          return (
            <button key={type} onClick={() => setFilterType(filterType === type ? 'ALL' : type)}
              className={`rounded-lg border p-3 text-left transition-all hover:shadow-sm ${filterType === type ? `${c.border} ${c.bg} ring-1 ring-emerald-500/40` : 'border-border bg-card/40'}`}>
              <div className={`text-[10px] font-medium uppercase tracking-wide ${c.text}`}>{type}</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{count}</div>
              <div className="text-[9px] text-muted-foreground">asset{count !== 1 ? 's' : ''}</div>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2"><Coins className="h-4 w-4 text-amber-500" />Asset Registry</span>
            <Badge variant="outline" className="text-[10px]">{filtered.length} of {data.assets.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[560px] overflow-y-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/50 backdrop-blur">
                <tr className="text-left">
                  <th className="p-2 font-medium">Asset</th><th className="p-2 font-medium">Type</th>
                  <th className="p-2 font-medium">Issuer</th><th className="p-2 font-medium">Unit</th>
                  <th className="p-2 font-medium">Flags</th>
                  <th className="p-2 text-right font-medium">Supply</th><th className="p-2 text-right font-medium">Holders</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const c = colorOf(a.color);
                  return (
                    <tr key={a.id} className="border-t hover:bg-muted/30">
                      <td className="p-2">
                        <div className={`font-medium ${c.text}`}>{a.name}</div>
                        <div className="font-mono text-[9px] text-muted-foreground">{a.id}</div>
                      </td>
                      <td className="p-2"><Badge className={`text-[9px] ${c.bg} ${c.text}`}>{a.type}</Badge></td>
                      <td className="p-2 text-muted-foreground">{a.issuer}</td>
                      <td className="p-2 font-mono text-[10px]">{a.unit}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {a.fungible && <Badge variant="outline" className="text-[8px]">fungible</Badge>}
                          {a.transferable && <Badge variant="outline" className="text-[8px]">transferable</Badge>}
                          {a.consumable && <Badge variant="outline" className="text-[8px]">consumable</Badge>}
                          {a.timeLimited && <Badge variant="outline" className="text-[8px]">time-limited</Badge>}
                        </div>
                      </td>
                      <td className="p-2 text-right tabular-nums">{fmtNum(a.totalSupply)}</td>
                      <td className="p-2 text-right tabular-nums">{a.holderCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTORS TAB — autonomous businesses with P&L
// ═══════════════════════════════════════════════════════════════════════════

function ActorsTab({ data }: { data: EconomicOSDTO }) {
  const [selected, setSelected] = useState<ActorDTO | null>(null);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<Puzzle className="h-4 w-4" />} tone="emerald" label="Actors" value={fmtNum(data.actors.length)} hint={`${data.overview.activeActorCount} active`} />
        <KpiCard icon={<DollarSign className="h-4 w-4" />} tone="teal" label="Total Revenue" value={fmtUsd(data.overview.totalRevenue)} hint="cumulative" />
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} tone="violet" label="Total Profit" value={fmtUsd(data.overview.totalProfit)} hint="revenue - costs" />
        <KpiCard icon={<Shield className="h-4 w-4" />} tone="amber" label="Treasury Value" value={fmtUsd(data.overview.totalTreasuryValue)} hint="balance sheets" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {data.actors.map((a) => {
          const c = colorOf(a.category === 'identity' ? 'sky' : a.category === 'treasury' ? 'teal' : a.category === 'marketplace' ? 'emerald' : a.category === 'lending' ? 'amber' : a.category === 'ai' ? 'violet' : a.category === 'storage' ? 'cyan' : a.category === 'bandwidth' ? 'lime' : a.category === 'rewards' ? 'fuchsia' : a.category === 'insurance' ? 'indigo' : a.category === 'carbon' ? 'lime' : a.category === 'education' ? 'orange' : a.category === 'employment' ? 'orange' : a.category === 'compliance' ? 'slate' : a.category === 'compute' ? 'orange' : 'slate');
          const margin = a.revenue > 0 ? (a.profit / a.revenue) * 100 : 0;
          return (
            <Card key={a.id} className={`cursor-pointer transition-all hover:shadow-md ${selected?.id === a.id ? 'ring-2 ring-emerald-500/40' : ''}`} onClick={() => setSelected(a)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${c.bg} ${c.text}`}><Puzzle className="h-4 w-4" /></div>
                    <div>
                      <div className="text-sm font-bold">{a.name}</div>
                      <div className="text-[10px] text-muted-foreground">{a.category} · v{a.version}</div>
                    </div>
                  </div>
                  <Badge className={`text-[9px] ${a.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-slate-500/15 text-slate-600 dark:text-slate-400'}`}>{a.status}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">{a.description}</p>
                {/* P&L */}
                <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                  <div><div className="text-muted-foreground">Revenue</div><div className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtUsd(a.revenue)}</div></div>
                  <div><div className="text-muted-foreground">Costs</div><div className="font-semibold text-rose-600 dark:text-rose-400">{fmtUsd(a.costs)}</div></div>
                  <div><div className="text-muted-foreground">Profit</div><div className={`font-semibold ${a.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{fmtUsd(a.profit)}</div></div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">Margin {margin.toFixed(0)}% · {fmtNum(a.invocations)} calls</span>
                  <div className="flex items-center gap-1">
                    <Star className="h-3 w-3 text-amber-500" /><span className="font-semibold">{a.reputation}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-[500px] overflow-y-auto sm:max-w-[500px]">
          {selected && <ActorDetail actor={selected} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ActorDetail({ actor: a }: { actor: ActorDTO }) {
  const margin = a.revenue > 0 ? (a.profit / a.revenue) * 100 : 0;
  const successRate = a.invocations > 0 ? (a.successfulInvocations / a.invocations) * 100 : 100;
  return (
    <>
      <SheetHeader>
        <SheetTitle>{a.name}</SheetTitle>
        <SheetDescription>{a.category} · v{a.version} · {a.status}</SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-4 text-xs">
        <p className="text-muted-foreground">{a.description}</p>
        {/* Balance sheet */}
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Balance Sheet</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div><div className="text-[9px] text-muted-foreground">Assets</div><div className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtUsd(a.balanceSheetAssets)}</div></div>
            <div><div className="text-[9px] text-muted-foreground">Liabilities</div><div className="font-semibold text-rose-600 dark:text-rose-400">{fmtUsd(a.balanceSheetLiabilities)}</div></div>
          </div>
        </div>
        {/* P&L */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border bg-card/40 p-2"><div className="text-[9px] uppercase text-muted-foreground">Revenue</div><div className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtUsd(a.revenue)}</div></div>
          <div className="rounded-md border bg-card/40 p-2"><div className="text-[9px] uppercase text-muted-foreground">Costs</div><div className="font-semibold text-rose-600 dark:text-rose-400">{fmtUsd(a.costs)}</div></div>
          <div className="rounded-md border bg-card/40 p-2"><div className="text-[9px] uppercase text-muted-foreground">Profit</div><div className={`font-semibold ${a.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{fmtUsd(a.profit)}</div></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border bg-card/40 p-2"><div className="text-[9px] uppercase text-muted-foreground">Margin</div><div className="font-semibold">{margin.toFixed(1)}%</div></div>
          <div className="rounded-md border bg-card/40 p-2"><div className="text-[9px] uppercase text-muted-foreground">Success Rate</div><div className="font-semibold">{successRate.toFixed(2)}%</div></div>
          <div className="rounded-md border bg-card/40 p-2"><div className="text-[9px] uppercase text-muted-foreground">Avg Latency</div><div className="font-semibold">{a.avgLatencyMs}ms</div></div>
        </div>
        {/* Contracts */}
        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Produces (assets)</div>
          <div className="flex flex-wrap gap-1.5">{a.contracts.produces.map((p) => <Badge key={p} className="bg-emerald-500/15 text-[9px] text-emerald-600 dark:text-emerald-400">{p}</Badge>)}{a.contracts.produces.length === 0 && <span className="text-muted-foreground">— none —</span>}</div>
        </div>
        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Consumes (assets)</div>
          <div className="flex flex-wrap gap-1.5">{a.contracts.consumes.map((p) => <Badge key={p} className="bg-amber-500/15 text-[9px] text-amber-600 dark:text-amber-400">{p}</Badge>)}{a.contracts.consumes.length === 0 && <span className="text-muted-foreground">— none —</span>}</div>
        </div>
        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Capabilities</div>
          <div className="flex flex-wrap gap-1.5">{a.contracts.capabilities.map((cap) => <Badge key={cap} variant="outline" className="text-[9px] font-mono">{cap}</Badge>)}</div>
        </div>
        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Policies</div>
          <div className="space-y-1">
            {a.contracts.policies.map((p) => (
              <div key={p.id} className="rounded-md border bg-card/40 p-2">
                <div className="flex items-center gap-2">
                  <Badge className={`text-[8px] ${p.enforcement === 'BLOCK' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : p.enforcement === 'WARN' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-sky-500/15 text-sky-600 dark:text-sky-400'}`}>{p.enforcement}</Badge>
                  <span className="font-medium">{p.name}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{p.description}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MARKETPLACE TAB — capability advertisements with competing providers
// ═══════════════════════════════════════════════════════════════════════════

function MarketplaceTab({ data }: { data: EconomicOSDTO }) {
  // Group capabilities by the asset they produce (to show competition)
  const byProduces = useMemo(() => {
    const m = new Map<string, CapabilityDTO[]>();
    for (const c of data.capabilities) {
      for (const p of c.produces) {
        if (!m.has(p)) m.set(p, []);
        m.get(p)!.push(c);
      }
    }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [data.capabilities]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<GitBranch className="h-4 w-4" />} tone="sky" label="Capabilities" value={fmtNum(data.capabilities.length)} hint="advertised" />
        <KpiCard icon={<Network className="h-4 w-4" />} tone="violet" label="Asset Markets" value={fmtNum(byProduces.length)} hint="with providers" />
        <KpiCard icon={<DollarSign className="h-4 w-4" />} tone="emerald" label="Cheapest" value={fmtUsd(Math.min(...data.capabilities.map((c) => c.pricePerInvocation)), 4)} hint="per invocation" />
        <KpiCard icon={<Zap className="h-4 w-4" />} tone="amber" label="Fastest" value={`${Math.min(...data.capabilities.map((c) => c.latencyMs))}ms`} hint="latency" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><GitBranch className="h-4 w-4 text-sky-500" />Capability Marketplace — Competing Providers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
            {byProduces.map(([assetId, caps]) => {
              const asset = data.assets.find((a) => a.id === assetId);
              const c = colorOf(asset?.color ?? 'slate');
              const cheapest = caps.reduce((min, x) => x.pricePerInvocation < min.pricePerInvocation ? x : min);
              return (
                <div key={assetId} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                      <span className="text-sm font-bold">{asset?.name ?? assetId}</span>
                      <Badge variant="outline" className="text-[9px]">{asset?.type}</Badge>
                    </div>
                    <Badge className="text-[9px] bg-sky-500/15 text-sky-600 dark:text-sky-400">{caps.length} provider{caps.length !== 1 ? 's' : ''}</Badge>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {caps.sort((a, b) => a.pricePerInvocation - b.pricePerInvocation).map((cap) => {
                      const isCheapest = cap.id === cheapest.id;
                      return (
                        <div key={cap.id} className={`flex items-center gap-3 rounded-md border p-2 text-xs ${isCheapest ? 'border-emerald-500/30 bg-emerald-500/5' : 'bg-card/40'}`}>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{cap.name}</span>
                              {isCheapest && <Badge className="text-[8px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">cheapest</Badge>}
                            </div>
                            <div className="text-[10px] text-muted-foreground">{cap.description}</div>
                          </div>
                          <div className="flex items-center gap-3 text-[10px]">
                            <span className="flex items-center gap-1"><DollarSign className="h-3 w-3 text-emerald-500" />{cap.pricePerInvocation.toFixed(4)}</span>
                            <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-amber-500" />{cap.latencyMs}ms</span>
                            <span className="flex items-center gap-1"><Star className="h-3 w-3 text-violet-500" />{cap.trustScore}</span>
                            <span className="flex items-center gap-1"><Globe className="h-3 w-3 text-sky-500" />{cap.region}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTLEMENTS TAB — execution history with P&L
// ═══════════════════════════════════════════════════════════════════════════

function SettlementsTab({ data }: { data: EconomicOSDTO }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<Activity className="h-4 w-4" />} tone="rose" label="Settlements" value={fmtNum(data.settlements.length)} hint="all-time" />
        <KpiCard icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald" label="Settled" value={fmtNum(data.settlements.filter((s) => s.status === 'SETTLED').length)} hint="success" />
        <KpiCard icon={<DollarSign className="h-4 w-4" />} tone="teal" label="Total Revenue" value={fmtUsd(data.settlements.reduce((s, x) => s + x.totalRevenue, 0))} hint="from settlements" />
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} tone="violet" label="Avg Steps" value={fmtNum(data.settlements.length ? data.settlements.reduce((s, x) => s + x.steps.length, 0) / data.settlements.length : 0, 1)} hint="per settlement" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-rose-500" />Settlement History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
            {data.settlements.length === 0 && <div className="py-12 text-center text-muted-foreground">No settlements yet. Compile an intent and settle it.</div>}
            {data.settlements.map((s) => (
              <div key={s.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[9px] ${s.status === 'SETTLED' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : s.status === 'FAILED' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'}`}>{s.status}</Badge>
                    <span className="text-sm font-bold">{s.intentName}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>{s.steps.length} steps</span>
                    <span>·</span>
                    <span>{s.durationMs}ms</span>
                    <span>·</span>
                    <span className="text-emerald-600 dark:text-emerald-400">rev ${s.totalRevenue.toFixed(4)}</span>
                    <span>·</span>
                    <span className="text-rose-600 dark:text-rose-400">cost ${s.totalCost.toFixed(4)}</span>
                    <span>·</span>
                    <span>{fmtTime(s.startedAt)}</span>
                  </div>
                </div>
                {/* mini step trace */}
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.steps.filter((st) => st.actorName).map((st, i) => (
                    <Badge key={i} variant="outline" className={`text-[8px] ${st.status === 'SUCCESS' ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400' : 'border-rose-500/30 text-rose-600 dark:text-rose-400'}`}>
                      {st.actorName}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
