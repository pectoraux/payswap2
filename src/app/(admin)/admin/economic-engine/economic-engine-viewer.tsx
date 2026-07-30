'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  Boxes, Coins, Puzzle, Workflow, Radio, Zap, ArrowRight, ArrowDown,
  CheckCircle2, XCircle, Play, Pause, Plus, RefreshCw, Sparkles,
  Network, Layers, Activity, Shield, TrendingUp, Eye,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// DTO TYPES — mirror the server-side serialization
// ═══════════════════════════════════════════════════════════════════════════

export type TokenKind = 'FUNGIBLE' | 'NON_FUNGIBLE' | 'SOULBOUND';
export type HolderType = 'EXTENSION' | 'USER' | 'MERCHANT' | 'CUSTOMER' | 'TREASURY' | 'LP';
export type TokenOpType = 'MINT' | 'BURN' | 'TRANSFER' | 'CONSUME';
export type ExtensionStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED';
export type PipelineStatus = 'ACTIVE' | 'PAUSED';
export type PipelineStepAction = 'mint' | 'burn' | 'consume' | 'transfer' | 'notify' | 'publish' | 'wait' | 'condition';
export type PipelineStepStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'RUNNING';
export type PipelineExecutionStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';
export type GraphNodeKind = 'EXTENSION' | 'TOKEN' | 'EVENT' | 'PIPELINE';
export type GraphEdgeKind = 'EMITS' | 'CONSUMES' | 'PUBLISHES' | 'SUBSCRIBES' | 'TRIGGERS';

export interface TokenDTO {
  id: string; symbol: string; name: string; issuer: string; kind: TokenKind;
  consumable: boolean; description: string; color: string;
  totalSupply: number; holderCount: number; mintCount: number; burnCount: number; consumeCount: number;
}
export interface BalanceDTO {
  tokenId: string; holderId: string; holderType: HolderType; holderLabel: string;
  balance: number; consumed: number; updatedAt: string;
}
export interface OperationDTO {
  id: string; tokenId: string; tokenSymbol: string; type: TokenOpType;
  from?: string; to?: string; toType?: HolderType; amount: number; reason: string;
  eventId: string; pipelineId?: string; ts: string;
}
export interface ExtensionManifestDTO {
  id: string; name: string; version: string; description: string; category: string;
  tokens: { emits: string[]; consumes: string[] };
  events: { publishes: string[]; subscribes: string[] };
  capabilities: string[];
}
export interface ExtensionDTO {
  id: string; name: string; version: string; status: ExtensionStatus;
  category: string; description: string; reputation: number;
  treasury: Record<string, number>;
  eventsPublished: number; eventsConsumed: number; tokensMinted: number; tokensConsumed: number;
  registeredAt: string; manifest: ExtensionManifestDTO;
}
export interface PipelineStepDTO {
  action: PipelineStepAction; token?: string; amount?: number | string;
  target?: string; targetType?: HolderType; event?: string;
  payload?: Record<string, unknown>; condition?: string; label?: string;
}
export interface PipelineDTO {
  id: string; name: string; description: string; trigger: string;
  filter?: Record<string, unknown>; steps: PipelineStepDTO[]; status: PipelineStatus;
  executions: number; successes: number; failures: number;
  lastExecutedAt: string | null; createdAt: string;
}
export interface StepResultDTO {
  stepIndex: number; action: PipelineStepAction; label?: string;
  status: PipelineStepStatus; detail: string; ts: string;
}
export interface ExecutionDTO {
  id: string; pipelineId: string; pipelineName: string; trigger: string;
  triggerEvent: { type: string; source: string; payload: Record<string, unknown>; ts: string };
  steps: StepResultDTO[]; status: PipelineExecutionStatus;
  startedAt: string; completedAt: string | null; durationMs?: number; cascadeDepth: number;
}
export interface EventDTO {
  id: string; type: string; source: string; tokenId?: string; tokenSymbol?: string;
  payload: Record<string, unknown>; ts: string; reactors: string[]; cascaded: boolean;
}
export interface GraphNodeDTO {
  id: string; kind: GraphNodeKind; label: string; sublabel?: string; group?: string; color?: string;
}
export interface GraphEdgeDTO { from: string; to: string; kind: GraphEdgeKind; }
export interface EconomicGraphDTO { nodes: GraphNodeDTO[]; edges: GraphEdgeDTO[]; }
export interface OverviewDTO {
  extensionCount: number; activeExtensionCount: number; tokenCount: number; totalSupply: number;
  pipelineCount: number; activePipelineCount: number; totalExecutions: number;
  successfulExecutions: number; failedExecutions: number; eventCount: number; cascadedEvents: number; operationCount: number;
}
export interface EconomicEngineDTO {
  tokens: TokenDTO[]; balances: BalanceDTO[]; operations: OperationDTO[];
  extensions: ExtensionDTO[]; pipelines: PipelineDTO[]; executions: ExecutionDTO[];
  events: EventDTO[]; graph: EconomicGraphDTO; overview: OverviewDTO;
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
};
function colorOf(c: string) { return COLOR_CLS[c] ?? COLOR_CLS.slate; }
function fmtNum(n: number, max = 0): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleString();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN VIEWER
// ═══════════════════════════════════════════════════════════════════════════

export function EconomicEngineViewer({ initial }: { initial: EconomicEngineDTO }) {
  const [data, setData] = useState<EconomicEngineDTO>(initial);
  const [activeTab, setActiveTab] = useState('overview');

  const refresh = useCallback(async () => {
    try {
      const [tokens, extensions, pipelines, executions, events, graph, overview] = await Promise.all([
        fetch('/api/economic/tokens').then((r) => r.json()),
        fetch('/api/economic/extensions').then((r) => r.json()),
        fetch('/api/economic/pipelines').then((r) => r.json()),
        fetch('/api/economic/pipelines?view=executions&limit=50').then((r) => r.json()),
        fetch('/api/economic/events?limit=80').then((r) => r.json()),
        fetch('/api/economic/graph').then((r) => r.json()),
        fetch('/api/economic/overview').then((r) => r.json()),
      ]);
      setData({
        tokens: tokens.tokens, balances: data.balances, operations: data.operations,
        extensions: extensions.extensions, pipelines: pipelines.pipelines,
        executions: executions.executions, events: events.events,
        graph: { nodes: graph.nodes, edges: graph.edges },
        overview: overview.overview,
      });
      toast.success('Economic engine refreshed');
    } catch {
      toast.error('Refresh failed');
    }
  }, [data.balances, data.operations]);

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="overview" className="gap-1.5"><Network className="h-3.5 w-3.5" />Overview</TabsTrigger>
            <TabsTrigger value="tokens" className="gap-1.5"><Coins className="h-3.5 w-3.5" />Tokens</TabsTrigger>
            <TabsTrigger value="extensions" className="gap-1.5"><Puzzle className="h-3.5 w-3.5" />Extensions</TabsTrigger>
            <TabsTrigger value="pipelines" className="gap-1.5"><Workflow className="h-3.5 w-3.5" />Pipelines</TabsTrigger>
            <TabsTrigger value="events" className="gap-1.5"><Radio className="h-3.5 w-3.5" />Events</TabsTrigger>
          </TabsList>
          <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </Button>
        </div>

        <TabsContent value="overview" className="space-y-4">
          <OverviewTab data={data} />
        </TabsContent>
        <TabsContent value="tokens" className="space-y-4">
          <TokensTab data={data} onData={setData} />
        </TabsContent>
        <TabsContent value="extensions" className="space-y-4">
          <ExtensionsTab data={data} />
        </TabsContent>
        <TabsContent value="pipelines" className="space-y-4">
          <PipelinesTab data={data} onData={setData} />
        </TabsContent>
        <TabsContent value="events" className="space-y-4">
          <EventsTab data={data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB — KPIs + the economic dependency graph + composition cascade
// ═══════════════════════════════════════════════════════════════════════════

function OverviewTab({ data }: { data: EconomicEngineDTO }) {
  const o = data.overview;
  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <KpiCard icon={<Puzzle className="h-4 w-4" />} tone="emerald" label="Extensions" value={fmtNum(o.extensionCount)} hint={`${o.activeExtensionCount} active`} />
        <KpiCard icon={<Coins className="h-4 w-4" />} tone="amber" label="Token Types" value={fmtNum(o.tokenCount)} hint={`${fmtNum(o.totalSupply)} total supply`} />
        <KpiCard icon={<Workflow className="h-4 w-4" />} tone="violet" label="Pipelines" value={fmtNum(o.pipelineCount)} hint={`${o.activePipelineCount} active`} />
        <KpiCard icon={<Activity className="h-4 w-4" />} tone="sky" label="Executions" value={fmtNum(o.totalExecutions)} hint={`${o.successfulExecutions} ok · ${o.failedExecutions} failed`} />
        <KpiCard icon={<Radio className="h-4 w-4" />} tone="rose" label="Events" value={fmtNum(o.eventCount)} hint={`${o.cascadedEvents} cascaded`} />
        <KpiCard icon={<Zap className="h-4 w-4" />} tone="teal" label="Operations" value={fmtNum(o.operationCount)} hint="mint/burn/transfer/consume" />
      </div>

      {/* The economic dependency graph */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-4 w-4 text-emerald-500" />
            Economic Dependency Graph
            <Badge variant="secondary" className="ml-1 text-[10px]">{data.graph.nodes.length} nodes · {data.graph.edges.length} edges</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DependencyGraph graph={data.graph} />
        </CardContent>
      </Card>

      {/* The composition cascade visualization */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-amber-500" />
            Composition Cascade
            <span className="text-xs font-normal text-muted-foreground">— one payment triggers six token emissions across five extensions, with zero direct coupling</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CascadeFlow />
        </CardContent>
      </Card>
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

// ── Dependency Graph (SVG) ──────────────────────────────────────────────────
// A force-free layered layout: extensions on the left, tokens in the middle,
// events on the right, pipelines on the far right. Edges curve between them.

function DependencyGraph({ graph }: { graph: EconomicGraphDTO }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    const W = 1100, H = 620;
    const extensions = graph.nodes.filter((n) => n.kind === 'EXTENSION').sort((a, b) => a.label.localeCompare(b.label));
    const tokens = graph.nodes.filter((n) => n.kind === 'TOKEN').sort((a, b) => a.label.localeCompare(b.label));
    const events = graph.nodes.filter((n) => n.kind === 'EVENT').sort((a, b) => a.label.localeCompare(b.label));
    const pipelines = graph.nodes.filter((n) => n.kind === 'PIPELINE').sort((a, b) => a.label.localeCompare(b.label));

    const colX = [60, 360, 680, 980];
    const pos = new Map<string, { x: number; y: number }>();

    const place = (nodes: GraphNodeDTO[], x: number, h: number) => {
      const step = nodes.length > 1 ? h / (nodes.length - 1) : 0;
      const startY = nodes.length > 1 ? 40 : h / 2;
      nodes.forEach((n, i) => pos.set(n.id, { x, y: startY + i * step }));
    };
    place(extensions, colX[0], H - 80);
    place(tokens, colX[1], H - 80);
    place(events, colX[2], H - 80);
    place(pipelines, colX[3], H - 80);

    return { pos, W, H, extensions, tokens, events, pipelines };
  }, [graph]);

  const EDGE_CLS: Record<GraphEdgeKind, { stroke: string; dash: string; label: string }> = {
    EMITS:      { stroke: '#10b981', dash: 'none',  label: 'emits' },
    CONSUMES:   { stroke: '#f59e0b', dash: '5,3',   label: 'consumes' },
    PUBLISHES:  { stroke: '#8b5cf6', dash: 'none',  label: 'publishes' },
    SUBSCRIBES: { stroke: '#0ea5e9', dash: '5,3',   label: 'subscribes' },
    TRIGGERS:   { stroke: '#ec4899', dash: 'none',  label: 'triggers' },
  };

  const nodeOf = (id: string) => graph.nodes.find((n) => n.id === id);
  const isFocused = (id: string) => {
    if (!selected && !hover) return true;
    const focus = hover ?? selected;
    if (focus === id) return true;
    // show connected nodes
    return graph.edges.some((e) => (e.from === focus && e.to === id) || (e.to === focus && e.from === id));
  };
  const edgeFocused = (e: GraphEdgeDTO) => {
    if (!selected && !hover) return true;
    const focus = hover ?? selected;
    return e.from === focus || e.to === focus;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        {(['EMITS', 'CONSUMES', 'PUBLISHES', 'SUBSCRIBES', 'TRIGGERS'] as GraphEdgeKind[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={EDGE_CLS[k].stroke} strokeWidth="2" strokeDasharray={EDGE_CLS[k].dash === 'none' ? undefined : EDGE_CLS[k].dash} /></svg>
            <span className="capitalize">{EDGE_CLS[k].label}</span>
          </span>
        ))}
        <span className="ml-auto">Click a node to focus its connections.</span>
      </div>
      <div className="overflow-x-auto rounded-md border bg-gradient-to-br from-background to-muted/20">
        <svg width={layout.W} height={layout.H} className="min-w-full" style={{ minWidth: layout.W }}>
          {/* edges */}
          {graph.edges.map((e, i) => {
            const from = layout.pos.get(e.from);
            const to = layout.pos.get(e.to);
            if (!from || !to) return null;
            const cls = EDGE_CLS[e.kind];
            const focused = edgeFocused(e);
            const midX = (from.x + to.x) / 2;
            const path = `M ${from.x + 18} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x - 18} ${to.y}`;
            return (
              <path key={i} d={path} fill="none"
                stroke={cls.stroke} strokeWidth={focused ? 2 : 1}
                strokeOpacity={focused ? 0.9 : 0.15}
                strokeDasharray={cls.dash === 'none' ? undefined : cls.dash} />
            );
          })}
          {/* nodes */}
          {graph.nodes.map((n) => {
            const p = layout.pos.get(n.id);
            if (!p) return null;
            const c = colorOf(n.color ?? 'slate');
            const kind = n.kind;
            const focused = isFocused(n.id);
            const r = kind === 'TOKEN' ? 16 : kind === 'EVENT' ? 14 : kind === 'PIPELINE' ? 15 : 18;
            return (
              <g key={n.id} transform={`translate(${p.x}, ${p.y})`}
                style={{ cursor: 'pointer', opacity: focused ? 1 : 0.25 }}
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                onClick={() => setSelected(selected === n.id ? null : n.id)}>
                {kind === 'EXTENSION' && (
                  <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={6}
                    className={`${c.bg}`} stroke="currentColor" strokeWidth={1.5}
                    style={{ color: `var(--tw-${n.color})` }} />
                )}
                {kind === 'TOKEN' && (
                  <circle r={r} className={c.bg} stroke="currentColor" strokeWidth={1.5} />
                )}
                {kind === 'EVENT' && (
                  <polygon points={`0,${-r} ${r},0 0,${r} ${-r},0`} className={c.bg} stroke="currentColor" strokeWidth={1.5} />
                )}
                {kind === 'PIPELINE' && (
                  <rect x={-r} y={-r * 0.7} width={r * 2} height={r * 1.4} rx={r * 0.7} className={c.bg} stroke="currentColor" strokeWidth={1.5} />
                )}
                <text textAnchor="middle" dy="0.35em" className={`fill-current ${c.text} pointer-events-none select-none`} style={{ fontSize: kind === 'EXTENSION' ? 9 : 8, fontWeight: 700 }}>
                  {n.label.slice(0, kind === 'EXTENSION' ? 4 : 5)}
                </text>
                <text textAnchor="middle" dy={r + 12} className="fill-muted-foreground pointer-events-none select-none" style={{ fontSize: 8 }}>
                  {n.sublabel ?? ''}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {selected && nodeOf(selected) && (
        <div className="rounded-md border bg-card/60 p-3 text-xs">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[9px]">{nodeOf(selected)!.kind}</Badge>
            <span className="font-semibold">{nodeOf(selected)!.label}</span>
            {nodeOf(selected)!.sublabel && <span className="text-muted-foreground">· {nodeOf(selected)!.sublabel}</span>}
          </div>
          <div className="mt-1.5 text-muted-foreground">
            {graph.edges.filter((e) => e.from === selected).length} outgoing · {graph.edges.filter((e) => e.to === selected).length} incoming
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cascade Flow — shows one payment triggering six token mints across extensions ──
function CascadeFlow() {
  const stages = [
    { label: 'payment.completed', sub: 'system event', color: 'sky', icon: <Radio className="h-3.5 w-3.5" /> },
    { label: 'treasury.reserve (RC)', sub: 'minted by treasury', color: 'teal', icon: <Coins className="h-3.5 w-3.5" /> },
    { label: 'rewards.points (RWP)', sub: 'minted by rewards', color: 'fuchsia', icon: <Coins className="h-3.5 w-3.5" /> },
    { label: 'marketplace.cashback (MCB)', sub: 'minted by marketplace', color: 'emerald', icon: <Coins className="h-3.5 w-3.5" /> },
    { label: 'loyalty.updated', sub: 'published by rewards', color: 'violet', icon: <Sparkles className="h-3.5 w-3.5" /> },
    { label: 'analytics notified', sub: 'side-channel', color: 'slate', icon: <Eye className="h-3.5 w-3.5" /> },
  ];
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {stages.map((s, i) => {
        const c = colorOf(s.color);
        return (
          <div key={i} className="flex items-center gap-2">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.08 }}
              className={`flex flex-col gap-1 rounded-lg border ${c.border} ${c.bg} p-3 min-w-[150px]`}>
              <div className={`flex items-center gap-1.5 ${c.text}`}>{s.icon}<span className="text-[10px] font-semibold uppercase tracking-wide">{c === null ? '' : ''}</span></div>
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

// ═══════════════════════════════════════════════════════════════════════════
// TOKENS TAB — registry + balances + operations
// ═══════════════════════════════════════════════════════════════════════════

function TokensTab({ data, onData }: { data: EconomicEngineDTO; onData: (d: EconomicEngineDTO) => void }) {
  const [selected, setSelected] = useState<TokenDTO | null>(null);
  const [mintOpen, setMintOpen] = useState(false);

  const balancesFor = useMemo(() => {
    if (!selected) return [];
    return data.balances.filter((b) => b.tokenId === selected.id);
  }, [data.balances, selected]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard icon={<Coins className="h-4 w-4" />} tone="amber" label="Token Types" value={fmtNum(data.tokens.length)} hint="programmable rights" />
        <KpiCard icon={<Layers className="h-4 w-4" />} tone="emerald" label="Fungible" value={fmtNum(data.tokens.filter((t) => t.kind === 'FUNGIBLE').length)} hint="divisible" />
        <KpiCard icon={<Shield className="h-4 w-4" />} tone="violet" label="Soulbound" value={fmtNum(data.tokens.filter((t) => t.kind === 'SOULBOUND').length)} hint="non-transferable" />
        <KpiCard icon={<Boxes className="h-4 w-4" />} tone="sky" label="NFT" value={fmtNum(data.tokens.filter((t) => t.kind === 'NON_FUNGIBLE').length)} hint="unique" />
        <KpiCard icon={<Zap className="h-4 w-4" />} tone="rose" label="Consumable" value={fmtNum(data.tokens.filter((t) => t.consumable).length)} hint="required by others" />
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} tone="teal" label="Total Supply" value={fmtNum(data.overview.totalSupply)} hint="all tokens" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2"><Coins className="h-4 w-4 text-amber-500" />Token Registry</span>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setMintOpen(true)} disabled={!selected}>
                <Plus className="h-3.5 w-3.5" />Mint
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[520px] overflow-y-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/50 backdrop-blur">
                  <tr className="text-left">
                    <th className="p-2 font-medium">Symbol</th>
                    <th className="p-2 font-medium">Name</th>
                    <th className="p-2 font-medium">Issuer</th>
                    <th className="p-2 font-medium">Kind</th>
                    <th className="p-2 text-right font-medium">Supply</th>
                    <th className="p-2 text-right font-medium">Holders</th>
                    <th className="p-2 text-right font-medium">Mints</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tokens.map((t) => {
                    const c = colorOf(t.color);
                    return (
                      <tr key={t.id} onClick={() => setSelected(t)}
                        className={`cursor-pointer border-t hover:bg-muted/30 ${selected?.id === t.id ? c.bg : ''}`}>
                        <td className="p-2">
                          <span className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${c.bg} ${c.text}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />{t.symbol}
                          </span>
                        </td>
                        <td className="p-2 font-medium">{t.name}</td>
                        <td className="p-2 text-muted-foreground">{t.issuer}</td>
                        <td className="p-2">
                          <Badge variant="outline" className="text-[9px]">{t.kind}</Badge>
                          {t.consumable && <Badge className="ml-1 bg-amber-500/15 text-[9px] text-amber-600 dark:text-amber-400">consumable</Badge>}
                        </td>
                        <td className="p-2 text-right tabular-nums">{fmtNum(t.totalSupply)}</td>
                        <td className="p-2 text-right tabular-nums">{t.holderCount}</td>
                        <td className="p-2 text-right tabular-nums">{t.mintCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {selected ? (
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${colorOf(selected.color).dot}`} />
                  {selected.symbol} — {selected.name}
                </span>
              ) : 'Select a token'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            {selected ? (
              <>
                <p className="text-muted-foreground">{selected.description}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Issuer" value={selected.issuer} />
                  <Stat label="Kind" value={selected.kind} />
                  <Stat label="Consumable" value={selected.consumable ? 'Yes' : 'No'} />
                  <Stat label="Total Supply" value={fmtNum(selected.totalSupply)} />
                  <Stat label="Holders" value={String(selected.holderCount)} />
                  <Stat label="Mints / Burns / Consumes" value={`${selected.mintCount} / ${selected.burnCount} / ${selected.consumeCount}`} />
                </div>
                <Separator />
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Holders ({balancesFor.length})</div>
                <ScrollArea className="max-h-[220px] rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/50">
                      <tr className="text-left"><th className="p-2 font-medium">Holder</th><th className="p-2 font-medium">Type</th><th className="p-2 text-right font-medium">Balance</th></tr>
                    </thead>
                    <tbody>
                      {balancesFor.map((b) => (
                        <tr key={b.holderId} className="border-t">
                          <td className="p-2 font-medium">{b.holderLabel}</td>
                          <td className="p-2"><Badge variant="outline" className="text-[9px]">{b.holderType}</Badge></td>
                          <td className="p-2 text-right tabular-nums">{fmtNum(b.balance)}</td>
                        </tr>
                      ))}
                      {balancesFor.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">No holders yet</td></tr>}
                    </tbody>
                  </table>
                </ScrollArea>
              </>
            ) : (
              <div className="py-8 text-center text-muted-foreground">Click a token in the registry to see its holders and lifecycle.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <MintDialog open={mintOpen} onOpenChange={setMintOpen} token={selected} onSuccess={() => {
        // refresh tokens + balances
        Promise.all([fetch('/api/economic/tokens').then((r) => r.json()), fetch('/api/economic/tokens?view=balances').then((r) => r.json())])
          .then(([t, b]) => onData({ ...data, tokens: t.tokens, balances: b.balances }))
          .catch(() => {});
      }} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card/40 p-2">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xs font-semibold">{value}</div>
    </div>
  );
}

function MintDialog({ open, onOpenChange, token, onSuccess }: { open: boolean; onOpenChange: (o: boolean) => void; token: TokenDTO | null; onSuccess: () => void }) {
  const [op, setOp] = useState<TokenOpType>('MINT');
  const [amount, setAmount] = useState('10');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/economic/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: op.toLowerCase(), tokenId: token.id, amount: Number(amount), to: to || undefined, from: to || undefined, toType: 'CUSTOMER' }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed');
      toast.success(`${op} ${amount} ${token.symbol}`);
      onOpenChange(false);
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Token Lifecycle — {token?.symbol}</DialogTitle>
          <DialogDescription>Mint, burn, transfer, or consume {token?.name}. This emits an economic event that cascades through subscribed extensions.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {(['MINT', 'BURN', 'TRANSFER', 'CONSUME'] as TokenOpType[]).map((o) => (
              <Button key={o} size="sm" variant={op === o ? 'default' : 'outline'} onClick={() => setOp(o)} className="text-[10px]">{o}</Button>
            ))}
          </div>
          <div>
            <Label className="text-xs">{op === 'BURN' || op === 'CONSUME' ? 'From (holder id)' : 'To (holder id)'}</Label>
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. cust_demo_001" className="text-xs" />
          </div>
          <div>
            <Label className="text-xs">Amount</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" className="text-xs" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>{loading ? '...' : `Execute ${op}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTENSIONS TAB — economic actors with treasuries + manifests
// ═══════════════════════════════════════════════════════════════════════════

function ExtensionsTab({ data }: { data: EconomicEngineDTO }) {
  const [selected, setSelected] = useState<ExtensionDTO | null>(null);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<Puzzle className="h-4 w-4" />} tone="emerald" label="Extensions" value={fmtNum(data.extensions.length)} hint={`${data.overview.activeExtensionCount} active`} />
        <KpiCard icon={<Activity className="h-4 w-4" />} tone="sky" label="Events Published" value={fmtNum(data.extensions.reduce((s, e) => s + e.eventsPublished, 0))} hint="lifecycle" />
        <KpiCard icon={<Eye className="h-4 w-4" />} tone="violet" label="Events Consumed" value={fmtNum(data.extensions.reduce((s, e) => s + e.eventsConsumed, 0))} hint="reactions" />
        <KpiCard icon={<Zap className="h-4 w-4" />} tone="amber" label="Avg Reputation" value={fmtNum(data.extensions.length ? data.extensions.reduce((s, e) => s + e.reputation, 0) / data.extensions.length : 0, 0)} hint="0–100" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {data.extensions.map((e) => {
          const c = colorOf(e.category);
          const isActive = e.status === 'ACTIVE';
          return (
            <Card key={e.id} className={`cursor-pointer transition-all hover:shadow-md ${selected?.id === e.id ? 'ring-2 ring-emerald-500/40' : ''}`} onClick={() => setSelected(e)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${c.bg} ${c.text}`}>
                      <Puzzle className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-bold">{e.name}</div>
                      <div className="text-[10px] text-muted-foreground">{e.category} · v{e.version}</div>
                    </div>
                  </div>
                  <Badge className={`text-[9px] ${isActive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-slate-500/15 text-slate-600 dark:text-slate-400'}`}>{e.status}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">{e.description}</p>
                <div className="mt-3 flex items-center gap-3 text-[10px]">
                  <span className="flex items-center gap-1"><Coins className="h-3 w-3 text-amber-500" />{e.manifest.tokens.emits.length} emits</span>
                  <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-rose-500" />{e.manifest.tokens.consumes.length} consumes</span>
                  <span className="flex items-center gap-1"><Radio className="h-3 w-3 text-violet-500" />{e.manifest.events.publishes.length} publishes</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">Reputation</span>
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-16 rounded-full bg-muted">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${e.reputation}%` }} />
                    </div>
                    <span className="font-semibold tabular-nums">{e.reputation}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-[480px] overflow-y-auto sm:max-w-[480px]">
          {selected && <ExtensionDetail ext={selected} tokens={data.tokens} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ExtensionDetail({ ext, tokens }: { ext: ExtensionDTO; tokens: TokenDTO[] }) {
  const c = colorOf(ext.category);
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${c.bg} ${c.text}`}><Puzzle className="h-4 w-4" /></div>
          {ext.name}
        </SheetTitle>
        <SheetDescription>{ext.category} · v{ext.version} · {ext.status}</SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-4 text-xs">
        <p className="text-muted-foreground">{ext.description}</p>

        <div className="grid grid-cols-2 gap-2">
          <Stat label="Events Published" value={String(ext.eventsPublished)} />
          <Stat label="Events Consumed" value={String(ext.eventsConsumed)} />
          <Stat label="Tokens Minted" value={fmtNum(ext.tokensMinted)} />
          <Stat label="Tokens Consumed" value={fmtNum(ext.tokensConsumed)} />
        </div>

        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tokens Emitted</div>
          <div className="flex flex-wrap gap-1.5">
            {ext.manifest.tokens.emits.map((id) => {
              const t = tokens.find((x) => x.id === id);
              return <Badge key={id} className={`text-[9px] ${colorOf(t?.color ?? 'slate').bg} ${colorOf(t?.color ?? 'slate').text}`}>{t?.symbol ?? id}</Badge>;
            })}
            {ext.manifest.tokens.emits.length === 0 && <span className="text-muted-foreground">— none —</span>}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tokens Consumed</div>
          <div className="flex flex-wrap gap-1.5">
            {ext.manifest.tokens.consumes.map((id) => {
              const t = tokens.find((x) => x.id === id);
              return <Badge key={id} variant="outline" className="text-[9px]">{t?.symbol ?? id}</Badge>;
            })}
            {ext.manifest.tokens.consumes.length === 0 && <span className="text-muted-foreground">— none —</span>}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Events Published</div>
          <div className="flex flex-wrap gap-1.5">
            {ext.manifest.events.publishes.map((e) => <Badge key={e} className="bg-violet-500/15 text-[9px] text-violet-600 dark:text-violet-400">{e}</Badge>)}
            {ext.manifest.events.publishes.length === 0 && <span className="text-muted-foreground">— none —</span>}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Events Subscribed</div>
          <div className="flex flex-wrap gap-1.5">
            {ext.manifest.events.subscribes.map((e) => <Badge key={e} className="bg-sky-500/15 text-[9px] text-sky-600 dark:text-sky-400">{e}</Badge>)}
            {ext.manifest.events.subscribes.length === 0 && <span className="text-muted-foreground">— none —</span>}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Capabilities</div>
          <div className="flex flex-wrap gap-1.5">
            {ext.manifest.capabilities.map((cap) => <Badge key={cap} variant="outline" className="text-[9px] font-mono">{cap}</Badge>)}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Treasury</div>
          {Object.keys(ext.treasury).length === 0 ? (
            <span className="text-muted-foreground">— empty —</span>
          ) : (
            <div className="space-y-1">
              {Object.entries(ext.treasury).map(([tid, bal]) => {
                const t = tokens.find((x) => x.id === tid);
                return (
                  <div key={tid} className="flex items-center justify-between rounded border bg-card/40 px-2 py-1">
                    <span className="font-medium">{t?.symbol ?? tid}</span>
                    <span className="tabular-nums">{fmtNum(bal)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINES TAB — pipeline list + trigger + execution trace viewer
// ═══════════════════════════════════════════════════════════════════════════

function PipelinesTab({ data, onData }: { data: EconomicEngineDTO; onData: (d: EconomicEngineDTO) => void }) {
  const [selected, setSelected] = useState<PipelineDTO | null>(null);
  const [triggerPipeline, setTriggerPipeline] = useState<PipelineDTO | null>(null);
  const [exec, setExec] = useState<ExecutionDTO | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    const [p, x] = await Promise.all([
      fetch('/api/economic/pipelines').then((r) => r.json()),
      fetch('/api/economic/pipelines?view=executions&limit=50').then((r) => r.json()),
    ]);
    onData({ ...data, pipelines: p.pipelines, executions: x.executions });
  };

  const trigger = async (p: PipelineDTO, payload: Record<string, unknown>) => {
    setLoading(true);
    try {
      const res = await fetch('/api/economic/pipelines/trigger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, payload }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Trigger failed');
      setExec(j.execution);
      toast.success(`Pipeline executed: ${j.execution.status}`);
      setTriggerPipeline(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Trigger failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<Workflow className="h-4 w-4" />} tone="violet" label="Pipelines" value={fmtNum(data.pipelines.length)} hint={`${data.overview.activePipelineCount} active`} />
        <KpiCard icon={<Play className="h-4 w-4" />} tone="emerald" label="Executions" value={fmtNum(data.overview.totalExecutions)} hint="all-time" />
        <KpiCard icon={<CheckCircle2 className="h-4 w-4" />} tone="teal" label="Success Rate" value={data.overview.totalExecutions ? `${Math.round((data.overview.successfulExecutions / data.overview.totalExecutions) * 100)}%` : '—'} hint={`${data.overview.successfulExecutions} ok`} />
        <KpiCard icon={<XCircle className="h-4 w-4" />} tone="rose" label="Failures" value={fmtNum(data.overview.failedExecutions)} hint="needs attention" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_440px]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Workflow className="h-4 w-4 text-violet-500" />Token Pipelines</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
              {data.pipelines.map((p) => (
                <div key={p.id} onClick={() => setSelected(p)}
                  className={`cursor-pointer rounded-lg border p-3 transition-all hover:shadow-sm ${selected?.id === p.id ? 'ring-1 ring-violet-500/40 bg-violet-500/5' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold">{p.name}</span>
                        <Badge className={`text-[9px] ${p.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-slate-500/15 text-slate-600 dark:text-slate-400'}`}>{p.status}</Badge>
                      </div>
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{p.description}</div>
                      <div className="mt-1.5 flex items-center gap-2 text-[10px]">
                        <Badge variant="outline" className="text-[9px] font-mono">on: {p.trigger}</Badge>
                        <span className="text-muted-foreground">{p.steps.length} steps</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-emerald-600 dark:text-emerald-400">{p.successes}✓</span>
                        <span className="text-rose-600 dark:text-rose-400">{p.failures}✗</span>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="shrink-0 gap-1 text-[10px]" onClick={(e) => { e.stopPropagation(); setTriggerPipeline(p); }}>
                      <Play className="h-3 w-3" />Trigger
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-emerald-500" />Execution Trace</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[460px]">
              <div className="space-y-2">
                {data.executions.map((e) => (
                  <div key={e.id} onClick={() => setExec(e)}
                    className={`cursor-pointer rounded-md border p-2.5 text-xs transition-all hover:shadow-sm ${exec?.id === e.id ? 'ring-1 ring-emerald-500/40' : ''}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{e.pipelineName}</span>
                      <Badge className={`text-[9px] ${e.status === 'COMPLETED' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : e.status === 'FAILED' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'}`}>{e.status}</Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="font-mono">{e.trigger}</span>
                      <span>·</span>
                      <span>{e.durationMs}ms</span>
                      <span>·</span>
                      <span>depth {e.cascadeDepth}</span>
                      <span>·</span>
                      <span>{fmtTime(e.startedAt)}</span>
                    </div>
                  </div>
                ))}
                {data.executions.length === 0 && <div className="py-8 text-center text-muted-foreground">No executions yet. Trigger a pipeline.</div>}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Execution detail sheet */}
      <Sheet open={!!exec} onOpenChange={(o) => !o && setExec(null)}>
        <SheetContent side="right" className="w-[520px] overflow-y-auto sm:max-w-[520px]">
          {exec && <ExecutionDetail exec={exec} pipeline={data.pipelines.find((p) => p.id === exec.pipelineId)} />}
        </SheetContent>
      </Sheet>

      {/* Pipeline detail sheet */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-[520px] overflow-y-auto sm:max-w-[520px]">
          {selected && <PipelineDetail p={selected} />}
        </SheetContent>
      </Sheet>

      {/* Trigger dialog */}
      <TriggerDialog pipeline={triggerPipeline} onClose={() => setTriggerPipeline(null)} onTrigger={trigger} loading={loading} />
    </div>
  );
}

function ExecutionDetail({ exec, pipeline }: { exec: ExecutionDTO; pipeline?: PipelineDTO }) {
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-500" />
          {exec.pipelineName}
        </SheetTitle>
        <SheetDescription>Execution trace · {exec.status} · {exec.durationMs}ms · cascade depth {exec.cascadeDepth}</SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-3 text-xs">
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Trigger Event</div>
          <div className="mt-1 font-mono text-[11px]">{exec.trigger}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">source: {exec.triggerEvent.source} · {fmtTime(exec.triggerEvent.ts)}</div>
          <pre className="mt-2 max-h-32 overflow-auto rounded bg-background p-2 text-[10px]">{JSON.stringify(exec.triggerEvent.payload, null, 2)}</pre>
        </div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Step Trace ({exec.steps.length})</div>
        <div className="space-y-2">
          {exec.steps.map((s, i) => {
            const icon = s.status === 'SUCCESS' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : s.status === 'FAILED' ? <XCircle className="h-3.5 w-3.5 text-rose-500" /> : <span className="text-[10px] text-muted-foreground">SKIP</span>;
            return (
              <div key={i} className={`rounded-md border p-2.5 ${s.status === 'FAILED' ? 'border-rose-500/30 bg-rose-500/5' : s.status === 'SUCCESS' ? 'border-emerald-500/20 bg-emerald-500/5' : 'bg-muted/20'}`}>
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-background text-[10px] font-bold">{i + 1}</span>
                  {icon}
                  <span className="font-mono text-[10px] uppercase">{s.action}</span>
                  {s.label && <span className="font-medium">{s.label}</span>}
                  <span className="ml-auto text-[10px] text-muted-foreground">{fmtTime(s.ts)}</span>
                </div>
                <div className="mt-1 pl-7 text-[10px] text-muted-foreground">{s.detail}</div>
              </div>
            );
          })}
        </div>
        {pipeline && (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Pipeline Definition</div>
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-background p-2 text-[10px]">{JSON.stringify({ name: pipeline.name, trigger: pipeline.trigger, filter: pipeline.filter, steps: pipeline.steps }, null, 2)}</pre>
          </div>
        )}
      </div>
    </>
  );
}

function PipelineDetail({ p }: { p: PipelineDTO }) {
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2"><Workflow className="h-4 w-4 text-violet-500" />{p.name}</SheetTitle>
        <SheetDescription>{p.status} · {p.executions} executions · {p.successes}✓ {p.failures}✗</SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-3 text-xs">
        <p className="text-muted-foreground">{p.description}</p>
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-[10px]">
            <span className="font-medium uppercase tracking-wide text-muted-foreground">Trigger:</span>
            <Badge variant="outline" className="font-mono text-[9px]">{p.trigger}</Badge>
            {p.filter && <Badge variant="outline" className="text-[9px]">filter: {JSON.stringify(p.filter)}</Badge>}
          </div>
        </div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Steps ({p.steps.length})</div>
        <div className="space-y-2">
          {p.steps.map((s, i) => (
            <div key={i} className="rounded-md border bg-card/40 p-2.5">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/15 text-[10px] font-bold text-violet-600 dark:text-violet-400">{i + 1}</span>
                <span className="font-mono text-[10px] uppercase text-violet-600 dark:text-violet-400">{s.action}</span>
                {s.label && <span className="font-medium">{s.label}</span>}
              </div>
              <div className="mt-1 pl-7 text-[10px] text-muted-foreground">
                {s.token && <span>token: <span className="font-mono">{s.token}</span> · </span>}
                {s.amount !== undefined && <span>amount: <span className="font-mono">{String(s.amount)}</span> · </span>}
                {s.target && <span>target: <span className="font-mono">{s.target}</span> · </span>}
                {s.event && <span>event: <span className="font-mono">{s.event}</span></span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function TriggerDialog({ pipeline, onClose, onTrigger, loading }: { pipeline: PipelineDTO | null; onClose: () => void; onTrigger: (p: PipelineDTO, payload: Record<string, unknown>) => void; loading: boolean }) {
  const [payloadStr, setPayloadStr] = useState('{\n  "amount": 100,\n  "customerId": "cust_demo_001",\n  "merchantId": "merch_demo_001",\n  "category": "retail"\n}');

  const submit = () => {
    if (!pipeline) return;
    try {
      const payload = JSON.parse(payloadStr);
      onTrigger(pipeline, payload);
    } catch {
      toast.error('Invalid JSON payload');
    }
  };

  return (
    <Dialog open={!!pipeline} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Trigger Pipeline — {pipeline?.name}</DialogTitle>
          <DialogDescription>Fires the pipeline with a synthetic event payload. The cascade will run through all matching steps and emit real token operations.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label className="text-xs">Event payload (JSON)</Label>
          <Textarea value={payloadStr} onChange={(e) => setPayloadStr(e.target.value)} rows={8} className="font-mono text-[11px]" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={loading} className="gap-1.5"><Play className="h-3.5 w-3.5" />{loading ? 'Executing...' : 'Execute'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENTS TAB — live economic event stream
// ═══════════════════════════════════════════════════════════════════════════

function EventsTab({ data }: { data: EconomicEngineDTO }) {
  const [filter, setFilter] = useState('');
  const [cascadedOnly, setCascadedOnly] = useState(false);

  const filtered = useMemo(() => {
    let rows = data.events;
    if (cascadedOnly) rows = rows.filter((e) => e.cascaded);
    if (filter) {
      const q = filter.toLowerCase();
      rows = rows.filter((e) => e.type.toLowerCase().includes(q) || e.source.toLowerCase().includes(q) || (e.tokenSymbol ?? '').toLowerCase().includes(q));
    }
    return rows;
  }, [data.events, filter, cascadedOnly]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<Radio className="h-4 w-4" />} tone="rose" label="Total Events" value={fmtNum(data.overview.eventCount)} hint="all-time" />
        <KpiCard icon={<Sparkles className="h-4 w-4" />} tone="violet" label="Cascaded" value={fmtNum(data.overview.cascadedEvents)} hint="triggered pipelines" />
        <KpiCard icon={<Coins className="h-4 w-4" />} tone="amber" label="Token Events" value={fmtNum(data.events.filter((e) => e.type.startsWith('token.')).length)} hint="mint/burn/consume" />
        <KpiCard icon={<Activity className="h-4 w-4" />} tone="emerald" label="Operations" value={fmtNum(data.overview.operationCount)} hint="ledger mutations" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2"><Radio className="h-4 w-4 text-rose-500" />Economic Event Stream</span>
            <div className="flex items-center gap-2">
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter by type/source/token..." className="h-8 w-48 text-xs" />
              <Button size="sm" variant={cascadedOnly ? 'default' : 'outline'} onClick={() => setCascadedOnly(!cascadedOnly)} className="gap-1 text-[10px]">
                <Sparkles className="h-3 w-3" />Cascaded only
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[520px] overflow-y-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/50 backdrop-blur">
                <tr className="text-left">
                  <th className="p-2 font-medium">Time</th>
                  <th className="p-2 font-medium">Type</th>
                  <th className="p-2 font-medium">Source</th>
                  <th className="p-2 font-medium">Token</th>
                  <th className="p-2 font-medium">Reactors</th>
                  <th className="p-2 font-medium">Cascaded</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-t hover:bg-muted/30">
                    <td className="p-2 text-muted-foreground">{fmtTime(e.ts)}</td>
                    <td className="p-2"><span className="font-mono text-[10px]">{e.type}</span></td>
                    <td className="p-2 text-muted-foreground">{e.source}</td>
                    <td className="p-2">{e.tokenSymbol ? <Badge variant="outline" className="text-[9px]">{e.tokenSymbol}</Badge> : '—'}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {e.reactors.slice(0, 3).map((r) => <Badge key={r} variant="outline" className="text-[9px]">{r}</Badge>)}
                        {e.reactors.length > 3 && <span className="text-[9px] text-muted-foreground">+{e.reactors.length - 3}</span>}
                      </div>
                    </td>
                    <td className="p-2">{e.cascaded ? <Sparkles className="h-3.5 w-3.5 text-violet-500" /> : <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No events match the filter.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Recent operations */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Zap className="h-4 w-4 text-amber-500" />Recent Token Operations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[300px] overflow-y-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/50">
                <tr className="text-left">
                  <th className="p-2 font-medium">Time</th>
                  <th className="p-2 font-medium">Op</th>
                  <th className="p-2 font-medium">Token</th>
                  <th className="p-2 font-medium">From → To</th>
                  <th className="p-2 text-right font-medium">Amount</th>
                  <th className="p-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.operations.map((o) => (
                  <tr key={o.id} className="border-t hover:bg-muted/30">
                    <td className="p-2 text-muted-foreground">{fmtTime(o.ts)}</td>
                    <td className="p-2"><Badge className={`text-[9px] ${o.type === 'MINT' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : o.type === 'BURN' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : o.type === 'CONSUME' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-sky-500/15 text-sky-600 dark:text-sky-400'}`}>{o.type}</Badge></td>
                    <td className="p-2 font-medium">{o.tokenSymbol}</td>
                    <td className="p-2 text-muted-foreground"><span className="font-mono text-[10px]">{o.from ?? '—'} → {o.to ?? '—'}</span></td>
                    <td className="p-2 text-right tabular-nums">{fmtNum(o.amount)}</td>
                    <td className="p-2 text-muted-foreground">{o.reason}</td>
                  </tr>
                ))}
                {data.operations.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No operations yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
