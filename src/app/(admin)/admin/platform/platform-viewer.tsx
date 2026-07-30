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
import { toast } from 'sonner';
import {
  Cpu, Brain, User, Webhook, Building2, Landmark, Scale, Box,
  Sparkles, Play, RefreshCw, Network, Activity, DollarSign, TrendingUp,
  CheckCircle2, XCircle, GitBranch, Trophy, Zap, Award, Brain as BrainIcon,
} from 'lucide-react';

// ── DTO types ──
export type ProviderKind = 'ORGANIZATION' | 'AI_MODEL' | 'HUMAN' | 'API' | 'IOT_DEVICE' | 'BANK' | 'GOVERNMENT' | 'BLOCKCHAIN';
export type ProofNodeKind = 'INPUT' | 'CAPABILITY' | 'OUTPUT' | 'OPPORTUNISTIC';

export interface CapabilityDTO { id: string; name: string; description: string; category: string; produces: string[]; requires: string[]; minTrust?: number; typicalLatencyMs: number; universal: boolean; createdAt: number; }
export interface ProviderOfferDTO { capabilityId: string; pricePerInvocation: number; latencyMs: number; slaSuccessRate: number; capacity: number; region: string; notes?: string; }
export interface ProviderDTO {
  id: string; name: string; kind: ProviderKind; status: string; description: string; offers: ProviderOfferDTO[];
  trustScore: number; reputation: number; revenue: number; costs: number;
  invocations: number; successfulInvocations: number; failedInvocations: number;
  reliabilityScore: number; reliabilityTrend: 'IMPROVING' | 'STABLE' | 'DECLINING';
  jurisdictions: string[]; carbonPerInvocation: number; registeredAt: number;
}
export interface AssetTypeDTO { id: string; name: string; category: string; unit: string; description: string; color: string; }
export interface GoalDTO { id: string; name: string; description: string; category: string; targetAsset: string; inputs: { assetId: string; amount: number }[]; constraints?: { budget?: number; deadline?: number; minTrust?: number; maxCarbon?: number; jurisdiction?: string; region?: string; preferProviderKind?: ProviderKind }; createdAt: number; }
export interface ProofNodeDTO { id: string; kind: ProofNodeKind; capabilityId?: string; capabilityName?: string; providerId?: string; providerName?: string; providerKind?: ProviderKind; produces: { assetId: string; amount: number }[]; consumes: { assetId: string; amount: number }[]; cost: number; latencyMs: number; trustScore: number; carbon: number; reasoning?: string; alternatives?: Array<{ providerId: string; providerName: string; providerKind: ProviderKind; cost: number; latencyMs: number; trustScore: number; reason: string }>; status: string; }
export interface ProofDTO { id: string; goalId: string; goalName: string; nodes: ProofNodeDTO[]; edges: { from: string; to: string; assetId: string; amount: number }[]; totalCost: number; totalLatencyMs: number; trustScore: number; carbon: number; capabilityCount: number; providerCount: number; providerKinds: ProviderKind[]; plannerScore: number; scoreBreakdown: { dimension: string; score: number; weight: number }[]; status: string; verification?: { proofId: string; checks: Array<{ id: string; name: string; description: string; category: string; passed: boolean; detail: string; severity: string }>; allPassed: boolean; criticalFailures: number; majorFailures: number; verifiedAt: string }; memoryHits?: number; predictedSuccessRate?: number; createdAt: string; }
export interface MemoryDTO { id: string; goalId: string; goalName: string; proofId: string; capabilities: string[]; providers: string[]; context: { jurisdiction?: string; region?: string; timeOfDay?: string; seasonality?: string; riskLevel?: number }; outcome: 'SUCCESS' | 'FAILURE' | 'PARTIAL'; failureReason?: string; totalCost: number; totalLatencyMs: number; trustScore: number; carbon: number; customerSatisfaction?: number; executedAt: string; durationMs: number; }
export interface LearningDTO { providerId: string; providerName: string; capabilityId: string; totalExecutions: number; successRate: number; avgCost: number; avgLatencyMs: number; avgSatisfaction: number; learnedScore: number; trend: 'IMPROVING' | 'STABLE' | 'DECLINING'; }
export interface GraphNodeDTO { id: string; kind: string; label: string; sublabel?: string; group?: string; color?: string; }
export interface GraphEdgeDTO { from: string; to: string; kind: string; weight?: number; }
export interface OverviewDTO { capabilityCount: number; providerCount: number; providerKindCount: number; assetTypeCount: number; goalCount: number; proofCount: number; settledProofCount: number; memoryRecordCount: number; avgSuccessRate: number; totalExecutions: number; graphNodeCount: number; graphEdgeCount: number; learningEntries: number; }
export interface PlatformDTO { capabilities: CapabilityDTO[]; providers: ProviderDTO[]; assetTypes: AssetTypeDTO[]; goals: GoalDTO[]; memory: MemoryDTO[]; learning: LearningDTO[]; graph: { nodes: GraphNodeDTO[]; edges: GraphEdgeDTO[] }; overview: OverviewDTO; }

const COLOR: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/20', dot: 'bg-emerald-500' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/20', dot: 'bg-amber-500' },
  sky: { bg: 'bg-sky-500/10', text: 'text-sky-600 dark:text-sky-400', border: 'border-sky-500/20', dot: 'bg-sky-500' },
  teal: { bg: 'bg-teal-500/10', text: 'text-teal-600 dark:text-teal-400', border: 'border-teal-500/20', dot: 'bg-teal-500' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-600 dark:text-violet-400', border: 'border-violet-500/20', dot: 'bg-violet-500' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-600 dark:text-cyan-400', border: 'border-cyan-500/20', dot: 'bg-cyan-500' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/20', dot: 'bg-rose-500' },
  fuchsia: { bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-600 dark:text-fuchsia-400', border: 'border-fuchsia-500/20', dot: 'bg-fuchsia-500' },
  indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-600 dark:text-indigo-400', border: 'border-indigo-500/20', dot: 'bg-indigo-500' },
  lime: { bg: 'bg-lime-500/10', text: 'text-lime-600 dark:text-lime-400', border: 'border-lime-500/20', dot: 'bg-lime-500' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-500/20', dot: 'bg-orange-500' },
  slate: { bg: 'bg-slate-500/10', text: 'text-slate-600 dark:text-slate-400', border: 'border-slate-500/20', dot: 'bg-slate-500' },
  gray: { bg: 'bg-gray-500/10', text: 'text-gray-600 dark:text-gray-400', border: 'border-gray-500/20', dot: 'bg-gray-500' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500/20', dot: 'bg-purple-500' },
};
const colorOf = (c: string) => COLOR[c] ?? COLOR.slate;
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

const PROVIDER_KIND_ICON: Record<ProviderKind, React.ReactNode> = {
  ORGANIZATION: <Building2 className="h-3.5 w-3.5" />, AI_MODEL: <Brain className="h-3.5 w-3.5" />, HUMAN: <User className="h-3.5 w-3.5" />, API: <Webhook className="h-3.5 w-3.5" />, IOT_DEVICE: <Cpu className="h-3.5 w-3.5" />, BANK: <Landmark className="h-3.5 w-3.5" />, GOVERNMENT: <Scale className="h-3.5 w-3.5" />, BLOCKCHAIN: <Box className="h-3.5 w-3.5" />,
};
const PROVIDER_KIND_COLOR: Record<ProviderKind, string> = {
  ORGANIZATION: 'emerald', AI_MODEL: 'violet', HUMAN: 'amber', API: 'sky', IOT_DEVICE: 'orange', BANK: 'teal', GOVERNMENT: 'rose', BLOCKCHAIN: 'fuchsia',
};

export function PlatformViewer({ initial }: { initial: PlatformDTO }) {
  const [data, setData] = useState<PlatformDTO>(initial);
  const [activeTab, setActiveTab] = useState('resolve');

  const refresh = useCallback(async () => {
    try {
      const [providers, memory, learning, overview] = await Promise.all([
        fetch('/api/economic-platform/providers').then((r) => r.json()),
        fetch('/api/economic-platform/memory?limit=30').then((r) => r.json()),
        fetch('/api/economic-platform/memory?view=learning').then((r) => r.json()),
        fetch('/api/economic-platform/overview').then((r) => r.json()),
      ]);
      setData((d) => ({ ...d, providers: providers.providers, memory: memory.memory, learning: learning.learning, overview: overview.overview }));
      toast.success('Platform refreshed');
    } catch { toast.error('Refresh failed'); }
  }, []);

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="resolve" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" />resolve()</TabsTrigger>
            <TabsTrigger value="market" className="gap-1.5"><GitBranch className="h-3.5 w-3.5" />Capability Market</TabsTrigger>
            <TabsTrigger value="graph" className="gap-1.5"><Network className="h-3.5 w-3.5" />Unified Graph</TabsTrigger>
            <TabsTrigger value="memory" className="gap-1.5"><BrainIcon className="h-3.5 w-3.5" />Self-Improving Memory</TabsTrigger>
          </TabsList>
          <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>
        </div>
        <TabsContent value="resolve" className="space-y-4"><ResolveTab data={data} onData={setData} /></TabsContent>
        <TabsContent value="market" className="space-y-4"><MarketTab data={data} /></TabsContent>
        <TabsContent value="graph" className="space-y-4"><GraphTab data={data} /></TabsContent>
        <TabsContent value="memory" className="space-y-4"><MemoryTab data={data} /></TabsContent>
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
// RESOLVE TAB — the hero: goal → graph search → heterogeneous providers compete
// ═══════════════════════════════════════════════════════════════════════════

function ResolveTab({ data, onData }: { data: PlatformDTO; onData: (d: PlatformDTO) => void }) {
  const [selectedGoalId, setSelectedGoalId] = useState(data.goals[0]?.id ?? '');
  const [resolving, setResolving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [stage, setStage] = useState('');
  const [proof, setProof] = useState<ProofDTO | null>(null);
  const [lastExec, setLastExec] = useState<{ status: string; learningUpdates: number; providerKinds: ProviderKind[]; satisfaction?: number } | null>(null);

  const selectedGoal = useMemo(() => data.goals.find((g) => g.id === selectedGoalId), [data.goals, selectedGoalId]);

  const resolve = async () => {
    if (!selectedGoal) return;
    setResolving(true); setProof(null); setLastExec(null);
    setStage('Graph search: finding capabilities that produce goal target…'); await new Promise((r) => setTimeout(r, 350));
    setStage('Market optimization: scoring competing providers per capability…'); await new Promise((r) => setTimeout(r, 450));
    setStage('Querying economic memory: biasing toward learned successes…'); await new Promise((r) => setTimeout(r, 350));
    setStage('Synthesizing economic proof…'); await new Promise((r) => setTimeout(r, 300));
    try {
      const res = await fetch('/api/economic-platform/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goalId: selectedGoal.id, constraints: selectedGoal.constraints }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Resolve failed');
      setProof(j.proof); setStage('');
      toast.success(`Resolved: ${j.proof.capabilityCount} capabilities · ${j.proof.providerCount} providers (${j.proof.providerKinds.length} kinds) · score ${j.proof.plannerScore}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Resolve failed'); setStage(''); }
    finally { setResolving(false); }
  };

  const execute = async () => {
    if (!proof) return;
    setExecuting(true);
    try {
      const res = await fetch('/api/economic-platform/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proofId: proof.id, constraints: selectedGoal?.constraints }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Execute failed');
      setLastExec({ status: j.status, learningUpdates: j.learningUpdates, providerKinds: proof.providerKinds, satisfaction: j.memoryRecord?.customerSatisfaction });
      toast.success(j.status === 'SETTLED' ? `Settled! ${j.providerIds.length} providers · ${j.learningUpdates} learning updates` : `Execution: ${j.status}`);
      // refresh providers + memory + learning (scores changed)
      const [providers, memory, learning] = await Promise.all([
        fetch('/api/economic-platform/providers').then((r) => r.json()),
        fetch('/api/economic-platform/memory?limit=30').then((r) => r.json()),
        fetch('/api/economic-platform/memory?view=learning').then((r) => r.json()),
      ]);
      onData({ ...data, providers: providers.providers, memory: memory.memory, learning: learning.learning });
      setProof((p) => p ? { ...p, status: j.status === 'SETTLED' ? 'settled' : 'verification_failed', verification: j.verification } : p);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Execute failed'); }
    finally { setExecuting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <KpiCard icon={<GitBranch className="h-4 w-4" />} tone="violet" label="Capabilities" value={fmtNum(data.overview.capabilityCount)} hint="the primitive" />
        <KpiCard icon={<Building2 className="h-4 w-4" />} tone="emerald" label="Providers" value={fmtNum(data.overview.providerCount)} hint={`${data.overview.providerKindCount} kinds`} />
        <KpiCard icon={<Network className="h-4 w-4" />} tone="sky" label="Graph Nodes" value={fmtNum(data.overview.graphNodeCount)} hint={`${data.overview.graphEdgeCount} edges`} />
        <KpiCard icon={<BrainIcon className="h-4 w-4" />} tone="amber" label="Memory" value={fmtNum(data.overview.memoryRecordCount)} hint="learned" />
        <KpiCard icon={<Activity className="h-4 w-4" />} tone="rose" label="Executions" value={fmtNum(data.overview.totalExecutions)} hint={`${data.overview.avgSuccessRate.toFixed(0)}% success`} />
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} tone="teal" label="Learning Entries" value={fmtNum(data.overview.learningEntries)} hint="provider scores" />
        <KpiCard icon={<DollarSign className="h-4 w-4" />} tone="cyan" label="Proofs Settled" value={fmtNum(data.overview.settledProofCount)} hint="all-time" />
      </div>

      {/* The resolve() API */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-violet-500" />resolve(goal) — graph search + market optimization</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label className="text-xs">Goal</Label>
              <Select value={selectedGoalId} onValueChange={setSelectedGoalId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {data.goals.map((g) => (
                    <SelectItem key={g.id} value={g.id}><span className="flex items-center gap-2"><Badge variant="outline" className="text-[9px]">{g.category}</Badge>{g.name}</span></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={resolve} disabled={resolving || !selectedGoal} className="gap-1.5">
                {resolving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {resolving ? 'Resolving…' : 'resolve()'}
              </Button>
            </div>
          </div>
          {selectedGoal && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="font-medium">{selectedGoal.description}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                <Badge className="bg-violet-500/15 text-violet-600 dark:text-violet-400">target: {selectedGoal.targetAsset}</Badge>
                {selectedGoal.inputs.map((i, idx) => <Badge key={idx} variant="outline" className="text-[9px]">input: {i.assetId} ×{i.amount}</Badge>)}
                {selectedGoal.constraints?.budget !== undefined && <Badge variant="outline" className="text-[9px]">budget ${selectedGoal.constraints.budget}</Badge>}
                {selectedGoal.constraints?.minTrust !== undefined && <Badge variant="outline" className="text-[9px]">minTrust {selectedGoal.constraints.minTrust}</Badge>}
                {selectedGoal.constraints?.jurisdiction && <Badge variant="outline" className="text-[9px]">jurisdiction {selectedGoal.constraints.jurisdiction}</Badge>}
              </div>
            </div>
          )}
          <AnimatePresence>
            {resolving && stage && (
              <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-md border border-violet-500/30 bg-violet-500/5 p-3 text-xs">
                <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400"><BrainIcon className="h-3.5 w-3.5 animate-pulse" /><span className="font-medium">{stage}</span></div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Discovered proof */}
      {proof && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-emerald-500" />Economic Proof</span>
              <div className="flex items-center gap-2 text-[10px] font-normal">
                <Badge className={proof.status === 'settled' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : proof.status === 'verification_failed' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-violet-500/15 text-violet-600 dark:text-violet-400'}>{proof.status}</Badge>
                <span className="text-muted-foreground">{proof.capabilityCount} capabilities · {proof.providerCount} providers</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-emerald-600 dark:text-emerald-400">score {proof.plannerScore}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-amber-600 dark:text-amber-400">{fmtUsd(proof.totalCost, 4)}</span>
                {proof.memoryHits !== undefined && proof.memoryHits > 0 && <><span className="text-muted-foreground">·</span><span className="text-sky-600 dark:text-sky-400">{proof.memoryHits} memory hits</span></>}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Provider kind heterogeneity signature */}
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Heterogeneous Provider Signature — {proof.providerKinds.length} distinct kinds competed</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {proof.providerKinds.map((k) => {
                  const c = colorOf(PROVIDER_KIND_COLOR[k]);
                  return <Badge key={k} className={`text-[9px] ${c.bg} ${c.text}`}>{PROVIDER_KIND_ICON[k]} {k}</Badge>;
                })}
              </div>
            </div>

            {/* Execution graph */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Capability Chain (graph search result)</div>
              {proof.nodes.map((n, i) => {
                const c = colorOf(n.kind === 'INPUT' ? 'slate' : n.kind === 'OUTPUT' ? 'emerald' : n.kind === 'OPPORTUNISTIC' ? 'fuchsia' : PROVIDER_KIND_COLOR[n.providerKind ?? 'ORGANIZATION']);
                return (
                  <motion.div key={n.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                    className={`rounded-md border p-2.5 text-xs ${n.kind === 'OPPORTUNISTIC' ? 'border-fuchsia-500/20 bg-fuchsia-500/5' : 'bg-card/40'}`}>
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-background text-[10px] font-bold">{i + 1}</span>
                      <Badge variant="outline" className="text-[8px]">{n.kind}</Badge>
                      {n.capabilityName && <Badge className={`text-[9px] ${c.bg} ${c.text}`}>{n.capabilityName}</Badge>}
                      {n.providerName && <span className="flex items-center gap-1 font-medium">{PROVIDER_KIND_ICON[n.providerKind ?? 'ORGANIZATION']}{n.providerName}</span>}
                      <span className="ml-auto flex items-center gap-2 text-[10px]">
                        {n.cost > 0 && <span className="text-emerald-600 dark:text-emerald-400">{fmtUsd(n.cost, 4)}</span>}
                        {n.latencyMs > 0 && <span className="text-muted-foreground">{n.latencyMs}ms</span>}
                        {n.carbon !== 0 && <span className={n.carbon < 0 ? 'text-lime-600 dark:text-lime-400' : 'text-amber-600 dark:text-amber-400'}>{n.carbon.toFixed(3)}CO₂</span>}
                      </span>
                    </div>
                    {n.reasoning && <div className="mt-1 pl-7 text-[10px] text-emerald-600 dark:text-emerald-400">{n.reasoning}</div>}
                    {n.alternatives && n.alternatives.length > 0 && (
                      <div className="mt-1 pl-7 text-[10px] text-muted-foreground">
                        <span className="font-medium">Alternatives considered:</span> {n.alternatives.map((a) => `${a.providerName} (${a.providerKind}, $${a.cost.toFixed(4)}, score ${a.reason.split('·')[1]?.trim() ?? '?'})`).join(' · ')}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>

            {/* Verification */}
            {proof.verification && (
              <div className={`rounded-md border p-3 ${proof.verification.allPassed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}>
                <div className="flex items-center gap-2 text-xs font-medium">
                  {proof.verification.allPassed ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-rose-500" />}
                  Verification: {proof.verification.allPassed ? 'ALL INVARIANTS PASSED' : `${proof.verification.criticalFailures} critical failures`}
                </div>
              </div>
            )}

            {proof.status === 'proposed' && (
              <Button onClick={execute} disabled={executing} className="w-full gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                {executing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {executing ? 'Executing…' : 'Verify + Execute + Learn'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Last execution + learning */}
      {lastExec && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4 text-amber-500" />Self-Improving Loop — measure() → learn() → update scores</CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div><div className="text-[9px] text-muted-foreground">Status</div><div className="font-semibold">{lastExec.status}</div></div>
              <div><div className="text-[9px] text-muted-foreground">Provider Kinds</div><div className="font-semibold">{lastExec.providerKinds.length}</div></div>
              <div><div className="text-[9px] text-muted-foreground">Satisfaction</div><div className="font-semibold">{lastExec.satisfaction ?? '?'}/100</div></div>
              <div><div className="text-[9px] text-muted-foreground">Learning Updates</div><div className="font-semibold text-amber-600 dark:text-amber-400">+{lastExec.learningUpdates}</div></div>
            </div>
            <div className="mt-2 rounded-md border bg-amber-500/5 p-2 text-[10px]">
              <span className="font-medium text-amber-600 dark:text-amber-400">→ The economy learned.</span>
              <span className="text-muted-foreground"> Provider reliability + learned scores updated. The next resolve() for this goal will be biased toward the path that just succeeded.</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CAPABILITY MARKET TAB — heterogeneous providers competing per capability
// ═══════════════════════════════════════════════════════════════════════════

function MarketTab({ data }: { data: PlatformDTO }) {
  // Group capabilities + show competing providers
  const byCapability = useMemo(() => {
    const m = new Map<string, { cap: CapabilityDTO; providers: Array<{ provider: ProviderDTO; offer: ProviderOfferDTO }> }>();
    for (const cap of data.capabilities) {
      const providers = data.providers
        .filter((p) => p.offers.some((o) => o.capabilityId === cap.id))
        .map((p) => ({ provider: p, offer: p.offers.find((o) => o.capabilityId === cap.id)! }));
      if (providers.length > 0) m.set(cap.id, { cap, providers });
    }
    return Array.from(m.values()).sort((a, b) => b.providers.length - a.providers.length);
  }, [data.capabilities, data.providers]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<GitBranch className="h-4 w-4" />} tone="violet" label="Capabilities" value={fmtNum(data.capabilities.length)} hint="market listings" />
        <KpiCard icon={<Building2 className="h-4 w-4" />} tone="emerald" label="Providers" value={fmtNum(data.providers.length)} hint="competing" />
        <KpiCard icon={<Trophy className="h-4 w-4" />} tone="amber" label="Most Competitive" value={fmtNum(Math.max(...byCapability.map((x) => x.providers.length), 0))} hint="providers on one capability" />
        <KpiCard icon={<Zap className="h-4 w-4" />} tone="sky" label="Provider Kinds" value={fmtNum(new Set(data.providers.map((p) => p.kind)).size)} hint="heterogeneous" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><GitBranch className="h-4 w-4 text-violet-500" />Capability Market — Heterogeneous Providers Compete</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-h-[600px] space-y-3 overflow-y-auto pr-1">
            {byCapability.map(({ cap, providers }) => {
              const cheapest = providers.reduce((min, x) => x.offer.pricePerInvocation < min.offer.pricePerInvocation ? x : min);
              const kinds = new Set(providers.map((x) => x.provider.kind));
              return (
                <div key={cap.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">{cap.name}</span>
                      <Badge variant="outline" className="text-[9px]">{cap.category}</Badge>
                      {cap.universal && <Badge className="bg-violet-500/15 text-[9px] text-violet-600 dark:text-violet-400">universal</Badge>}
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      <Badge className="bg-sky-500/15 text-sky-600 dark:text-sky-400">{providers.length} providers</Badge>
                      <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">{kinds.size} kinds</Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{cap.description}</p>
                  <div className="mt-2 space-y-1">
                    {providers.sort((a, b) => a.offer.pricePerInvocation - b.offer.pricePerInvocation).map(({ provider: p, offer: o }) => {
                      const isCheapest = o.pricePerInvocation === cheapest.offer.pricePerInvocation;
                      const c = colorOf(PROVIDER_KIND_COLOR[p.kind]);
                      return (
                        <div key={p.id} className={`flex items-center gap-3 rounded-md border p-2 text-xs ${isCheapest ? 'border-emerald-500/30 bg-emerald-500/5' : 'bg-card/40'}`}>
                          <span className={`flex h-6 w-6 items-center justify-center rounded ${c.bg} ${c.text}`}>{PROVIDER_KIND_ICON[p.kind]}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">{p.name}</span>
                              <Badge variant="outline" className="text-[8px]">{p.kind}</Badge>
                              {isCheapest && <Badge className="text-[8px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">cheapest</Badge>}
                            </div>
                            <div className="text-[10px] text-muted-foreground">trust {p.trustScore} · reliability {p.reliabilityScore} · SLA {(o.slaSuccessRate * 100).toFixed(2)}% · {o.region}</div>
                          </div>
                          <div className="flex items-center gap-3 text-[10px]">
                            <span className="flex items-center gap-1"><DollarSign className="h-3 w-3 text-emerald-500" />{o.pricePerInvocation.toFixed(4)}</span>
                            <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-amber-500" />{o.latencyMs}ms</span>
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
// UNIFIED GRAPH TAB — the only data structure
// ═══════════════════════════════════════════════════════════════════════════

function GraphTab({ data }: { data: PlatformDTO }) {
  const [hover, setHover] = useState<string | null>(null);
  const layout = useMemo(() => {
    const W = 1100, H = 580;
    const capabilities = data.graph.nodes.filter((n) => n.kind === 'CAPABILITY');
    const providers = data.graph.nodes.filter((n) => n.kind === 'PROVIDER');
    const assets = data.graph.nodes.filter((n) => n.kind === 'ASSET');
    const goals = data.graph.nodes.filter((n) => n.kind === 'GOAL');
    const pos = new Map<string, { x: number; y: number }>();
    const place = (nodes: GraphNodeDTO[], x: number) => {
      const step = nodes.length > 1 ? (H - 80) / (nodes.length - 1) : 0;
      const startY = nodes.length > 1 ? 40 : H / 2;
      nodes.forEach((n, i) => pos.set(n.id, { x, y: startY + i * step }));
    };
    place(goals, 60);
    place(providers, 280);
    place(capabilities, 580);
    place(assets, 900);
    return { pos, W, H };
  }, [data.graph]);

  const EDGE_COLOR: Record<string, string> = { offers: '#10b981', produces: '#8b5cf6', consumes: '#f59e0b', requires: '#0ea5e9' };
  const isFocused = (id: string) => !hover || hover === id || data.graph.edges.some((e) => (e.from === hover && e.to === id) || (e.to === hover && e.from === id));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<Network className="h-4 w-4" />} tone="sky" label="Graph Nodes" value={fmtNum(data.overview.graphNodeCount)} hint="unified" />
        <KpiCard icon={<GitBranch className="h-4 w-4" />} tone="violet" label="Graph Edges" value={fmtNum(data.overview.graphEdgeCount)} hint="typed relations" />
        <KpiCard icon={<Building2 className="h-4 w-4" />} tone="emerald" label="Providers" value={fmtNum(data.providers.length)} hint="in graph" />
        <KpiCard icon={<GitBranch className="h-4 w-4" />} tone="amber" label="Capabilities" value={fmtNum(data.capabilities.length)} hint="in graph" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Network className="h-4 w-4 text-sky-500" />Unified Graph — the only data structure</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
            {Object.entries(EDGE_COLOR).map(([k, c]) => (
              <span key={k} className="flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={c} strokeWidth="2" /></svg><span className="capitalize">{k}</span></span>
            ))}
            <span className="ml-auto">Hover a node to focus its connections.</span>
          </div>
          <div className="overflow-x-auto rounded-md border bg-gradient-to-br from-background to-muted/20">
            <svg width={layout.W} height={layout.H} className="min-w-full" style={{ minWidth: layout.W }}>
              {data.graph.edges.map((e, i) => {
                const from = layout.pos.get(e.from); const to = layout.pos.get(e.to);
                if (!from || !to) return null;
                const focused = !hover || e.from === hover || e.to === hover;
                const color = EDGE_COLOR[e.kind] ?? '#94a3b8';
                const midX = (from.x + to.x) / 2;
                const path = `M ${from.x + 22} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x - 22} ${to.y}`;
                return <path key={i} d={path} fill="none" stroke={color} strokeWidth={focused ? 1.5 : 0.8} strokeOpacity={focused ? 0.7 : 0.15} />;
              })}
              {data.graph.nodes.map((n) => {
                const p = layout.pos.get(n.id); if (!p) return null;
                const c = colorOf(n.color ?? 'slate');
                const focused = isFocused(n.id);
                const r = 20;
                return (
                  <g key={n.id} transform={`translate(${p.x - r}, ${p.y - r})`} style={{ cursor: 'pointer', opacity: focused ? 1 : 0.3 }}
                    onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}>
                    <rect width={r * 2} height={r * 2} rx={6} className={c.bg} stroke="currentColor" strokeWidth={1.5} />
                    <text x={r} y={r - 2} textAnchor="middle" className={`fill-current ${c.text} pointer-events-none select-none`} style={{ fontSize: 7, fontWeight: 700 }}>{n.kind.slice(0, 4)}</text>
                    <text x={r} y={r + 6} textAnchor="middle" className="fill-muted-foreground pointer-events-none select-none" style={{ fontSize: 6 }}>{n.label.slice(0, 12)}</text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground">
            Layout: Goals → Providers → Capabilities → Assets. Everything is a node; every relation is a typed edge. The planner does graph search over this structure.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SELF-IMPROVING MEMORY TAB
// ═══════════════════════════════════════════════════════════════════════════

function MemoryTab({ data }: { data: PlatformDTO }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<BrainIcon className="h-4 w-4" />} tone="amber" label="Memory Records" value={fmtNum(data.overview.memoryRecordCount)} hint="structured" />
        <KpiCard icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald" label="Success Rate" value={`${data.overview.avgSuccessRate.toFixed(0)}%`} hint="all executions" />
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} tone="violet" label="Learning Entries" value={fmtNum(data.overview.learningEntries)} hint="provider×capability" />
        <KpiCard icon={<Activity className="h-4 w-4" />} tone="rose" label="Total Executions" value={fmtNum(data.overview.totalExecutions)} hint="all-time" />
      </div>

      {/* Learned provider scores */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Award className="h-4 w-4 text-amber-500" />Learned Provider Scores (self-improving)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-y-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/50">
                <tr className="text-left">
                  <th className="p-2 font-medium">Provider</th><th className="p-2 font-medium">Capability</th>
                  <th className="p-2 text-right font-medium">Executions</th><th className="p-2 text-right font-medium">Success</th>
                  <th className="p-2 text-right font-medium">Avg Cost</th><th className="p-2 text-right font-medium">Satisfaction</th>
                  <th className="p-2 text-right font-medium">Learned Score</th><th className="p-2 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {data.learning.map((l, i) => (
                  <tr key={i} className="border-t hover:bg-muted/30">
                    <td className="p-2 font-medium">{l.providerName}</td>
                    <td className="p-2 font-mono text-[10px] text-muted-foreground">{l.capabilityId.replace('cap.', '')}</td>
                    <td className="p-2 text-right tabular-nums">{l.totalExecutions}</td>
                    <td className="p-2 text-right tabular-nums">{l.successRate.toFixed(0)}%</td>
                    <td className="p-2 text-right tabular-nums">{fmtUsd(l.avgCost, 4)}</td>
                    <td className="p-2 text-right tabular-nums">{l.avgSatisfaction.toFixed(0)}</td>
                    <td className="p-2 text-right"><span className="font-bold text-amber-600 dark:text-amber-400">{l.learnedScore}</span></td>
                    <td className="p-2"><Badge className={`text-[8px] ${l.trend === 'IMPROVING' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : l.trend === 'DECLINING' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-slate-500/15 text-slate-600 dark:text-slate-400'}`}>{l.trend}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Recent memory records */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><BrainIcon className="h-4 w-4 text-sky-500" />Economic Memory Log — structured capability-to-capability records</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
            {data.memory.map((m) => (
              <div key={m.id} className="rounded-md border p-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[8px] ${m.outcome === 'SUCCESS' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : m.outcome === 'FAILURE' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'}`}>{m.outcome}</Badge>
                    <span className="font-medium">{m.goalName}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{fmtTime(m.executedAt)}</span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span>{m.capabilities.length} capabilities</span>
                  <span>·</span>
                  <span>{m.providers.length} providers</span>
                  <span>·</span>
                  <span>{fmtUsd(m.totalCost, 4)}</span>
                  <span>·</span>
                  <span>{m.totalLatencyMs}ms</span>
                  <span>·</span>
                  <span>trust {m.trustScore}</span>
                  {m.customerSatisfaction !== undefined && <><span>·</span><span>satisfaction {m.customerSatisfaction}</span></>}
                  {m.context.jurisdiction && <><span>·</span><span>{m.context.jurisdiction}</span></>}
                  {m.context.timeOfDay && <><span>·</span><span>{m.context.timeOfDay}</span></>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
