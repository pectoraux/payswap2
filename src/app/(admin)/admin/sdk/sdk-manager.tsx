'use client';

import { useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Boxes, CheckCircle2, XCircle, AlertTriangle, PauseCircle,
  Loader2, Play, Square, ChevronRight, Cpu, Clock, KeyRound,
  ScrollText, Eye, Shield, GitBranch, ArrowUpCircle, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { EmptyState } from '@/components/empty-state';
import type {
  PluginManifest, PluginStatus, CapabilityType,
} from '@/sdk';

export interface SdkPluginSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  license: string | null;
  status: PluginStatus;
  enabledAt: number | null;
  disabledAt: number | null;
  error: string | null;
  failureCount: number;
  manifest: PluginManifest;
  store: Record<string, unknown>;
}

export interface SdkCapabilitySummary {
  id: string;
  name: string;
  type: CapabilityType;
  config: Record<string, unknown> | null;
  pluginId: string;
}

export interface SdkStats {
  total: number;
  enabled: number;
  disabled: number;
  error: number;
  capabilities: number;
}

interface Props {
  plugins: SdkPluginSummary[];
  capabilities: SdkCapabilitySummary[];
  stats: SdkStats;
}

const STATUS_META: Record<PluginStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  registered: { label: 'Registered', icon: PauseCircle, className: 'bg-muted text-muted-foreground border-border' },
  enabled: { label: 'Enabled', icon: CheckCircle2, className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  disabled: { label: 'Disabled', icon: XCircle, className: 'bg-muted text-muted-foreground border-border' },
  error: { label: 'Error', icon: AlertTriangle, className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' },
  deprecated: { label: 'Deprecated', icon: AlertTriangle, className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
};

const CAPABILITY_TYPES: CapabilityType[] = [
  'settlement-rail', 'wallet', 'compliance', 'identity', 'analytics',
  'fraud-detection', 'corridor-optimizer', 'pricing-engine', 'country',
  'stablecoin', 'twin-token', 'marketplace-algorithm', 'ai-director',
  'notification', 'custom',
];

export function SdkManager({ plugins, capabilities, stats }: Props) {
  const [tab, setTab] = useState<'plugins' | 'capabilities'>('plugins');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Total plugins" value={stats.total} icon={<Boxes className="h-4 w-4" />} />
        <StatTile label="Enabled" value={stats.enabled} icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald" />
        <StatTile label="Disabled" value={stats.disabled} icon={<PauseCircle className="h-4 w-4" />} />
        <StatTile label="Errors" value={stats.error} icon={<AlertTriangle className="h-4 w-4" />} tone={stats.error > 0 ? 'rose' : undefined} />
        <StatTile label="Capabilities" value={stats.capabilities} icon={<Cpu className="h-4 w-4" />} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'plugins' | 'capabilities')}>
        <TabsList>
          <TabsTrigger value="plugins">Plugins ({plugins.length})</TabsTrigger>
          <TabsTrigger value="capabilities">Capabilities ({capabilities.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="plugins" className="mt-4">
          <PluginsPanel plugins={plugins} />
        </TabsContent>
        <TabsContent value="capabilities" className="mt-4">
          <CapabilitiesPanel capabilities={capabilities} plugins={plugins} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Plugins panel ───────────────────────────────────────────────────────

function PluginsPanel({ plugins }: { plugins: SdkPluginSummary[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(plugins[0]?.id ?? null);
  const [items, setItems] = useState(plugins);

  const selected = items.find((p) => p.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/sdk/plugins');
      const data = await res.json();
      if (!res.ok || !data?.plugins) return;
      // Re-fetch full manifests for the selected plugin if needed.
      const next: SdkPluginSummary[] = await Promise.all(
        (data.plugins as Array<any>).map(async (p): Promise<SdkPluginSummary> => {
          const detailRes = await fetch(`/api/sdk/plugins/${encodeURIComponent(p.id)}`);
          const detail = await detailRes.json();
          return {
            id: p.id,
            name: p.name,
            version: p.version,
            description: p.description,
            author: p.author,
            license: p.license,
            status: p.status,
            enabledAt: p.enabledAt,
            disabledAt: p.disabledAt,
            error: p.error,
            failureCount: p.failureCount,
            manifest: detail?.manifest ?? {
              name: p.name, version: p.version, description: p.description,
              author: p.author, license: p.license ?? undefined,
              capabilities: [], permissions: [], commands: [], events: [],
              views: [], policies: [], dependencies: [], migrations: [],
            },
            store: detail?.plugin?.store ?? {},
          };
        }),
      );
      setItems(next);
    } catch (err) {
      toast.error('Failed to refresh plugins');
    }
  }, []);

  if (plugins.length === 0) {
    return (
      <EmptyState
        icon={<Boxes className="h-5 w-5" />}
        title="No plugins registered"
        description="The Capability SDK is initialized but no plugins have been registered yet. Built-in plugins should appear here automatically."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      {/* Plugin list (sidebar) */}
      <Card className="h-fit">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Registered plugins</CardTitle>
          <CardDescription className="text-xs">Select to view manifest</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[60vh]">
            <ul className="divide-y">
              {items.map((p) => {
                const meta = STATUS_META[p.status];
                const Icon = meta.icon;
                const isSelected = selectedId === p.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                        isSelected ? 'bg-muted/60' : ''
                      }`}
                    >
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.className.split(' ').filter(c => c.startsWith('text-')).join(' ')}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{p.name}</span>
                          <span className="shrink-0 text-[10px] font-mono text-muted-foreground">{p.version}</span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                        <div className="mt-1 flex items-center gap-1">
                          <Badge variant="outline" className={`h-4 px-1.5 text-[10px] ${meta.className}`}>
                            {meta.label}
                          </Badge>
                          {p.failureCount > 0 ? (
                            <span className="text-[10px] font-medium text-rose-600 dark:text-rose-400">
                              {p.failureCount} fail
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {isSelected ? <ChevronRight className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
          <div className="border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              className="w-full text-xs"
            >
              <RefreshCw className="mr-1.5 h-3 w-3" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Plugin detail (main) */}
      <div className="min-w-0">
        {selected ? <PluginDetail plugin={selected} onChanged={refresh} /> : (
          <EmptyState
            icon={<Boxes className="h-5 w-5" />}
            title="Select a plugin"
            description="Pick a plugin from the list to inspect its manifest."
          />
        )}
      </div>
    </div>
  );
}

function PluginDetail({ plugin, onChanged }: { plugin: SdkPluginSummary; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const meta = STATUS_META[plugin.status];

  const act = async (action: 'enable' | 'disable') => {
    setBusy(true);
    try {
      const res = await fetch(`/api/sdk/plugins/${encodeURIComponent(plugin.id)}/${action}`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? `Failed to ${action} plugin`);
      } else {
        toast.success(`Plugin ${action}d`);
        onChanged();
      }
    } catch {
      toast.error(`Failed to ${action} plugin`);
    } finally {
      setBusy(false);
    }
  };

  const m = plugin.manifest;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">{m.name}</CardTitle>
              <Badge variant="outline" className={`h-5 ${meta.className}`}>
                <meta.icon className="mr-1 h-3 w-3" />
                {meta.label}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">v{m.version}</span>
            </div>
            <CardDescription className="text-sm">{m.description}</CardDescription>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>by {m.author}</span>
              {m.license ? <span>· {m.license}</span> : null}
              {m.minRuntimeVersion ? <span>· runtime ≥ {m.minRuntimeVersion}</span> : null}
              {plugin.failureCount > 0 ? (
                <span className="font-medium text-rose-600 dark:text-rose-400">· {plugin.failureCount} recent failures</span>
              ) : null}
            </div>
            {plugin.error ? (
              <div className="mt-2 rounded-md border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                {plugin.error}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {plugin.status === 'enabled' ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act('disable')}>
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Square className="mr-1.5 h-3.5 w-3.5" />}
                Disable
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => act('enable')} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                Enable
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <Section icon={<Cpu className="h-3.5 w-3.5" />} title={`Capabilities (${m.capabilities.length})`}>
          {m.capabilities.length === 0 ? (
            <Empty text="No capabilities declared" />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {m.capabilities.map((c) => (
                <div key={c.id} className="rounded-md border bg-muted/30 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold">{c.name}</span>
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{c.type}</Badge>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{c.id}</div>
                  {c.config && Object.keys(c.config).length > 0 ? (
                    <pre className="mt-1.5 overflow-x-auto rounded bg-background p-1.5 text-[10px] leading-tight">
                      {JSON.stringify(c.config, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section icon={<KeyRound className="h-3.5 w-3.5" />} title={`Permissions (${m.permissions.length})`}>
          {m.permissions.length === 0 ? (
            <Empty text="No permissions requested" />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {m.permissions.map((p) => (
                <Badge key={p} variant="outline" className="font-mono text-[10px]">{p}</Badge>
              ))}
            </div>
          )}
        </Section>

        <div className="grid gap-5 md:grid-cols-2">
          <Section icon={<ScrollText className="h-3.5 w-3.5" />} title={`Commands (${m.commands.length})`}>
            {m.commands.length === 0 ? <Empty text="No commands" /> : (
              <ul className="space-y-1.5 text-xs">
                {m.commands.map((c) => (
                  <li key={c.commandType} className="flex flex-col gap-0.5 rounded-md border bg-muted/20 p-2">
                    <span className="font-mono text-[11px] font-medium">{c.commandType}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">→ {c.handler}</span>
                    {c.description ? <span className="text-[10px] text-muted-foreground">{c.description}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={<Eye className="h-3.5 w-3.5" />} title={`Event handlers (${m.events.length})`}>
            {m.events.length === 0 ? <Empty text="No event handlers" /> : (
              <ul className="space-y-1.5 text-xs">
                {m.events.map((e, i) => (
                  <li key={`${e.eventType}-${i}`} className="flex flex-col gap-0.5 rounded-md border bg-muted/20 p-2">
                    <span className="font-mono text-[11px] font-medium">{e.eventType}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">→ {e.handler}</span>
                    {e.description ? <span className="text-[10px] text-muted-foreground">{e.description}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <Section icon={<Eye className="h-3.5 w-3.5" />} title={`Views (${m.views.length})`}>
            {m.views.length === 0 ? <Empty text="No views" /> : (
              <ul className="space-y-1.5 text-xs">
                {m.views.map((v) => (
                  <li key={v.id} className="flex flex-col gap-0.5 rounded-md border bg-muted/20 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium">{v.name}</span>
                      {v.placement ? <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{v.placement}</Badge> : null}
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">{v.id}{v.route ? ` · ${v.route}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={<Shield className="h-3.5 w-3.5" />} title={`Policies (${m.policies.length})`}>
            {m.policies.length === 0 ? <Empty text="No policies" /> : (
              <ul className="space-y-1.5 text-xs">
                {m.policies.map((p) => (
                  <li key={p.id} className="flex flex-col gap-0.5 rounded-md border bg-muted/20 p-2">
                    <span className="text-[11px] font-medium">{p.name}</span>
                    <span className="text-[10px] text-muted-foreground">{p.description}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">→ {p.enforce}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <Section icon={<GitBranch className="h-3.5 w-3.5" />} title={`Dependencies (${m.dependencies.length})`}>
            {m.dependencies.length === 0 ? <Empty text="No dependencies" /> : (
              <ul className="space-y-1.5 text-xs">
                {m.dependencies.map((d, i) => (
                  <li key={`${d.pluginName}-${i}`} className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 p-2">
                    <span className="font-mono text-[11px]">{d.pluginName}</span>
                    {d.minVersion ? <Badge variant="outline" className="h-4 px-1.5 text-[10px]">≥ {d.minVersion}</Badge> : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={<ArrowUpCircle className="h-3.5 w-3.5" />} title={`Migrations (${m.migrations.length})`}>
            {m.migrations.length === 0 ? <Empty text="No migrations" /> : (
              <ul className="space-y-1.5 text-xs">
                {m.migrations.map((mig, i) => (
                  <li key={`${mig.version}-${i}`} className="flex flex-col gap-0.5 rounded-md border bg-muted/20 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-medium">v{mig.version}</span>
                      {mig.down ? <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">rollback</Badge> : null}
                    </div>
                    <span className="text-[10px] text-muted-foreground">{mig.description}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">→ {mig.up}{mig.down ? ` / ↩ ${mig.down}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        {Object.keys(plugin.store).length > 0 ? (
          <Section icon={<Clock className="h-3.5 w-3.5" />} title="Plugin KV store (runtime state)">
            <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-[11px] leading-tight">
              {JSON.stringify(plugin.store, null, 2)}
            </pre>
          </Section>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── Capabilities panel ─────────────────────────────────────────────────

function CapabilitiesPanel({
  capabilities,
  plugins,
}: {
  capabilities: SdkCapabilitySummary[];
  plugins: SdkPluginSummary[];
}) {
  const [typeFilter, setTypeFilter] = useState<CapabilityType | 'ALL'>('ALL');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(capabilities[0]?.id ?? null);

  const pluginMap = useMemo(
    () => new Map(plugins.map((p) => [p.id, p])),
    [plugins],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return capabilities.filter((c) => {
      if (typeFilter !== 'ALL' && c.type !== typeFilter) return false;
      if (q && !c.id.toLowerCase().includes(q) && !c.name.toLowerCase().includes(q) && !c.pluginId.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [capabilities, typeFilter, query]);

  const selected = filtered.find((c) => c.id === selectedId) ?? filtered[0] ?? null;

  if (capabilities.length === 0) {
    return (
      <EmptyState
        icon={<Cpu className="h-5 w-5" />}
        title="No capabilities registered"
        description="Enable a plugin with declared capabilities to populate the registry."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Card className="h-fit">
        <CardHeader className="pb-3 space-y-3">
          <CardTitle className="text-sm">Capability browser</CardTitle>
          <div className="space-y-2">
            <Input
              placeholder="Search id, name, plugin…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 text-xs"
            />
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as CapabilityType | 'ALL')}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All types</SelectItem>
                {CAPABILITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[55vh]">
            <ul className="divide-y">
              {filtered.map((c) => {
                const isSelected = selected?.id === c.id;
                const pluginStatus = pluginMap.get(c.pluginId)?.status ?? 'unknown';
                return (
                  <li key={`${c.pluginId}:${c.id}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={`flex w-full flex-col gap-1 px-4 py-2.5 text-left transition-colors hover:bg-muted/50 ${
                        isSelected ? 'bg-muted/60' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium">{c.name}</span>
                        <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{c.type}</Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                        <span className="truncate">{c.id}</span>
                        <span className="shrink-0">{pluginStatus}</span>
                      </div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        ← {c.pluginId}
                      </div>
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 ? (
                <li className="px-4 py-8 text-center text-xs text-muted-foreground">
                  No capabilities match this filter.
                </li>
              ) : null}
            </ul>
          </ScrollArea>
        </CardContent>
      </Card>

      <div className="min-w-0">
        {selected ? (
          <CapabilityInvoker
            capability={selected}
            plugin={pluginMap.get(selected.pluginId) ?? null}
          />
        ) : (
          <EmptyState
            icon={<Cpu className="h-5 w-5" />}
            title="Select a capability"
            description="Pick a capability from the list to invoke its methods."
          />
        )}
      </div>
    </div>
  );
}

function CapabilityInvoker({
  capability,
  plugin,
}: {
  capability: SdkCapabilitySummary;
  plugin: SdkPluginSummary | null;
}) {
  const [method, setMethod] = useState('quote');
  const [argsText, setArgsText] = useState('{\n  "amount": 1000,\n  "currency": "GHS"\n}');
  const [result, setResult] = useState<{ ok: boolean; data: unknown; durationMs: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const invoke = async () => {
    setBusy(true);
    setResult(null);
    let parsedArgs: unknown = {};
    try {
      parsedArgs = argsText.trim() ? JSON.parse(argsText) : {};
    } catch (err) {
      setResult({ ok: false, data: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`, durationMs: 0 });
      setBusy(false);
      return;
    }
    try {
      const res = await fetch('/api/sdk/capabilities/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capabilityId: capability.id, method, args: parsedArgs }),
      });
      const data = await res.json().catch(() => ({ error: 'Invalid response' }));
      setResult({
        ok: res.ok && data?.ok !== false,
        data: res.ok ? data : (data?.error ?? `HTTP ${res.status}`),
        durationMs: data?.durationMs ?? 0,
      });
      if (!res.ok) toast.error(data?.error ?? `HTTP ${res.status}`);
      else toast.success(`Invoked ${capability.id}.${method} in ${data?.durationMs ?? '?'}ms`);
    } catch (err) {
      setResult({ ok: false, data: err instanceof Error ? err.message : String(err), durationMs: 0 });
      toast.error('Invocation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{capability.name}</CardTitle>
              <Badge variant="secondary" className="h-5">{capability.type}</Badge>
            </div>
            <div className="font-mono text-xs text-muted-foreground">{capability.id}</div>
            <div className="text-xs text-muted-foreground">
              Provided by <span className="font-mono">{capability.pluginId}</span>
              {plugin ? <span className="ml-1">({plugin.version})</span> : null}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {capability.config ? (
          <Section icon={<Cpu className="h-3.5 w-3.5" />} title="Capability config">
            <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-[11px] leading-tight">
              {JSON.stringify(capability.config, null, 2)}
            </pre>
          </Section>
        ) : null}

        <Separator />

        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Invoke method
          </div>
          <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
            <div className="space-y-1.5">
              <Label className="text-xs">Method name</Label>
              <Input
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                placeholder="e.g. quote, settle, status"
                className="h-8 font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Arguments (JSON)</Label>
              <Textarea
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                className="min-h-[80px] font-mono text-xs"
                rows={4}
              />
            </div>
          </div>
          <Button onClick={invoke} disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700">
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
            Invoke {capability.id}.{method || '?'}
          </Button>
        </div>

        {result ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Result
              </span>
              <div className="flex items-center gap-2">
                <Badge variant={result.ok ? 'default' : 'destructive'} className="h-5">
                  {result.ok ? 'OK' : 'ERROR'}
                </Badge>
                {result.durationMs > 0 ? (
                  <span className="text-[10px] font-mono text-muted-foreground">{result.durationMs}ms</span>
                ) : null}
              </div>
            </div>
            <pre className="max-h-72 overflow-auto rounded-md border bg-muted/30 p-3 text-[11px] leading-tight">
              {typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)}
            </pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────

function StatTile({
  label, value, icon, tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: 'emerald' | 'rose';
}) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'rose'
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-foreground';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className={`mt-2 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">{text}</div>;
}
