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
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  Cpu, Coins, Puzzle, Zap, ArrowRight, Play, RefreshCw, Network, Layers,
  Activity, Shield, TrendingUp, Sparkles, CheckCircle2, XCircle, GitBranch,
  DollarSign, Star, Brain, Award, Target, Trophy, AlertTriangle, FileCheck,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// DTO TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type Strategy = 'PAYMENT' | 'SCHOLARSHIP' | 'SPONSORSHIP' | 'VOUCHER' | 'STORED_CREDITS' | 'DEFERRED_FINANCE' | 'TOKENIZED_RIGHT' | 'DONATION' | 'GRANT' | 'TRADE' | 'INSURANCE' | 'SUBSCRIPTION';
export type OrgStatus = 'ACTIVE' | 'PAUSED' | 'SUSPENDED';
export type ProofStatus = 'proposed' | 'verified' | 'executing' | 'settled' | 'failed' | 'verification_failed';
export type ProofNodeKind = 'INPUT' | 'ORGANIZATION' | 'OUTPUT' | 'OPPORTUNISTIC';

export interface AssetBinding { assetId: string; amount: number; holderId?: string; }
export interface GoalDTO {
  id: string; name: string; description: string; category: string;
  targetAssetType: string; targetAsset?: string;
  inputs: AssetBinding[]; acceptableStrategies: Strategy[];
  createdAt: string;
}
export interface OrgPolicy { id: string; name: string; description: string; rule: string; enforcement: 'BLOCK' | 'WARN' | 'REQUIRE_APPROVAL'; }
export interface OrgObjective { id: string; description: string; type: 'MAXIMIZE_REVENUE' | 'MAXIMIZE_IMPACT' | 'MINIMIZE_RISK' | 'MAXIMIZE_TRUST' | 'GROWTH'; target: number; current: number; }
export interface GovernanceRule { id: string; name: string; description: string; rule: string; type: 'CONSENT' | 'MAJORITY' | 'AUTONOMOUS' | 'SUPERVISORY'; }
export interface OrganizationDTO {
  id: string; name: string; legalName: string; version: string; status: OrgStatus; category: string; description: string;
  produces: string[]; consumes: string[]; capabilities: string[]; policies: OrgPolicy[];
  treasury: Record<string, number>;
  revenue: number; costs: number; profit: number; profitTarget: number;
  balanceSheetAssets: number; balanceSheetLiabilities: number;
  reputation: number; trustScore: number;
  objectives: OrgObjective[]; governance: GovernanceRule[];
  workforceSize: number; reserveRequirement: number;
  invocations: number; successfulInvocations: number; failedInvocations: number; avgLatencyMs: number; carbonPerInvocation: number;
  registeredAt: string;
}
export interface ProofNodeDTO {
  id: string; kind: ProofNodeKind; organizationId?: string; organizationName?: string; capability?: string;
  produces: AssetBinding[]; consumes: AssetBinding[];
  cost: number; latencyMs: number; trustScore: number; carbon: number; risk: number;
  reasoning?: string;
}
export interface ProofEdgeDTO { from: string; to: string; assetId: string; amount: number; }
export interface ScoreBreakdown { dimension: string; score: number; weight: number; }
export interface InvariantCheckDTO {
  id: string; name: string; description: string;
  category: 'ASSET_CONSERVATION' | 'POLICY_COMPLIANCE' | 'TRUST_SATISFACTION' | 'SETTLEMENT_COMPLETENESS' | 'REGULATORY' | 'JURISDICTION';
  passed: boolean; detail: string; severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
}
export interface VerificationDTO {
  proofId: string; checks: InvariantCheckDTO[]; allPassed: boolean;
  criticalFailures: number; majorFailures: number; minorFailures: number; verifiedAt: string;
}
export interface ProofDTO {
  id: string; goalId: string; goalName: string; strategy: Strategy; strategyRationale: string;
  nodes: ProofNodeDTO[]; edges: ProofEdgeDTO[];
  totalCost: number; totalLatencyMs: number; trustScore: number; carbon: number; risk: number;
  organizationCount: number; opportunisticCount: number;
  plannerScore: number; scoreBreakdown: ScoreBreakdown[];
  status: ProofStatus; verification?: VerificationDTO;
  memoryHits?: number; predictedSuccessRate?: number;
  createdAt: string;
}
export interface MemoryEntryDTO {
  id: string; goalId: string; goalName: string; strategy: Strategy; proofId: string;
  organizationIds: string[]; totalCost: number; totalLatencyMs: number; trustScore: number; carbon: number;
  outcome: 'SUCCESS' | 'FAILURE' | 'PARTIAL'; failureReason?: string; customerSatisfaction?: number;
  executedAt: string; durationMs: number;
}
export interface CooperationDTO { orgA: string; orgB: string; jointExecutions: number; successRate: number; avgCost: number; avgLatencyMs: number; }
export interface StrategyEffectivenessDTO { strategy: Strategy; totalExecutions: number; successRate: number; avgCost: number; avgLatencyMs: number; avgTrust: number; avgSatisfaction: number; }
export interface ReliabilityDTO { organizationId: string; organizationName: string; totalExecutions: number; successRate: number; avgCost: number; avgLatencyMs: number; trend: 'IMPROVING' | 'STABLE' | 'DECLINING'; }
export interface OverviewDTO {
  organizationCount: number; activeOrganizationCount: number; goalCount: number;
  proofCount: number; settledProofCount: number; memoryEntries: number; avgSuccessRate: number;
  totalExecutions: number; totalRevenue: number; totalProfit: number; cooperationPairs: number; strategiesUsed: number;
}
export interface EconomicEngineDTO {
  goals: GoalDTO[]; organizations: OrganizationDTO[]; proofs: ProofDTO[];
  memory: MemoryEntryDTO[]; cooperation: CooperationDTO[]; strategies: StrategyEffectivenessDTO[]; reliability: ReliabilityDTO[];
  overview: OverviewDTO;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const COLOR_CLS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
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

const STRATEGY_COLOR: Record<Strategy, string> = {
  PAYMENT: 'emerald', SCHOLARSHIP: 'violet', SPONSORSHIP: 'sky', VOUCHER: 'amber',
  STORED_CREDITS: 'teal', DEFERRED_FINANCE: 'rose', TOKENIZED_RIGHT: 'fuchsia',
  DONATION: 'cyan', GRANT: 'indigo', TRADE: 'orange', INSURANCE: 'lime', SUBSCRIPTION: 'slate',
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN VIEWER
// ═══════════════════════════════════════════════════════════════════════════

export function ResolveViewer({ initial }: { initial: EconomicEngineDTO }) {
  const [data, setData] = useState<EconomicEngineDTO>(initial);
  const [activeTab, setActiveTab] = useState('resolve');

  const refresh = useCallback(async () => {
    try {
      const [orgs, proofs, memory, overview] = await Promise.all([
        fetch('/api/economic-engine/organizations').then((r) => r.json()),
        fetch('/api/economic-engine/proofs?limit=10').then((r) => r.json()),
        fetch('/api/economic-engine/memory?limit=30').then((r) => r.json()),
        fetch('/api/economic-engine/overview').then((r) => r.json()),
      ]);
      setData((d) => ({ ...d, organizations: orgs.organizations, proofs: proofs.proofs, memory: memory.memory, overview: overview.overview }));
      toast.success('Engine refreshed');
    } catch { toast.error('Refresh failed'); }
  }, []);

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="resolve" className="gap-1.5"><Cpu className="h-3.5 w-3.5" />resolve()</TabsTrigger>
            <TabsTrigger value="organizations" className="gap-1.5"><Puzzle className="h-3.5 w-3.5" />Organizations</TabsTrigger>
            <TabsTrigger value="memory" className="gap-1.5"><Brain className="h-3.5 w-3.5" />Memory</TabsTrigger>
            <TabsTrigger value="verification" className="gap-1.5"><FileCheck className="h-3.5 w-3.5" />Verification</TabsTrigger>
          </TabsList>
          <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>
        </div>

        <TabsContent value="resolve" className="space-y-4"><ResolveTab data={data} onData={setData} /></TabsContent>
        <TabsContent value="organizations" className="space-y-4"><OrganizationsTab data={data} /></TabsContent>
        <TabsContent value="memory" className="space-y-4"><MemoryTab data={data} /></TabsContent>
        <TabsContent value="verification" className="space-y-4"><VerificationTab data={data} /></TabsContent>
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
// RESOLVE TAB — the hero: goal → planner → multiple proofs → verify → execute
// ═══════════════════════════════════════════════════════════════════════════

function ResolveTab({ data, onData }: { data: EconomicEngineDTO; onData: (d: EconomicEngineDTO) => void }) {
  const [selectedGoalId, setSelectedGoalId] = useState(data.goals[0]?.id ?? '');
  const [constraints, setConstraints] = useState({ budget: '', deadline: '', minTrust: '', preferStrategy: '' as Strategy | '' });
  const [resolving, setResolving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [resolveStage, setResolveStage] = useState('');
  const [proofs, setProofs] = useState<ProofDTO[]>([]);
  const [selectedProof, setSelectedProof] = useState<ProofDTO | null>(null);
  const [lastExecution, setLastExecution] = useState<{ status: string; verification: VerificationDTO; strategy: Strategy; memoryEntry: MemoryEntryDTO } | null>(null);

  const selectedGoal = useMemo(() => data.goals.find((g) => g.id === selectedGoalId), [data.goals, selectedGoalId]);

  const resolve = async () => {
    if (!selectedGoal) return;
    setResolving(true); setProofs([]); setLastExecution(null); setSelectedProof(null);
    setResolveStage('Parsing goal…'); await new Promise((r) => setTimeout(r, 300));
    setResolveStage('Exploring strategies…'); await new Promise((r) => setTimeout(r, 400));
    setResolveStage('Synthesizing proof graphs…'); await new Promise((r) => setTimeout(r, 450));
    setResolveStage('Querying economic memory…'); await new Promise((r) => setTimeout(r, 350));
    setResolveStage('Scoring + ranking proofs…'); await new Promise((r) => setTimeout(r, 300));
    try {
      const c: Record<string, unknown> = {};
      if (constraints.budget) c.budget = Number(constraints.budget);
      if (constraints.deadline) c.deadline = Number(constraints.deadline);
      if (constraints.minTrust) c.minTrust = Number(constraints.minTrust);
      if (constraints.preferStrategy) c.preferStrategy = constraints.preferStrategy;
      const res = await fetch('/api/economic-engine/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalId: selectedGoal.id, constraints: c }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Resolve failed');
      setProofs(j.proofs);
      if (j.proofs[0]) setSelectedProof(j.proofs[0]);
      setResolveStage('');
      toast.success(`Resolved: ${j.proofs.length} proofs across ${j.totalStrategiesExplored} strategies (${j.planningMs}ms)`);
      onData({ ...data, proofs: [...j.proofs, ...data.proofs].slice(0, 10) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Resolve failed');
      setResolveStage('');
    } finally { setResolving(false); }
  };

  const execute = async () => {
    if (!selectedProof) return;
    setExecuting(true);
    try {
      const res = await fetch('/api/economic-engine/execute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proofId: selectedProof.id }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Execute failed');
      setLastExecution({ status: j.status, verification: j.verification, strategy: j.strategy, memoryEntry: j.memoryEntry });
      toast.success(j.status === 'SETTLED' ? `Settled! ${j.organizationIds.length} orgs · revenue $${j.totalRevenue.toFixed(4)}` : `Execution: ${j.status}`);
      // refresh orgs + memory (P&L + memory changed)
      const [orgs, memory] = await Promise.all([
        fetch('/api/economic-engine/organizations').then((r) => r.json()),
        fetch('/api/economic-engine/memory?limit=30').then((r) => r.json()),
      ]);
      onData({ ...data, organizations: orgs.organizations, memory: memory.memory });
      // update the selected proof's status + verification
      setSelectedProof((p) => p ? { ...p, status: j.status === 'SETTLED' ? 'settled' : 'verification_failed', verification: j.verification } : p);
      setProofs((ps) => ps.map((p) => p.id === selectedProof.id ? { ...p, status: j.status === 'SETTLED' ? 'settled' : 'verification_failed', verification: j.verification } : p));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Execute failed');
    } finally { setExecuting(false); }
  };

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <KpiCard icon={<Puzzle className="h-4 w-4" />} tone="emerald" label="Organizations" value={fmtNum(data.overview.organizationCount)} hint={`${data.overview.activeOrganizationCount} active`} />
        <KpiCard icon={<Target className="h-4 w-4" />} tone="violet" label="Goals" value={fmtNum(data.overview.goalCount)} hint="catalog" />
        <KpiCard icon={<Brain className="h-4 w-4" />} tone="sky" label="Memory" value={fmtNum(data.overview.memoryEntries)} hint="learned patterns" />
        <KpiCard icon={<Activity className="h-4 w-4" />} tone="rose" label="Executions" value={fmtNum(data.overview.totalExecutions)} hint={`${data.overview.avgSuccessRate.toFixed(0)}% success`} />
        <KpiCard icon={<GitBranch className="h-4 w-4" />} tone="amber" label="Strategies" value={fmtNum(data.overview.strategiesUsed)} hint="explored" />
        <KpiCard icon={<DollarSign className="h-4 w-4" />} tone="teal" label="Revenue" value={fmtUsd(data.overview.totalRevenue)} hint="cumulative" />
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} tone="cyan" label="Profit" value={fmtUsd(data.overview.totalProfit)} hint="net" />
      </div>

      {/* The resolve() API */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Cpu className="h-4 w-4 text-violet-500" />resolve(goal, constraints, policies)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label className="text-xs">Goal (implementation-agnostic)</Label>
              <Select value={selectedGoalId} onValueChange={setSelectedGoalId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {data.goals.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      <span className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[9px]">{g.category}</Badge>
                        {g.name}
                      </span>
                    </SelectItem>
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

          {/* Constraint editor */}
          <div className="grid gap-2 sm:grid-cols-4">
            <div>
              <Label className="text-[10px] text-muted-foreground">Budget ($)</Label>
              <Input value={constraints.budget} onChange={(e) => setConstraints({ ...constraints, budget: e.target.value })} placeholder="any" className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Deadline (ms)</Label>
              <Input value={constraints.deadline} onChange={(e) => setConstraints({ ...constraints, deadline: e.target.value })} placeholder="any" className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Min Trust</Label>
              <Input value={constraints.minTrust} onChange={(e) => setConstraints({ ...constraints, minTrust: e.target.value })} placeholder="0-100" className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Prefer Strategy</Label>
              <Select value={constraints.preferStrategy || 'none'} onValueChange={(v) => setConstraints({ ...constraints, preferStrategy: v === 'none' ? '' : v as Strategy })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No preference</SelectItem>
                  {selectedGoal?.acceptableStrategies.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedGoal && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="font-medium">{selectedGoal.description}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                <Badge className="bg-violet-500/15 text-violet-600 dark:text-violet-400">target: {selectedGoal.targetAsset ?? selectedGoal.targetAssetType}</Badge>
                <span className="text-muted-foreground">acceptable strategies:</span>
                {selectedGoal.acceptableStrategies.map((s) => {
                  const c = colorOf(STRATEGY_COLOR[s]);
                  return <Badge key={s} className={`text-[9px] ${c.bg} ${c.text}`}>{s}</Badge>;
                })}
              </div>
            </div>
          )}

          <AnimatePresence>
            {resolving && resolveStage && (
              <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="rounded-md border border-violet-500/30 bg-violet-500/5 p-3 text-xs">
                <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400">
                  <Brain className="h-3.5 w-3.5 animate-pulse" />
                  <span className="font-medium">{resolveStage}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Ranked proofs */}
      {proofs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-emerald-500" />Discovered Proofs ({proofs.length} strategies)</span>
              <span className="text-[10px] font-normal text-muted-foreground">ranked by planner score · click to select</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {proofs.map((p, idx) => {
                const c = colorOf(STRATEGY_COLOR[p.strategy]);
                const isBest = idx === 0;
                const isSel = selectedProof?.id === p.id;
                return (
                  <motion.div key={p.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: idx * 0.05 }}
                    onClick={() => setSelectedProof(p)}
                    className={`cursor-pointer rounded-lg border p-3 transition-all hover:shadow-md ${isSel ? 'ring-2 ring-emerald-500' : ''} ${c.bg} ${c.border}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {isBest && <Trophy className="h-3.5 w-3.5 text-amber-500" />}
                        <Badge className={`text-[9px] ${c.bg} ${c.text} border ${c.border}`}>{p.strategy}</Badge>
                      </div>
                      <span className={`text-lg font-bold ${c.text}`}>{p.plannerScore.toFixed(1)}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
                      <div><span className="text-muted-foreground">cost</span> <span className="font-semibold">{fmtUsd(p.totalCost, 4)}</span></div>
                      <div><span className="text-muted-foreground">latency</span> <span className="font-semibold">{p.totalLatencyMs}ms</span></div>
                      <div><span className="text-muted-foreground">trust</span> <span className="font-semibold">{p.trustScore}</span></div>
                      <div><span className="text-muted-foreground">carbon</span> <span className="font-semibold">{p.carbon.toFixed(3)}</span></div>
                      <div><span className="text-muted-foreground">risk</span> <span className="font-semibold">{p.risk}</span></div>
                      <div><span className="text-muted-foreground">orgs</span> <span className="font-semibold">{p.organizationCount}</span></div>
                    </div>
                    {p.memoryHits !== undefined && p.memoryHits > 0 && (
                      <div className="mt-1.5 flex items-center gap-1 text-[9px] text-muted-foreground">
                        <Brain className="h-2.5 w-2.5" />
                        <span>{p.memoryHits} memory hits · {p.predictedSuccessRate?.toFixed(0)}% predicted success</span>
                      </div>
                    )}
                    {/* Score breakdown bar */}
                    <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted">
                      {p.scoreBreakdown.map((b, i) => (
                        <div key={i} className={c.dot} style={{ width: `${(b.score / b.weight) * (b.weight / 100) * 100}%`, opacity: 0.4 + (b.score / b.weight) * 0.6 }} />
                      ))}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Selected proof detail + execute */}
      {selectedProof && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Network className="h-4 w-4 text-sky-500" />
                Proof: {selectedProof.strategy}
                <Badge className={`text-[9px] ${selectedProof.status === 'settled' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : selectedProof.status === 'verification_failed' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-violet-500/15 text-violet-600 dark:text-violet-400'}`}>{selectedProof.status}</Badge>
              </span>
              <Button onClick={execute} disabled={executing || selectedProof.status === 'settled'} size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                {executing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {executing ? 'Executing…' : selectedProof.status === 'settled' ? 'Settled' : 'Verify + Execute'}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Score breakdown */}
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {selectedProof.scoreBreakdown.map((b, i) => {
                const pct = (b.score / b.weight) * 100;
                const tone = pct >= 75 ? 'emerald' : pct >= 50 ? 'amber' : 'rose';
                const c = colorOf(tone);
                return (
                  <div key={i} className={`rounded-md border ${c.border} ${c.bg} p-2`}>
                    <div className="text-[9px] uppercase text-muted-foreground">{b.dimension}</div>
                    <div className={`text-sm font-bold ${c.text}`}>{b.score.toFixed(1)}<span className="text-[9px] text-muted-foreground">/{b.weight}</span></div>
                  </div>
                );
              })}
            </div>

            {/* Execution trace */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Execution Graph</div>
              {selectedProof.nodes.map((n, i) => {
                const c = colorOf(n.kind === 'INPUT' ? 'slate' : n.kind === 'OUTPUT' ? 'emerald' : n.kind === 'OPPORTUNISTIC' ? 'fuchsia' : STRATEGY_COLOR[selectedProof.strategy]);
                return (
                  <motion.div key={n.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                    className={`rounded-md border p-2.5 text-xs ${n.kind === 'OPPORTUNISTIC' ? 'border-fuchsia-500/20 bg-fuchsia-500/5' : 'bg-card/40'}`}>
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-background text-[10px] font-bold">{i + 1}</span>
                      <Badge variant="outline" className="text-[8px]">{n.kind}</Badge>
                      {n.organizationName && <span className="font-medium">{n.organizationName}</span>}
                      {n.capability && <Badge variant="outline" className="text-[9px] font-mono">{n.capability}</Badge>}
                      <span className="ml-auto flex items-center gap-2 text-[10px]">
                        {n.cost > 0 && <span className="text-emerald-600 dark:text-emerald-400">{fmtUsd(n.cost, 4)}</span>}
                        {n.latencyMs > 0 && <span className="text-muted-foreground">{n.latencyMs}ms</span>}
                        {n.carbon > 0 && <span className="text-lime-600 dark:text-lime-400">{n.carbon.toFixed(3)}CO₂</span>}
                      </span>
                    </div>
                    {n.reasoning && <div className="mt-1 pl-7 text-[10px] text-muted-foreground">{n.reasoning}</div>}
                  </motion.div>
                );
              })}
            </div>

            {/* Verification result */}
            {selectedProof.verification && (
              <div className={`rounded-md border p-3 ${selectedProof.verification.allPassed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}>
                <div className="flex items-center gap-2 text-xs font-medium">
                  {selectedProof.verification.allPassed ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-rose-500" />}
                  Verification: {selectedProof.verification.allPassed ? 'ALL INVARIANTS PASSED' : `${selectedProof.verification.criticalFailures} critical, ${selectedProof.verification.majorFailures} major failures`}
                </div>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  {selectedProof.verification.checks.map((chk) => (
                    <div key={chk.id} className="flex items-start gap-1.5 text-[10px]">
                      {chk.passed ? <CheckCircle2 className="h-3 w-3 mt-0.5 text-emerald-500 shrink-0" /> : <XCircle className="h-3 w-3 mt-0.5 text-rose-500 shrink-0" />}
                      <div>
                        <span className={`font-medium ${chk.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{chk.name}</span>
                        <span className="text-muted-foreground"> — {chk.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Last execution result */}
      {lastExecution && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-emerald-500" />Execution Result
              <Badge className={lastExecution.status === 'SETTLED' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'}>{lastExecution.status}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div><div className="text-[9px] text-muted-foreground">Strategy</div><div className="font-semibold">{lastExecution.strategy}</div></div>
              <div><div className="text-[9px] text-muted-foreground">Orgs</div><div className="font-semibold">{lastExecution.memoryEntry.organizationIds.length}</div></div>
              <div><div className="text-[9px] text-muted-foreground">Cost</div><div className="font-semibold">{fmtUsd(lastExecution.memoryEntry.totalCost, 4)}</div></div>
              <div><div className="text-[9px] text-muted-foreground">Satisfaction</div><div className="font-semibold">{lastExecution.memoryEntry.customerSatisfaction}/100</div></div>
            </div>
            <div className="mt-2 rounded-md border bg-muted/30 p-2 text-[10px]">
              <span className="text-muted-foreground">Recorded to economic memory · </span>
              <span className="font-medium">{lastExecution.memoryEntry.id}</span>
              <span className="text-muted-foreground"> · future resolves for this goal+strategy will bias toward this path</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ORGANIZATIONS TAB — autonomous economic entities
// ═══════════════════════════════════════════════════════════════════════════

function OrganizationsTab({ data }: { data: EconomicEngineDTO }) {
  const [selected, setSelected] = useState<OrganizationDTO | null>(null);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<Puzzle className="h-4 w-4" />} tone="emerald" label="Organizations" value={fmtNum(data.organizations.length)} hint={`${data.overview.activeOrganizationCount} active`} />
        <KpiCard icon={<DollarSign className="h-4 w-4" />} tone="teal" label="Total Revenue" value={fmtUsd(data.overview.totalRevenue)} hint="cumulative" />
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} tone="violet" label="Total Profit" value={fmtUsd(data.overview.totalProfit)} hint="net" />
        <KpiCard icon={<Award className="h-4 w-4" />} tone="amber" label="Workforce" value={fmtNum(data.organizations.reduce((s, o) => s + o.workforceSize, 0))} hint="across all orgs" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {data.organizations.map((o) => {
          const c = colorOf(o.category === 'identity' ? 'sky' : o.category === 'treasury' ? 'teal' : o.category === 'education' ? 'violet' : o.category === 'marketplace' ? 'emerald' : o.category === 'lending' ? 'amber' : o.category === 'scholarship' ? 'violet' : o.category === 'sponsor' ? 'sky' : o.category === 'voucher' ? 'amber' : o.category === 'rewards' ? 'fuchsia' : o.category === 'carbon' ? 'lime' : o.category === 'insurance' ? 'cyan' : o.category === 'employment' ? 'orange' : o.category === 'compliance' ? 'slate' : o.category === 'ai' ? 'indigo' : 'slate');
          const margin = o.revenue > 0 ? (o.profit / o.revenue) * 100 : 0;
          const profitPct = o.profitTarget > 0 ? Math.min(100, (o.profit / o.profitTarget) * 100) : 0;
          return (
            <Card key={o.id} className={`cursor-pointer transition-all hover:shadow-md ${selected?.id === o.id ? 'ring-2 ring-emerald-500/40' : ''}`} onClick={() => setSelected(o)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${c.bg} ${c.text}`}><Puzzle className="h-4 w-4" /></div>
                    <div>
                      <div className="text-sm font-bold">{o.name}</div>
                      <div className="text-[10px] text-muted-foreground">{o.legalName}</div>
                    </div>
                  </div>
                  <Badge className={`text-[9px] ${o.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-slate-500/15 text-slate-600 dark:text-slate-400'}`}>{o.status}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">{o.description}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                  <div><div className="text-muted-foreground">Revenue</div><div className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtUsd(o.revenue)}</div></div>
                  <div><div className="text-muted-foreground">Profit</div><div className={`font-semibold ${o.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{fmtUsd(o.profit)}</div></div>
                  <div><div className="text-muted-foreground">Workforce</div><div className="font-semibold">{o.workforceSize}</div></div>
                </div>
                {/* Profit target progress */}
                {o.profitTarget > 0 && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                      <span>Profit target</span><span>{fmtUsd(o.profit)} / {fmtUsd(o.profitTarget)}</span>
                    </div>
                    <div className="mt-0.5 h-1 rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${profitPct}%` }} /></div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-[520px] overflow-y-auto sm:max-w-[520px]">
          {selected && <OrgDetail org={selected} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function OrgDetail({ org: o }: { org: OrganizationDTO }) {
  const margin = o.revenue > 0 ? (o.profit / o.revenue) * 100 : 0;
  return (
    <>
      <SheetHeader>
        <SheetTitle>{o.name}</SheetTitle>
        <SheetDescription>{o.legalName} · v{o.version} · {o.status}</SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-4 text-xs">
        <p className="text-muted-foreground">{o.description}</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border bg-card/40 p-2"><div className="text-[9px] uppercase text-muted-foreground">Revenue</div><div className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtUsd(o.revenue)}</div></div>
          <div className="rounded-md border bg-card/40 p-2"><div className="text-[9px] uppercase text-muted-foreground">Profit Target</div><div className="font-semibold">{fmtUsd(o.profitTarget)}</div></div>
          <div className="rounded-md border bg-card/40 p-2"><div className="text-[9px] uppercase text-muted-foreground">Workforce</div><div className="font-semibold">{o.workforceSize}</div></div>
          <div className="rounded-md border bg-card/40 p-2"><div className="text-[9px] uppercase text-muted-foreground">Carbon/invocation</div><div className="font-semibold">{o.carbonPerInvocation.toFixed(3)} kgCO₂e</div></div>
        </div>
        {/* Objectives */}
        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Objectives</div>
          <div className="space-y-1.5">
            {o.objectives.map((obj) => {
              const pct = obj.target > 0 ? Math.min(100, (obj.current / obj.target) * 100) : 0;
              return (
                <div key={obj.id} className="rounded-md border bg-card/40 p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{obj.description}</span>
                    <Badge variant="outline" className="text-[8px]">{obj.type.replace('_', ' ')}</Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px]">
                    <div className="h-1 flex-1 rounded-full bg-muted"><div className="h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} /></div>
                    <span className="tabular-nums">{fmtNum(obj.current)} / {fmtNum(obj.target)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {/* Governance */}
        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Governance</div>
          <div className="space-y-1">
            {o.governance.map((g) => (
              <div key={g.id} className="rounded-md border bg-card/40 p-2">
                <div className="flex items-center gap-2">
                  <Badge className={`text-[8px] ${g.type === 'AUTONOMOUS' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : g.type === 'SUPERVISORY' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : g.type === 'CONSENT' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-sky-500/15 text-sky-600 dark:text-sky-400'}`}>{g.type}</Badge>
                  <span className="font-medium">{g.name}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{g.description}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Produces</div>
          <div className="flex flex-wrap gap-1.5">{o.produces.map((p) => <Badge key={p} className="bg-emerald-500/15 text-[9px] text-emerald-600 dark:text-emerald-400">{p}</Badge>)}</div>
        </div>
        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Consumes</div>
          <div className="flex flex-wrap gap-1.5">{o.consumes.map((p) => <Badge key={p} className="bg-amber-500/15 text-[9px] text-amber-600 dark:text-amber-400">{p}</Badge>)}</div>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MEMORY TAB — the adaptive learning layer
// ═══════════════════════════════════════════════════════════════════════════

function MemoryTab({ data }: { data: EconomicEngineDTO }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<Brain className="h-4 w-4" />} tone="sky" label="Memory Entries" value={fmtNum(data.overview.memoryEntries)} hint="learned patterns" />
        <KpiCard icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald" label="Success Rate" value={`${data.overview.avgSuccessRate.toFixed(0)}%`} hint="all executions" />
        <KpiCard icon={<GitBranch className="h-4 w-4" />} tone="violet" label="Strategies Used" value={fmtNum(data.overview.strategiesUsed)} hint="explored" />
        <KpiCard icon={<Network className="h-4 w-4" />} tone="amber" label="Cooperation Pairs" value={fmtNum(data.overview.cooperationPairs)} hint="org pairs" />
      </div>

      {/* Strategy effectiveness */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4 text-violet-500" />Strategy Effectiveness (learned)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2 font-medium">Strategy</th>
                  <th className="p-2 text-right font-medium">Executions</th>
                  <th className="p-2 text-right font-medium">Success</th>
                  <th className="p-2 text-right font-medium">Avg Cost</th>
                  <th className="p-2 text-right font-medium">Avg Latency</th>
                  <th className="p-2 text-right font-medium">Avg Trust</th>
                  <th className="p-2 text-right font-medium">Satisfaction</th>
                </tr>
              </thead>
              <tbody>
                {data.strategies.map((s) => {
                  const c = colorOf(STRATEGY_COLOR[s.strategy]);
                  return (
                    <tr key={s.strategy} className="border-t hover:bg-muted/30">
                      <td className="p-2"><Badge className={`text-[9px] ${c.bg} ${c.text}`}>{s.strategy}</Badge></td>
                      <td className="p-2 text-right tabular-nums">{s.totalExecutions}</td>
                      <td className="p-2 text-right tabular-nums">
                        <span className={s.successRate >= 80 ? 'text-emerald-600 dark:text-emerald-400' : s.successRate >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}>{s.successRate.toFixed(0)}%</span>
                      </td>
                      <td className="p-2 text-right tabular-nums">{fmtUsd(s.avgCost, 4)}</td>
                      <td className="p-2 text-right tabular-nums">{Math.round(s.avgLatencyMs)}ms</td>
                      <td className="p-2 text-right tabular-nums">{s.avgTrust.toFixed(0)}</td>
                      <td className="p-2 text-right tabular-nums">{s.avgSatisfaction.toFixed(0)}/100</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Organization reliability */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Award className="h-4 w-4 text-amber-500" />Organization Reliability (learned)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2 font-medium">Organization</th>
                  <th className="p-2 text-right font-medium">Executions</th>
                  <th className="p-2 text-right font-medium">Success</th>
                  <th className="p-2 text-right font-medium">Avg Cost</th>
                  <th className="p-2 text-right font-medium">Avg Latency</th>
                  <th className="p-2 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {data.reliability.map((r) => (
                  <tr key={r.organizationId} className="border-t hover:bg-muted/30">
                    <td className="p-2 font-medium">{r.organizationName}</td>
                    <td className="p-2 text-right tabular-nums">{r.totalExecutions}</td>
                    <td className="p-2 text-right tabular-nums">{r.successRate.toFixed(0)}%</td>
                    <td className="p-2 text-right tabular-nums">{fmtUsd(r.avgCost, 4)}</td>
                    <td className="p-2 text-right tabular-nums">{Math.round(r.avgLatencyMs)}ms</td>
                    <td className="p-2">
                      <Badge className={`text-[9px] ${r.trend === 'IMPROVING' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : r.trend === 'DECLINING' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-slate-500/15 text-slate-600 dark:text-slate-400'}`}>{r.trend}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Cooperation scores */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Network className="h-4 w-4 text-sky-500" />Organization Cooperation (learned)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-80 overflow-y-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/50">
                <tr className="text-left">
                  <th className="p-2 font-medium">Pair</th>
                  <th className="p-2 text-right font-medium">Joint Executions</th>
                  <th className="p-2 text-right font-medium">Success</th>
                  <th className="p-2 text-right font-medium">Avg Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.cooperation.map((c, i) => (
                  <tr key={i} className="border-t hover:bg-muted/30">
                    <td className="p-2 font-mono text-[10px]">{c.orgA} ↔ {c.orgB}</td>
                    <td className="p-2 text-right tabular-nums">{c.jointExecutions}</td>
                    <td className="p-2 text-right tabular-nums">{c.successRate.toFixed(0)}%</td>
                    <td className="p-2 text-right tabular-nums">{fmtUsd(c.avgCost, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Recent memory entries */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Brain className="h-4 w-4 text-sky-500" />Recent Executions (memory log)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
            {data.memory.map((m) => (
              <div key={m.id} className="rounded-md border p-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[8px] ${m.outcome === 'SUCCESS' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : m.outcome === 'FAILURE' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'}`}>{m.outcome}</Badge>
                    <Badge variant="outline" className="text-[8px]">{m.strategy}</Badge>
                    <span className="font-medium">{m.goalName}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{fmtTime(m.executedAt)}</span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span>{m.organizationIds.length} orgs</span>
                  <span>·</span>
                  <span>{fmtUsd(m.totalCost, 4)}</span>
                  <span>·</span>
                  <span>{m.totalLatencyMs}ms</span>
                  <span>·</span>
                  <span>trust {m.trustScore}</span>
                  {m.customerSatisfaction !== undefined && <><span>·</span><span>satisfaction {m.customerSatisfaction}</span></>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION TAB — economic proofs + invariant checks
// ═══════════════════════════════════════════════════════════════════════════

function VerificationTab({ data }: { data: EconomicEngineDTO }) {
  const verified = data.proofs.filter((p) => p.verification);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<FileCheck className="h-4 w-4" />} tone="emerald" label="Proofs" value={fmtNum(data.proofs.length)} hint="discovered" />
        <KpiCard icon={<CheckCircle2 className="h-4 w-4" />} tone="teal" label="Verified" value={fmtNum(verified.length)} hint="with invariant checks" />
        <KpiCard icon={<Shield className="h-4 w-4" />} tone="violet" label="Settled" value={fmtNum(data.proofs.filter((p) => p.status === 'settled').length)} hint="successfully executed" />
        <KpiCard icon={<AlertTriangle className="h-4 w-4" />} tone="rose" label="Failed" value={fmtNum(data.proofs.filter((p) => p.status === 'verification_failed' || p.status === 'failed').length)} hint="verification or execution" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><FileCheck className="h-4 w-4 text-emerald-500" />Economic Proofs — Invariant Verification</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {verified.length === 0 && <div className="py-12 text-center text-muted-foreground text-sm">No verified proofs yet. resolve() a goal and execute a proof.</div>}
            {verified.map((p) => (
              <div key={p.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[9px] ${p.status === 'settled' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : p.status === 'verification_failed' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-violet-500/15 text-violet-600 dark:text-violet-400'}`}>{p.status}</Badge>
                    <Badge variant="outline" className="text-[9px]">{p.strategy}</Badge>
                    <span className="text-sm font-bold">{p.goalName}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    {p.verification?.allPassed ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-rose-500" />}
                    <span className="text-muted-foreground">{p.verification?.checks.length} invariants checked</span>
                  </div>
                </div>
                {p.verification && (
                  <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {p.verification.checks.map((chk) => (
                      <div key={chk.id} className="flex items-start gap-1.5 text-[10px] rounded border bg-card/40 p-1.5">
                        {chk.passed ? <CheckCircle2 className="h-3 w-3 mt-0.5 text-emerald-500 shrink-0" /> : <XCircle className="h-3 w-3 mt-0.5 text-rose-500 shrink-0" />}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <span className={`font-medium ${chk.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{chk.name}</span>
                            <Badge variant="outline" className="text-[7px]">{chk.severity}</Badge>
                          </div>
                          <div className="text-muted-foreground truncate">{chk.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
