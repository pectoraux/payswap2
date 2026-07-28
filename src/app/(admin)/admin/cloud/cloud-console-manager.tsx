'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Cloud, Building2, Landmark, Code2, Briefcase, Plus, RefreshCw,
  Search, Filter, ExternalLink, MoreHorizontal, Users2, Rocket,
  Pause, Play, Archive, CreditCard, Activity, FileText, Shield,
  Loader2, ChevronRight, AlertTriangle, CheckCircle2, XCircle,
  Clock, Server, Settings2, TrendingUp, Globe, Copy, Ban,
  RotateCcw, Crown, Wrench, Eye, Terminal, AlertCircle, ArrowUpCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { EmptyState } from '@/components/empty-state';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type {
  CloudTenantType, CloudPlan, CloudTenantStatus, CloudTenantRole,
  CloudTenant, CloudTenantMember, CloudProgram, CloudProgramStatus,
  CloudDeployment, CloudDeploymentEnvironment, CloudDeploymentStatus,
  CloudDeploymentHealth, CloudSubscription, CloudUsage,
  CloudAuditEntry, CloudComplianceRegion,
} from '@/cloud';
import { CLOUD_PLAN_CATALOGUE, CLOUD_REGIONS } from '@/cloud';

// ─── Public summary types ───────────────────────────────────────────────────

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  type: CloudTenantType;
  plan: CloudPlan;
  region: string;
  status: CloudTenantStatus;
  ownerId: string;
  createdAt: number;
  memberCount: number;
  usage: CloudUsage;
  suspendedReason?: string;
  terminatedReason?: string;
}

export interface CloudOverviewSnapshot {
  totalTenants: number;
  byType: Record<CloudTenantType, number>;
  byPlan: Record<CloudPlan, number>;
  byStatus: Record<CloudTenantStatus, number>;
  totalMembers: number;
  totalPrograms: number;
  totalDeployments: number;
  totalSubscriptions: number;
  totalMrr: number;
  currency: string;
}

// ─── Tenant detail response (from /api/cloud/tenants/[id]) ──────────────────

interface TenantDetailResponse {
  tenant: CloudTenant;
  programs: CloudProgram[];
  deployments: CloudDeployment[];
  subscription: CloudSubscription | null;
  audit: CloudAuditEntry[];
}

// ─── Metadata maps ──────────────────────────────────────────────────────────

const TYPE_META: Record<CloudTenantType, { label: string; icon: typeof Building2; tone: string }> = {
  organization: { label: 'Organization', icon: Building2, tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  government: { label: 'Government', icon: Landmark, tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20' },
  developer_org: { label: 'Developer Org', icon: Code2, tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20' },
  enterprise: { label: 'Enterprise', icon: Briefcase, tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
};

const PLAN_META: Record<CloudPlan, { label: string; tone: string }> = {
  free: { label: 'Free', tone: 'bg-muted text-muted-foreground border-border' },
  starter: { label: 'Starter', tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20' },
  growth: { label: 'Growth', tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  scale: { label: 'Scale', tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
  enterprise: { label: 'Enterprise', tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20' },
};

const STATUS_META: Record<CloudTenantStatus, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  active: { label: 'Active', tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20', icon: CheckCircle2 },
  suspended: { label: 'Suspended', tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20', icon: Pause },
  terminated: { label: 'Terminated', tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20', icon: XCircle },
};

const ROLE_META: Record<CloudTenantRole, { label: string; icon: typeof Crown; tone: string }> = {
  owner: { label: 'Owner', icon: Crown, tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20' },
  admin: { label: 'Admin', icon: Shield, tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
  developer: { label: 'Developer', icon: Code2, tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20' },
  operator: { label: 'Operator', icon: Wrench, tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  viewer: { label: 'Viewer', icon: Eye, tone: 'bg-muted text-muted-foreground border-border' },
};

const DEPLOY_HEALTH_META: Record<CloudDeploymentHealth, { label: string; tone: string; icon: typeof Activity }> = {
  healthy: { label: 'Healthy', tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20', icon: CheckCircle2 },
  degraded: { label: 'Degraded', tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20', icon: AlertTriangle },
  down: { label: 'Down', tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20', icon: XCircle },
};

const DEPLOY_STATUS_META: Record<CloudDeploymentStatus, { label: string; tone: string }> = {
  running: { label: 'Running', tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  deploying: { label: 'Deploying', tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20' },
  stopped: { label: 'Stopped', tone: 'bg-muted text-muted-foreground border-border' },
  failed: { label: 'Failed', tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' },
};

const PROGRAM_STATUS_META: Record<CloudProgramStatus, { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  paused: { label: 'Paused', tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
  completed: { label: 'Completed', tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20' },
  archived: { label: 'Archived', tone: 'bg-muted text-muted-foreground border-border' },
};

const ALL_TYPES: CloudTenantType[] = ['organization', 'government', 'developer_org', 'enterprise'];
const ALL_PLANS: CloudPlan[] = ['free', 'starter', 'growth', 'scale', 'enterprise'];
const ALL_STATUS: CloudTenantStatus[] = ['active', 'suspended', 'terminated'];
const ALL_ROLES: CloudTenantRole[] = ['owner', 'admin', 'developer', 'operator', 'viewer'];

const ENV_LABELS: Record<CloudDeploymentEnvironment, string> = {
  sandbox: 'Sandbox',
  staging: 'Staging',
  production: 'Production',
};

// ─── Component props ────────────────────────────────────────────────────────

interface Props {
  tenants: TenantSummary[];
  overview: CloudOverviewSnapshot;
}

// ─── Main component ─────────────────────────────────────────────────────────

export function CloudConsoleManager({ tenants: initial, overview }: Props) {
  const [tenants, setTenants] = useState<TenantSummary[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<CloudTenantType | 'ALL'>('ALL');
  const [planFilter, setPlanFilter] = useState<CloudPlan | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<CloudTenantStatus | 'ALL'>('ALL');
  const [showCreate, setShowCreate] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tenants.filter((t) => {
      if (typeFilter !== 'ALL' && t.type !== typeFilter) return false;
      if (planFilter !== 'ALL' && t.plan !== planFilter) return false;
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (q && !t.name.toLowerCase().includes(q) && !t.slug.includes(q)) return false;
      return true;
    });
  }, [tenants, query, typeFilter, planFilter, statusFilter]);

  const selected = tenants.find((t) => t.id === selectedId) ?? filtered[0] ?? null;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/cloud/tenants?scope=all');
      const data = await res.json();
      if (!res.ok || !data?.tenants) {
        toast.error('Failed to refresh tenants');
        return;
      }
      setTenants(data.tenants as TenantSummary[]);
    } catch {
      toast.error('Failed to refresh tenants');
    }
  }, []);

  const onCreate = useCallback((tenant: TenantSummary) => {
    setTenants((prev) => [tenant, ...prev]);
    setSelectedId(tenant.id);
    setShowCreate(false);
  }, []);

  return (
    <div className="space-y-6">
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Total tenants" value={overview.totalTenants} icon={<Cloud className="h-4 w-4" />} tone="emerald" />
        <StatTile label="Active" value={overview.byStatus.active} icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald" />
        <StatTile label="Suspended" value={overview.byStatus.suspended} icon={<Pause className="h-4 w-4" />} tone="amber" />
        <StatTile label="Total members" value={overview.totalMembers} icon={<Users2 className="h-4 w-4" />} />
        <StatTile label="Deployments" value={overview.totalDeployments} icon={<Server className="h-4 w-4" />} />
        <StatTile label="MRR" value={`$${overview.totalMrr.toLocaleString()}`} icon={<TrendingUp className="h-4 w-4" />} tone="emerald" />
      </div>

      {/* Distribution */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Distribution</CardTitle>
          <CardDescription className="text-xs">
            Tenants by type, plan, and status — at a glance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ALL_TYPES.map((t) => {
              const meta = TYPE_META[t];
              const Icon = meta.icon;
              const count = overview.byType[t] ?? 0;
              return (
                <div key={t} className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-full ${meta.tone}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <div className="text-base font-bold tabular-nums leading-none">{count}</div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {meta.label}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-5 gap-2">
            {ALL_PLANS.map((p) => (
              <div key={p} className="rounded-md border bg-muted/30 px-3 py-2 text-center">
                <div className="text-base font-bold tabular-nums">{overview.byPlan[p] ?? 0}</div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {PLAN_META[p].label}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Main split view */}
      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* Tenant list */}
        <Card className="h-fit">
          <CardHeader className="pb-3 space-y-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Tenants</CardTitle>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={refresh} className="h-7 px-2 text-xs">
                  <RefreshCw className="mr-1.5 h-3 w-3" />
                  Refresh
                </Button>
                <Button size="sm" className="h-7 px-2 text-xs" onClick={() => setShowCreate(true)}>
                  <Plus className="mr-1.5 h-3 w-3" />
                  New
                </Button>
              </div>
            </div>
            <Input
              placeholder="Search by name or slug…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 text-sm"
            />
            <div className="grid grid-cols-3 gap-1.5">
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as CloudTenantType | 'ALL')}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All types</SelectItem>
                  {ALL_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{TYPE_META[t].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={planFilter} onValueChange={(v) => setPlanFilter(v as CloudPlan | 'ALL')}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Plan" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All plans</SelectItem>
                  {ALL_PLANS.map((p) => (
                    <SelectItem key={p} value={p}>{PLAN_META[p].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as CloudTenantStatus | 'ALL')}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All status</SelectItem>
                  {ALL_STATUS.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[60vh]">
              {filtered.length === 0 ? (
                <EmptyState
                  icon={<Cloud className="h-5 w-5" />}
                  title="No tenants"
                  description="Create your first cloud tenant to provision a PaySwap instance."
                />
              ) : (
                <div className="divide-y">
                  {filtered.map((t) => {
                    const typeMeta = TYPE_META[t.type];
                    const planMeta = PLAN_META[t.plan];
                    const statusMeta = STATUS_META[t.status];
                    const TypeIcon = typeMeta.icon;
                    const StatusIcon = statusMeta.icon;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setSelectedId(t.id)}
                        className={`flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50 ${selected?.id === t.id ? 'bg-muted' : ''}`}
                      >
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${typeMeta.tone}`}>
                          <TypeIcon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">{t.name}</span>
                            <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${statusMeta.tone.split(' ')[0]}`} />
                          </div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">{t.slug}</div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className={`h-4 px-1.5 text-[10px] ${planMeta.tone}`}>{planMeta.label}</Badge>
                            <Badge variant="outline" className={`h-4 px-1.5 text-[10px] ${statusMeta.tone}`}>{statusMeta.label}</Badge>
                            <span className="text-[10px] text-muted-foreground">{t.memberCount} members</span>
                            <span className="text-[10px] text-muted-foreground">·</span>
                            <span className="text-[10px] text-muted-foreground">{t.usage.merchants} merchants</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Detail panel */}
        {selected ? (
          <TenantDetail tenant={selected} onRefresh={refresh} />
        ) : (
          <Card>
            <CardContent>
              <EmptyState
                icon={<Cloud className="h-5 w-5" />}
                title="Select a tenant"
                description="Pick a tenant from the list to view its members, programs, deployments, billing, and audit log."
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create dialog */}
      <CreateTenantDialog open={showCreate} onOpenChange={setShowCreate} onCreated={onCreate} />
    </div>
  );
}

// ─── Stat tile helper ───────────────────────────────────────────────────────

function StatTile({
  label, value, icon, tone,
}: { label: string; value: string | number; icon: React.ReactNode; tone?: 'emerald' | 'amber' | 'rose' }) {
  const toneClass = tone === 'emerald'
    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    : tone === 'amber'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
      : tone === 'rose'
        ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
        : 'bg-muted text-muted-foreground';
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${toneClass}`}>{icon}</div>
      </CardContent>
    </Card>
  );
}

// ─── Tenant detail panel ────────────────────────────────────────────────────

function TenantDetail({ tenant, onRefresh }: { tenant: TenantSummary; onRefresh: () => void }) {
  const [detail, setDetail] = useState<TenantDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('overview');

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cloud/tenants/${tenant.id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? 'Failed to load tenant');
        setDetail(null);
      } else {
        setDetail(data as TenantDetailResponse);
      }
    } catch {
      toast.error('Failed to load tenant');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const typeMeta = TYPE_META[tenant.type];
  const planMeta = PLAN_META[tenant.plan];
  const statusMeta = STATUS_META[tenant.status];
  const TypeIcon = typeMeta.icon;
  const StatusIcon = statusMeta.icon;

  return (
    <Card className="h-fit">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${typeMeta.tone}`}>
              <TypeIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">{tenant.name}</h2>
              <div className="mt-0.5 text-xs text-muted-foreground">{tenant.slug}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className={`h-5 px-2 text-[11px] ${typeMeta.tone}`}>{typeMeta.label}</Badge>
                <Badge variant="outline" className={`h-5 px-2 text-[11px] ${planMeta.tone}`}>{planMeta.label}</Badge>
                <Badge variant="outline" className={`h-5 px-2 text-[11px] ${statusMeta.tone}`}>
                  <StatusIcon className="mr-1 h-3 w-3" />
                  {statusMeta.label}
                </Badge>
                <Badge variant="outline" className="h-5 px-2 text-[11px]">
                  <Globe className="mr-1 h-3 w-3" />
                  {tenant.region}
                </Badge>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={loadDetail} disabled={loading}>
              {loading ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1.5 h-3 w-3" />}
              Refresh
            </Button>
            <TenantActions tenant={tenant} detail={detail} onChanged={loadDetail} onRefreshList={onRefresh} />
          </div>
        </div>
        {tenant.suspendedReason && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <div className="font-semibold">Suspended</div>
              <div className="text-amber-700/80 dark:text-amber-400/80">{tenant.suspendedReason}</div>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <div className="border-b px-3">
            <TabsList className="h-9 bg-transparent p-0">
              <TabsTrigger value="overview" className="h-9 rounded-none border-b-2 border-transparent text-xs data-[state=active]:border-emerald-500">Overview</TabsTrigger>
              <TabsTrigger value="members" className="h-9 rounded-none border-b-2 border-transparent text-xs data-[state=active]:border-emerald-500">Members</TabsTrigger>
              <TabsTrigger value="programs" className="h-9 rounded-none border-b-2 border-transparent text-xs data-[state=active]:border-emerald-500">Programs</TabsTrigger>
              <TabsTrigger value="deployments" className="h-9 rounded-none border-b-2 border-transparent text-xs data-[state=active]:border-emerald-500">Deployments</TabsTrigger>
              <TabsTrigger value="billing" className="h-9 rounded-none border-b-2 border-transparent text-xs data-[state=active]:border-emerald-500">Billing</TabsTrigger>
              <TabsTrigger value="audit" className="h-9 rounded-none border-b-2 border-transparent text-xs data-[state=active]:border-emerald-500">Audit</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="mt-0 p-4">
            {detail ? <OverviewTab tenant={detail.tenant} /> : <LoadingPane />}
          </TabsContent>
          <TabsContent value="members" className="mt-0 p-4">
            {detail ? <MembersTab tenant={detail.tenant} onChanged={loadDetail} /> : <LoadingPane />}
          </TabsContent>
          <TabsContent value="programs" className="mt-0 p-4">
            {detail ? <ProgramsTab tenantId={detail.tenant.id} programs={detail.programs} onChanged={loadDetail} /> : <LoadingPane />}
          </TabsContent>
          <TabsContent value="deployments" className="mt-0 p-4">
            {detail ? <DeploymentsTab tenantId={detail.tenant.id} plan={detail.tenant.plan} deployments={detail.deployments} onChanged={loadDetail} /> : <LoadingPane />}
          </TabsContent>
          <TabsContent value="billing" className="mt-0 p-4">
            {detail ? <BillingTab tenantId={detail.tenant.id} subscription={detail.subscription} usage={detail.tenant.usage} /> : <LoadingPane />}
          </TabsContent>
          <TabsContent value="audit" className="mt-0 p-4">
            {detail ? <AuditTab entries={detail.audit} /> : <LoadingPane />}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function LoadingPane() {
  return (
    <div className="flex h-48 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

// ─── Tenant actions menu ────────────────────────────────────────────────────

function TenantActions({
  tenant, detail, onChanged, onRefreshList,
}: {
  tenant: TenantSummary;
  detail: TenantDetailResponse | null;
  onChanged: () => void;
  onRefreshList: () => void;
}) {
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const doSuspend = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/cloud/tenants/${tenant.id}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || 'Suspended by admin' }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data?.error ?? 'Failed to suspend tenant');
        return;
      }
      toast.success('Tenant suspended');
      setSuspendOpen(false);
      setReason('');
      onChanged();
      onRefreshList();
    } catch {
      toast.error('Failed to suspend tenant');
    } finally {
      setBusy(false);
    }
  };

  const doUpgrade = async (plan: CloudPlan) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/cloud/tenants/${tenant.id}/subscription/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data?.error ?? 'Failed to change plan');
        return;
      }
      toast.success(`Plan changed to ${PLAN_META[plan].label}`);
      onChanged();
      onRefreshList();
    } catch {
      toast.error('Failed to change plan');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs">Plan</DropdownMenuLabel>
          {ALL_PLANS.filter((p) => p !== tenant.plan).map((p) => (
            <DropdownMenuItem key={p} onClick={() => doUpgrade(p)} className="text-xs">
              <ArrowUpCircle className="mr-2 h-3.5 w-3.5" />
              Switch to {PLAN_META[p].label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs">Lifecycle</DropdownMenuLabel>
          {tenant.status === 'active' && (
            <DropdownMenuItem onClick={() => setSuspendOpen(true)} className="text-xs text-amber-600 dark:text-amber-400">
              <Ban className="mr-2 h-3.5 w-3.5" />
              Suspend
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => {
              if (detail?.tenant.slug) {
                navigator.clipboard?.writeText(detail.tenant.slug);
                toast.success('Tenant slug copied');
              }
            }}
            className="text-xs"
          >
            <Copy className="mr-2 h-3.5 w-3.5" />
            Copy slug
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend tenant</DialogTitle>
            <DialogDescription>
              Suspend <strong>{tenant.name}</strong>? All deployments will be marked down and API access will be blocked.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="suspend-reason">Reason</Label>
            <Textarea
              id="suspend-reason"
              placeholder="e.g. Compliance review pending — KYC documents overdue"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={doSuspend} disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Suspend tenant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Overview tab ───────────────────────────────────────────────────────────

function OverviewTab({ tenant }: { tenant: CloudTenant }) {
  const usageItems: Array<{ key: keyof CloudUsage; label: string; limit: number; format?: (n: number) => string }> = [
    { key: 'merchants', label: 'Merchants', limit: tenant.config.limits.maxMerchants },
    { key: 'lps', label: 'Liquidity Providers', limit: tenant.config.limits.maxLPs },
    { key: 'transactionsThisMonth', label: 'Transactions (this month)', limit: tenant.config.limits.maxTransactionsPerMonth, format: (n) => n.toLocaleString() },
    { key: 'apiRequestsThisMinute', label: 'API requests (this minute)', limit: tenant.config.limits.maxAPIRequestsPerMinute, format: (n) => n.toLocaleString() },
    { key: 'storageUsedGB', label: 'Storage (GB)', limit: tenant.config.limits.maxStorageGB, format: (n) => `${n.toFixed(1)} GB` },
    { key: 'extensionsInstalled', label: 'Extensions installed', limit: tenant.config.limits.maxExtensions },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Usage &amp; limits</h3>
        <div className="space-y-3">
          {usageItems.map((item) => {
            const value = tenant.usage[item.key] as number;
            const pct = item.limit > 0 ? Math.min(100, Math.round((value / item.limit) * 100)) : 0;
            const exceeded = value >= item.limit;
            const display = item.format ? item.format(value) : value.toString();
            return (
              <div key={item.key}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium">{item.label}</span>
                  <span className={`tabular-nums ${exceeded ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-muted-foreground'}`}>
                    {display} / {item.format ? item.format(item.limit) : item.limit.toLocaleString()}
                    {exceeded && <AlertCircle className="ml-1 inline h-3 w-3" />}
                  </span>
                </div>
                <Progress value={pct} className={`h-1.5 ${exceeded ? '[&>div]:bg-rose-500' : ''}`} />
              </div>
            );
          })}
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="mb-2 text-sm font-semibold">Configuration</h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground">Compliance region</div>
            <div className="mt-0.5 font-medium">{tenant.config.complianceRegion}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Region</div>
            <div className="mt-0.5 font-medium">{tenant.region}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Owner ID</div>
            <div className="mt-0.5 truncate font-mono text-[11px]">{tenant.ownerId}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Created</div>
            <div className="mt-0.5 font-medium">{new Date(tenant.createdAt).toLocaleDateString()}</div>
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="mb-2 text-sm font-semibold">Features</h3>
        <div className="flex flex-wrap gap-1.5">
          {tenant.config.features.map((f) => (
            <Badge key={f} variant="outline" className="h-5 px-2 text-[11px]">{f}</Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Members tab ────────────────────────────────────────────────────────────

function MembersTab({ tenant, onChanged }: { tenant: CloudTenant; onChanged: () => void }) {
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const updateRole = async (userId: string, role: CloudTenantRole) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/cloud/tenants/${tenant.id}/members/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data?.error ?? 'Failed to update role');
        return;
      }
      toast.success('Role updated');
      onChanged();
    } catch {
      toast.error('Failed to update role');
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (userId: string) => {
    if (!confirm('Remove this member from the tenant?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/cloud/tenants/${tenant.id}/members/${userId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data?.error ?? 'Failed to remove member');
        return;
      }
      toast.success('Member removed');
      onChanged();
    } catch {
      toast.error('Failed to remove member');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Members ({tenant.members.length})</h3>
        <Button size="sm" className="h-7 px-2 text-xs" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1.5 h-3 w-3" />
          Add member
        </Button>
      </div>
      <div className="divide-y rounded-md border">
        {tenant.members.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">No members</div>
        ) : (
          tenant.members.map((m) => {
            const meta = ROLE_META[m.role];
            const RoleIcon = meta.icon;
            return (
              <div key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${meta.tone}`}>
                  <RoleIcon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{m.userId}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {m.joinedAt ? `Joined ${new Date(m.joinedAt).toLocaleDateString()}` : `Invited ${new Date(m.invitedAt).toLocaleDateString()}`}
                  </div>
                </div>
                <Select
                  value={m.role}
                  onValueChange={(v) => updateRole(m.userId, v as CloudTenantRole)}
                  disabled={busy || m.role === 'owner'}
                >
                  <SelectTrigger className="h-7 w-28 text-xs" disabled={m.role === 'owner'}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_ROLES.map((r) => (
                      <SelectItem key={r} value={r} disabled={r === 'owner' && m.role !== 'owner'}>
                        {ROLE_META[r].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {m.role !== 'owner' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-600"
                    onClick={() => removeMember(m.userId)}
                    disabled={busy}
                  >
                    <Ban className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>

      <AddMemberDialog
        tenantId={tenant.id}
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={() => {
          setAddOpen(false);
          onChanged();
        }}
      />
    </div>
  );
}

function AddMemberDialog({
  tenantId, open, onOpenChange, onAdded,
}: {
  tenantId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => void;
}) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<CloudTenantRole>('developer');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!userId.trim()) {
      toast.error('User ID is required');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/cloud/tenants/${tenantId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId.trim(), role }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data?.error ?? 'Failed to add member');
        return;
      }
      toast.success('Member added');
      setUserId('');
      setRole('developer');
      onAdded();
    } catch {
      toast.error('Failed to add member');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Invite a user to this tenant. The user will appear in the members list immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="member-userid">User ID</Label>
            <Input
              id="member-userid"
              placeholder="e.g. seed-user-kofi"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as CloudTenantRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALL_ROLES.filter((r) => r !== 'owner').map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_META[r].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Add member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Programs tab ───────────────────────────────────────────────────────────

function ProgramsTab({
  tenantId, programs, onChanged,
}: {
  tenantId: string;
  programs: CloudProgram[];
  onChanged: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const lifecycle = async (programId: string, action: 'pause' | 'resume' | 'archive' | 'complete') => {
    setBusy(true);
    try {
      const res = await fetch(`/api/cloud/tenants/${tenantId}/programs/${programId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data?.error ?? 'Failed to update program');
        return;
      }
      toast.success(`Program ${action}d`);
      onChanged();
    } catch {
      toast.error('Failed to update program');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Programs ({programs.length})</h3>
        <Button size="sm" className="h-7 px-2 text-xs" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-3 w-3" />
          New program
        </Button>
      </div>
      {programs.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-5 w-5" />}
          title="No programs yet"
          description="Create a program to organize an initiative (e.g. 'Ghana Expansion')."
        />
      ) : (
        <div className="space-y-2">
          {programs.map((p) => {
            const status = PROGRAM_STATUS_META[p.status];
            return (
              <div key={p.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{p.name}</span>
                      <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${status.tone}`}>{status.label}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{p.description}</p>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      Created {new Date(p.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={busy}>
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      {p.status === 'active' && (
                        <DropdownMenuItem onClick={() => lifecycle(p.id, 'pause')} className="text-xs">
                          <Pause className="mr-2 h-3.5 w-3.5" /> Pause
                        </DropdownMenuItem>
                      )}
                      {p.status === 'paused' && (
                        <DropdownMenuItem onClick={() => lifecycle(p.id, 'resume')} className="text-xs">
                          <Play className="mr-2 h-3.5 w-3.5" /> Resume
                        </DropdownMenuItem>
                      )}
                      {(p.status === 'active' || p.status === 'paused') && (
                        <DropdownMenuItem onClick={() => lifecycle(p.id, 'complete')} className="text-xs">
                          <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Mark complete
                        </DropdownMenuItem>
                      )}
                      {p.status !== 'archived' && (
                        <DropdownMenuItem onClick={() => lifecycle(p.id, 'archive')} className="text-xs text-amber-600 dark:text-amber-400">
                          <Archive className="mr-2 h-3.5 w-3.5" /> Archive
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateProgramDialog
        tenantId={tenantId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          onChanged();
        }}
      />
    </div>
  );
}

function CreateProgramDialog({
  tenantId, open, onOpenChange, onCreated,
}: {
  tenantId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (name.trim().length < 2) {
      toast.error('Name must be at least 2 characters');
      return;
    }
    if (!description.trim()) {
      toast.error('Description is required');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/cloud/tenants/${tenantId}/programs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data?.error ?? 'Failed to create program');
        return;
      }
      toast.success('Program created');
      setName('');
      setDescription('');
      onCreated();
    } catch {
      toast.error('Failed to create program');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New program</DialogTitle>
          <DialogDescription>
            Create a new program within this tenant.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="prog-name">Name</Label>
            <Input id="prog-name" placeholder="e.g. Ghana Expansion" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="prog-desc">Description</Label>
            <Textarea id="prog-desc" rows={3} placeholder="What is this program trying to achieve?" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Create program
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Deployments tab ────────────────────────────────────────────────────────

function DeploymentsTab({
  tenantId, plan, deployments, onChanged,
}: {
  tenantId: string;
  plan: CloudPlan;
  deployments: CloudDeployment[];
  onChanged: () => void;
}) {
  const [deployOpen, setDeployOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<string | null>(null);

  const action = async (deploymentId: string, kind: 'stop' | 'restart') => {
    setBusyId(deploymentId);
    try {
      const res = await fetch(`/api/cloud/deployments/${deploymentId}/${kind}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data?.error ?? `Failed to ${kind} deployment`);
        return;
      }
      toast.success(`Deployment ${kind}ed`);
      onChanged();
    } catch {
      toast.error(`Failed to ${kind} deployment`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Deployments ({deployments.length})</h3>
        <Button size="sm" className="h-7 px-2 text-xs" onClick={() => setDeployOpen(true)}>
          <Rocket className="mr-1.5 h-3 w-3" />
          Deploy
        </Button>
      </div>

      {deployments.length === 0 ? (
        <EmptyState
          icon={<Server className="h-5 w-5" />}
          title="No deployments"
          description="Deploy a sandbox, staging, or production environment for this tenant."
        />
      ) : (
        <div className="space-y-2">
          {deployments.map((d) => {
            const health = DEPLOY_HEALTH_META[d.health];
            const status = DEPLOY_STATUS_META[d.status];
            const HealthIcon = health.icon;
            return (
              <div key={d.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{ENV_LABELS[d.environment]}</span>
                      <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${status.tone}`}>{status.label}</Badge>
                      <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${health.tone}`}>
                        <HealthIcon className="mr-1 h-3 w-3" />
                        {health.label}
                      </Badge>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        <Globe className="mr-1 h-3 w-3" />
                        {d.region}
                      </Badge>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <span className="font-mono">{d.url}</span>
                      <button
                        onClick={() => navigator.clipboard?.writeText(d.url)}
                        className="text-muted-foreground/60 hover:text-foreground"
                        aria-label="Copy URL"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      v{d.version} · deployed {new Date(d.deployedAt).toLocaleString()} · {d.config.replicas} replicas · {d.config.cpuMillicores}m CPU · {d.config.memoryMB}MB RAM
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {d.status === 'running' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-amber-600 dark:text-amber-400"
                        onClick={() => action(d.id, 'stop')}
                        disabled={busyId === d.id}
                      >
                        {busyId === d.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Ban className="mr-1 h-3 w-3" />}
                        Stop
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => action(d.id, 'restart')}
                      disabled={busyId === d.id}
                    >
                      {busyId === d.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1 h-3 w-3" />}
                      Restart
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setLogsFor(logsFor === d.id ? null : d.id)}
                    >
                      <Terminal className="mr-1 h-3 w-3" />
                      Logs
                    </Button>
                  </div>
                </div>
                {logsFor === d.id && <DeploymentLogs deploymentId={d.id} />}
              </div>
            );
          })}
        </div>
      )}

      <DeployDialog
        tenantId={tenantId}
        plan={plan}
        open={deployOpen}
        onOpenChange={setDeployOpen}
        onDeployed={() => {
          setDeployOpen(false);
          onChanged();
        }}
      />
    </div>
  );
}

function DeploymentLogs({ deploymentId }: { deploymentId: string }) {
  const [logs, setLogs] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cloud/deployments/${deploymentId}/health?limit=100`);
      const data = await res.json();
      if (!res.ok) {
        setLogs([]);
        return;
      }
      setLogs(data.logs as string[]);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [deploymentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <div className="mt-2 flex h-12 items-center justify-center"><Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /></div>;
  }
  if (!logs || logs.length === 0) {
    return <div className="mt-2 rounded bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">No logs available.</div>;
  }
  return (
    <div className="mt-2 max-h-40 overflow-y-auto rounded bg-zinc-950 p-2 font-mono text-[10px] leading-relaxed text-zinc-300">
      {logs.map((l, i) => (
        <div key={i} className="whitespace-pre-wrap break-all">{l}</div>
      ))}
    </div>
  );
}

function DeployDialog({
  tenantId, plan, open, onOpenChange, onDeployed,
}: {
  tenantId: string;
  plan: CloudPlan;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDeployed: () => void;
}) {
  const availableEnvs: CloudDeploymentEnvironment[] =
    plan === 'free' ? ['sandbox'] :
    plan === 'starter' ? ['sandbox', 'staging'] :
    ['sandbox', 'staging', 'production'];
  const [env, setEnv] = useState<CloudDeploymentEnvironment>(availableEnvs[0]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/cloud/tenants/${tenantId}/deployments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: env }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data?.error ?? 'Failed to deploy');
        return;
      }
      toast.success(`${ENV_LABELS[env]} deployment initiated`);
      onDeployed();
    } catch {
      toast.error('Failed to deploy');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deploy environment</DialogTitle>
          <DialogDescription>
            Provision a new PaySwap kernel instance for this tenant.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Environment</Label>
            <Select value={env} onValueChange={(v) => setEnv(v as CloudDeploymentEnvironment)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {availableEnvs.map((e) => (
                  <SelectItem key={e} value={e}>{ENV_LABELS[e]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            The deployment will run on the PaySwap Cloud kernel (v1.0.0-cloud) in the tenant&apos;s
            home region. A unique URL will be provisioned automatically.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1.5 h-3.5 w-3.5" />}
            Deploy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Billing tab ────────────────────────────────────────────────────────────

function BillingTab({
  tenantId, subscription, usage,
}: {
  tenantId: string;
  subscription: CloudSubscription | null;
  usage: CloudUsage;
}) {
  const [billing, setBilling] = useState<{
    subscription: CloudSubscription | null;
    invoices: Array<{ id: string; amount: number; currency: string; status: string; createdAt: number; periodEnd: number }>;
    currentInvoice: { amount: number; currency: string; lineItems: Array<{ type: string; quantity: number; rate: number; amount: number }> };
    usageHistory: CloudUsage[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cloud/tenants/${tenantId}/billing?months=6`);
      const data = await res.json();
      if (res.ok) {
        setBilling(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <LoadingPane />;
  }

  const sub = billing?.subscription ?? subscription;
  const current = billing?.currentInvoice;
  const invoices = billing?.invoices ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Current plan</div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-lg font-bold">{sub ? PLAN_META[sub.plan].label : '—'}</span>
              <Badge variant="outline" className={`h-5 px-2 text-[10px] ${sub?.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' : 'bg-muted text-muted-foreground'}`}>
                {sub?.status ?? 'none'}
              </Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {sub ? `$${sub.amount}/mo base · renews ${new Date(sub.currentPeriodEnd).toLocaleDateString()}` : 'No active subscription'}
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setUpgradeOpen(true)}>
            <ArrowUpCircle className="mr-1.5 h-3 w-3" />
            Change plan
          </Button>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Current period estimate</h3>
        {current && current.amount > 0 ? (
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Estimated total</span>
              <span className="text-base font-bold tabular-nums">
                ${current.amount.toFixed(2)} {current.currency}
              </span>
            </div>
            <Separator className="my-2" />
            <div className="space-y-1">
              {current.lineItems.map((li) => (
                <div key={li.type} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {li.type} ({li.quantity.toLocaleString()} × ${li.rate.toFixed(4)})
                  </span>
                  <span className="tabular-nums">${li.amount.toFixed(2)}</span>
                </div>
              ))}
              {current.lineItems.length === 0 && (
                <div className="text-xs text-muted-foreground">No usage-based charges this period.</div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            No usage-based charges accrued this period.
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Invoices</h3>
        {invoices.length === 0 ? (
          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            No invoices yet. The first invoice will be generated at the end of the current period.
          </div>
        ) : (
          <div className="divide-y rounded-md border">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between px-3 py-2 text-xs">
                <div>
                  <div className="font-mono text-[11px]">{inv.id}</div>
                  <div className="text-[10px] text-muted-foreground">
                    Period ended {new Date(inv.periodEnd).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{inv.status}</Badge>
                  <span className="tabular-nums font-medium">${inv.amount.toFixed(2)} {inv.currency}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <UpgradeDialog
        tenantId={tenantId}
        currentPlan={sub?.plan ?? 'free'}
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        onUpgraded={load}
      />
    </div>
  );
}

function UpgradeDialog({
  tenantId, currentPlan, open, onOpenChange, onUpgraded,
}: {
  tenantId: string;
  currentPlan: CloudPlan;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUpgraded: () => void;
}) {
  const [target, setTarget] = useState<CloudPlan>(currentPlan);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/cloud/tenants/${tenantId}/subscription/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: target }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data?.error ?? 'Failed to change plan');
        return;
      }
      toast.success(`Plan changed to ${PLAN_META[target].label}`);
      onUpgraded();
      onOpenChange(false);
    } catch {
      toast.error('Failed to change plan');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change plan</DialogTitle>
          <DialogDescription>
            Upgrade or downgrade the tenant&apos;s subscription. Changes take effect immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {ALL_PLANS.map((p) => {
            const planDef = (CLOUD_PLAN_CATALOGUE as Array<{ id: CloudPlan; name: string; priceMonthly: number; tagline: string }>).find((c) => c.id === p)!;
            return (
              <label
                key={p}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${target === p ? 'border-emerald-500 bg-emerald-500/5' : 'hover:bg-muted/50'}`}
              >
                <input
                  type="radio"
                  name="plan"
                  className="mt-0.5"
                  checked={target === p}
                  onChange={() => setTarget(p)}
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{planDef.name}</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {planDef.priceMonthly === 0 ? 'Contact sales' : `$${planDef.priceMonthly}/mo`}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{planDef.tagline}</div>
                </div>
              </label>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || target === currentPlan}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Change to {PLAN_META[target].label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Audit tab ──────────────────────────────────────────────────────────────

function AuditTab({ entries }: { entries: CloudAuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="h-5 w-5" />}
        title="No audit entries"
        description="Actions on this tenant will appear here."
      />
    );
  }
  return (
    <ScrollArea className="h-[50vh]">
      <div className="divide-y rounded-md border">
        {entries.map((e) => (
          <div key={e.id} className="flex items-start gap-3 px-3 py-2">
            <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px]">
              <Activity className="h-3 w-3 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-medium">{e.action}</span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(e.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                by <span className="font-mono">{e.actorId}</span> on <span className="font-mono">{e.resourceType}</span>
              </div>
              {Object.keys(e.details).length > 0 && (
                <pre className="mt-1 overflow-x-auto rounded bg-muted/50 px-2 py-1 text-[10px]">
                  {JSON.stringify(e.details, null, 2)}
                </pre>
              )}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// ─── Create tenant dialog ───────────────────────────────────────────────────

function CreateTenantDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (t: TenantSummary) => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [type, setType] = useState<CloudTenantType>('organization');
  const [plan, setPlan] = useState<CloudPlan>('starter');
  const [region, setRegion] = useState('af-west-1');
  const [complianceRegion, setComplianceRegion] = useState<CloudComplianceRegion>('GH');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (name.trim().length < 2) {
      toast.error('Name must be at least 2 characters');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/cloud/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim() || undefined,
          type,
          plan,
          region,
          complianceRegion,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data?.error ?? 'Failed to create tenant');
        return;
      }
      const data = await res.json();
      toast.success('Tenant created');
      const t = data.tenant;
      onCreated({
        id: t.id,
        name: t.name,
        slug: t.slug,
        type: t.type,
        plan: t.plan,
        region: t.region,
        status: t.status,
        ownerId: t.ownerId,
        createdAt: t.createdAt,
        memberCount: t.memberCount,
        usage: t.usage,
      });
      setName('');
      setSlug('');
      setType('organization');
      setPlan('starter');
      setRegion('af-west-1');
      setComplianceRegion('GH');
    } catch {
      toast.error('Failed to create tenant');
    } finally {
      setBusy(false);
    }
  };

  const regions = CLOUD_REGIONS as Array<{ id: string; label: string }>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create cloud tenant</DialogTitle>
          <DialogDescription>
            Provision a new PaySwap instance on the shared kernel.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-2">
            <Label htmlFor="t-name">Name</Label>
            <Input id="t-name" placeholder="e.g. Accra Fintech Hub" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-2">
            <Label htmlFor="t-slug">Slug (optional)</Label>
            <Input id="t-slug" placeholder="auto-generated from name" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as CloudTenantType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALL_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{TYPE_META[t].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Plan</Label>
            <Select value={plan} onValueChange={(v) => setPlan(v as CloudPlan)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALL_PLANS.map((p) => (
                  <SelectItem key={p} value={p}>{PLAN_META[p].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Region</Label>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {regions.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Compliance region</Label>
            <Select value={complianceRegion} onValueChange={(v) => setComplianceRegion(v as CloudComplianceRegion)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['GH', 'NG', 'KE', 'EU', 'US', 'GLOBAL'] as CloudComplianceRegion[]).map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
            Create tenant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
