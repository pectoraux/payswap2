'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Truck, MapPin, Package, Leaf, Route as RouteIcon, Loader2, Play, Zap, Timer, DollarSign, Gauge,
  Star, Building2, BrainCircuit, AlertCircle, CheckCircle2, Shield,
} from 'lucide-react';
import {
  type ShowcaseData, type PlanRouteResult, postShowcase, pct,
} from './shared';

const PRIORITIES = [
  { id: 'FASTEST', label: 'Fastest', icon: Zap },
  { id: 'CHEAPEST', label: 'Cheapest', icon: DollarSign },
  { id: 'SAFEST', label: 'Safest', icon: Shield },
  { id: 'CARBON_OPTIMIZED', label: 'Carbon', icon: Leaf },
] as const;

function statusColor(status: string): string {
  switch (status) {
    case 'DELIVERED': return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    case 'IN_TRANSIT': case 'PICKED_UP': case 'OUT_FOR_DELIVERY':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400';
    case 'PENDING': case 'SCHEDULED':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'CANCELLED': case 'FAILED':
      return 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400';
    default: return 'border-border bg-muted text-muted-foreground';
  }
}

export function ParcelTab({ showcase }: { showcase: ShowcaseData | null }) {
  const parcel = showcase?.parcel;
  const dashboard = parcel?.dashboard;
  const transitNodes = parcel?.transitNodes ?? [];
  const providers = parcel?.providers ?? [];
  const couriers = parcel?.couriers ?? [];
  const learning = parcel?.learning;

  const [priority, setPriority] = useState<string>('CHEAPEST');
  const [route, setRoute] = useState<PlanRouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function planRoute() {
    setLoading(true); setError(null); setRoute(null);
    toast.loading(`Planning ${priority.toLowerCase()} route through transit hubs…`, { id: 'route' });
    try {
      const r = await postShowcase<PlanRouteResult>({ action: 'planRoute', priority });
      setRoute(r);
      toast.success(`${r.route.hops.length}-hop route: ${r.route.totalDistanceKm}km, ${r.route.estimatedCost}, ${r.route.estimatedCarbon}kg CO₂.`, { id: 'route' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'plan failed';
      setError(msg);
      toast.error(`Route planning failed: ${msg}`, { id: 'route' });
    } finally {
      setLoading(false);
    }
  }

  if (parcel?.error) {
    return (
      <Card className="border-rose-500/20">
        <CardContent className="flex items-center gap-2 p-4 text-sm text-rose-600">
          <AlertCircle className="h-4 w-4" /> Parcel system error: {parcel.error}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Dashboard overview */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Truck className="h-4 w-4 text-emerald-500" />
          <h3 className="text-sm font-semibold">Merchant dashboard</h3>
          <span className="text-xs text-muted-foreground">— the flagship first-party extension: 12 capabilities, event-sourced, VRP solver, distributed auction</span>
        </div>
        {dashboard && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { icon: Package, label: 'Total deliveries', value: dashboard.overview.totalDeliveries },
                { icon: Timer, label: 'In transit', value: dashboard.overview.inTransitDeliveries },
                { icon: CheckCircle2, label: 'Delivered', value: dashboard.overview.deliveredToday, sub: 'today' },
                { icon: Leaf, label: 'Carbon kg', value: dashboard.overview.totalCarbon },
                { icon: Gauge, label: 'On-time', value: pct(dashboard.overview.onTimeRate) },
              ].map((s) => (
                <Card key={s.label} className="border-emerald-500/10">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</span>
                      <s.icon className="h-3.5 w-3.5 text-emerald-500/70" />
                    </div>
                    <div className="mt-1 text-xl font-bold tabular-nums">{s.value}</div>
                    {s.sub && <div className="text-[10px] text-muted-foreground">{s.sub}</div>}
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              {/* Deliveries by status */}
              <Card className="border-emerald-500/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs">Deliveries by status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {Object.entries(dashboard.deliveriesByStatus).map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between">
                      <Badge variant="outline" className={statusColor(status)}>{status}</Badge>
                      <span className="text-sm font-semibold tabular-nums">{count}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Cost breakdown */}
              <Card className="border-emerald-500/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs">Cost breakdown</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-xs">
                  {[
                    { label: 'Delivery costs', val: dashboard.costBreakdown.deliveryCosts },
                    { label: 'Insurance', val: dashboard.costBreakdown.insuranceCosts },
                    { label: 'Auction savings', val: dashboard.costBreakdown.auctionSavings, good: true },
                    { label: 'Bundle savings', val: dashboard.costBreakdown.bundleSavings, good: true },
                    { label: 'Carbon offset', val: dashboard.costBreakdown.carbonOffsetCosts },
                  ].map((c) => (
                    <div key={c.label} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{c.label}</span>
                      <span className={`font-semibold tabular-nums ${c.good ? 'text-emerald-600' : ''}`}>{c.val}</span>
                    </div>
                  ))}
                  <Separator className="my-1" />
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Total spent</span>
                    <span className="font-bold tabular-nums">{dashboard.overview.totalSpent}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Carbon footprint */}
              <Card className="border-emerald-500/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs">Carbon footprint</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div>
                      <div className="mb-1 flex justify-between text-[11px]">
                        <span className="text-muted-foreground">Total</span>
                        <span className="font-semibold tabular-nums">{dashboard.carbonFootprint.totalKgCO2} kg</span>
                      </div>
                      <Progress value={100} className="h-1.5 bg-muted [&>div]:bg-amber-500/60" />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-[11px]">
                        <span className="text-muted-foreground">Offset</span>
                        <span className="font-semibold text-emerald-600 tabular-nums">{dashboard.carbonFootprint.offsetKgCO2} kg</span>
                      </div>
                      <Progress value={(dashboard.carbonFootprint.offsetKgCO2 / Math.max(dashboard.carbonFootprint.totalKgCO2, 1)) * 100} className="h-1.5 bg-muted [&>div]:bg-emerald-500" />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-[11px]">
                        <span className="text-muted-foreground">Net</span>
                        <span className="font-semibold tabular-nums">{dashboard.carbonFootprint.netKgCO2} kg</span>
                      </div>
                      <Progress value={(dashboard.carbonFootprint.netKgCO2 / Math.max(dashboard.carbonFootprint.totalKgCO2, 1)) * 100} className="h-1.5 bg-muted [&>div]:bg-teal-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </section>

      {/* Interactive route planner */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <RouteIcon className="h-4 w-4 text-emerald-500" />
          <h3 className="text-sm font-semibold">Multi-hop route planner</h3>
          <span className="text-xs text-muted-foreground">— Merchant → Hub → Hub → Customer, optimized by objective</span>
        </div>
        <Card className="border-emerald-500/10">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Optimize for:</span>
              {PRIORITIES.map((p) => (
                <Button
                  key={p.id}
                  size="sm" variant={priority === p.id ? 'default' : 'outline'}
                  className={`h-7 text-xs ${priority === p.id ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}`}
                  onClick={() => setPriority(p.id)}
                >
                  <p.icon className="mr-1 h-3 w-3" /> {p.label}
                </Button>
              ))}
              <Button
                size="sm" className="h-7 bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={planRoute} disabled={loading}
              >
                {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                Plan route
              </Button>
            </div>

            {error && (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600">
                <AlertCircle className="h-4 w-4" /> {error}
              </div>
            )}

            {route && (
              <div className="mt-4 space-y-3">
                <div className="rounded-md bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                  {route.message}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: 'Distance', value: `${route.route.totalDistanceKm} km`, icon: MapPin },
                    { label: 'Duration', value: `${route.route.estimatedDurationHours} h`, icon: Timer },
                    { label: 'Cost', value: route.route.estimatedCost, icon: DollarSign },
                    { label: 'Carbon', value: `${route.route.estimatedCarbon} kg`, icon: Leaf },
                  ].map((m) => (
                    <div key={m.label} className="rounded-md border border-border/60 bg-muted/30 p-2.5 text-center">
                      <m.icon className="mx-auto mb-1 h-3.5 w-3.5 text-emerald-500/70" />
                      <div className="text-sm font-bold tabular-nums">{m.value}</div>
                      <div className="text-[10px] text-muted-foreground">{m.label}</div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-600">vehicle: {route.route.vehicleType}</Badge>
                  <Badge variant="outline" className="border-border">{route.route.hops.length} hops</Badge>
                  <Badge variant="outline" className="border-border">{route.route.transitNodesUsed.length} transit nodes</Badge>
                  <Badge variant="outline" className="border-border">optimized: {route.route.optimizedFor}</Badge>
                </div>
                {/* Hop timeline */}
                <div className="space-y-1.5">
                  {route.route.hops.map((h, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-600">
                        {h.sequence}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="border-border px-1.5 py-0 text-[9px]">{h.action}</Badge>
                          <span className="truncate text-xs font-medium">{h.transitNodeName ?? h.address}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {h.transitNodeType ? `${h.transitNodeType} · ` : ''}{h.address}
                          {h.distanceFromPreviousKm > 0 && ` · ${h.distanceFromPreviousKm} km from prev`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!route && !loading && !error && (
              <div className="mt-4 flex h-32 flex-col items-center justify-center rounded-md border border-dashed border-border/60 text-center text-xs text-muted-foreground">
                <RouteIcon className="mb-2 h-6 w-6 opacity-30" />
                Click “Plan route” to discover a multi-hop path through transit hubs.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Transit nodes + Providers + Couriers + Learning */}
      <section className="grid gap-3 lg:grid-cols-2">
        <Card className="border-emerald-500/10">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-xs"><Building2 className="h-3.5 w-3.5 text-emerald-500" /> Transit nodes ({transitNodes.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-64 pr-3">
              <div className="space-y-1.5">
                {transitNodes.map((n) => (
                  <div key={n.id} className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{n.name}</span>
                      <Badge variant="outline" className="border-border px-1.5 py-0 text-[9px]">{n.type}</Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span className="inline-flex items-center gap-0.5"><Star className="h-2.5 w-2.5 text-amber-400" />{n.rating.toFixed(1)}</span>
                      <span>load: {n.currentLoadKg}/{n.capacityKg}kg</span>
                      <span className={n.congestionLevel > 0.6 ? 'text-rose-500' : n.congestionLevel > 0.3 ? 'text-amber-500' : 'text-emerald-500'}>
                        {(n.congestionLevel * 100).toFixed(0)}% congestion
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/10">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-xs"><BrainCircuit className="h-3.5 w-3.5 text-emerald-500" /> Learning engine</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {learning && (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-muted/40 px-3 py-2">
                    <div className="text-[10px] text-muted-foreground">Records</div>
                    <div className="font-bold tabular-nums">{learning.totalRecords}</div>
                  </div>
                  <div className="rounded-md bg-muted/40 px-3 py-2">
                    <div className="text-[10px] text-muted-foreground">Routes tracked</div>
                    <div className="font-bold tabular-nums">{learning.routeReliabilityCount}</div>
                  </div>
                </div>
                {[
                  { label: 'Delivery success', value: learning.avgDeliverySuccessRate, bar: '[&>div]:bg-emerald-500' },
                  { label: 'Damage rate (inverted)', value: 1 - learning.avgDamageRate, bar: '[&>div]:bg-teal-500' },
                  { label: 'Return rate (inverted)', value: 1 - learning.avgReturnRate, bar: '[&>div]:bg-sky-500' },
                ].map((m) => (
                  <div key={m.label}>
                    <div className="mb-1 flex justify-between text-[11px]">
                      <span className="text-muted-foreground">{m.label}</span>
                      <span className="font-semibold tabular-nums">{pct(m.value)}</span>
                    </div>
                    <Progress value={m.value * 100} className={`h-1.5 bg-muted ${m.bar}`} />
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground">
                  Feeds the planner: reliable routes get a 3% cost discount. {learning.courierReliabilityCount} couriers and {learning.hubCongestionCount} hubs tracked.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-emerald-500/10">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-xs"><Truck className="h-3.5 w-3.5 text-emerald-500" /> Provider adapters ({providers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-56 pr-3">
              <div className="grid gap-1.5 sm:grid-cols-2">
                {providers.map((p) => (
                  <div key={p.id} className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{p.name}</span>
                      <Badge variant="outline" className={p.enabled ? 'border-emerald-500/40 text-emerald-600' : 'border-border text-muted-foreground'}>
                        {p.enabled ? 'ON' : 'OFF'}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{p.label} · {p.jurisdictions.join(', ') || 'global'}</div>
                    <div className="text-[10px] text-emerald-600">{p.carbonPerInvocation} kg CO₂/call</div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/10">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-xs"><Star className="h-3.5 w-3.5 text-emerald-500" /> Top couriers ({couriers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-56 pr-3">
              <div className="space-y-1.5">
                {couriers.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                    <div>
                      <div className="text-xs font-medium">{c.name}</div>
                      <div className="text-[10px] text-muted-foreground">{c.totalDeliveries} deliveries</div>
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      <span className="font-semibold tabular-nums">{c.rating.toFixed(1)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
