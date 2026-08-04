'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Network, GitBranch, Boxes, Target, ShieldCheck, BookOpen, BrainCircuit,
  Activity, CheckCircle2, XCircle, Layers, Cpu, Globe2, Scale,
} from 'lucide-react';
import {
  type ShowcaseData, type PublicState, pct,
} from './shared';

interface Props {
  showcase: ShowcaseData | null;
  pub: PublicState | null;
}

function StatCard({ icon: Icon, label, value, sub }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string;
}) {
  return (
    <Card className="border-emerald-500/10">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
          <Icon className="h-4 w-4 text-emerald-500/70" />
        </div>
        <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function OverviewTab({ showcase, pub }: Props) {
  const ekg = showcase?.ekg;
  const ov = ekg?.overview;
  const health = pub?.health;
  const verification = pub?.verification;

  return (
    <div className="space-y-6">
      {/* EKG stats */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Network className="h-4 w-4 text-emerald-500" />
          <h3 className="text-sm font-semibold">Economic Knowledge Graph</h3>
          <span className="text-xs text-muted-foreground">— a unified typed property graph where prove(goal) is theorem proving</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard icon={Layers} label="Nodes" value={ov?.nodeCount ?? '—'} sub="temporal versioned" />
          <StatCard icon={GitBranch} label="Relationships" value={ov?.relationshipCount ?? '—'} sub="typed edges" />
          <StatCard icon={Boxes} label="Entities" value={ov?.entityCount ?? '—'} sub="organizations, APIs, banks" />
          <StatCard icon={Cpu} label="Capabilities" value={ov?.capabilityCount ?? '—'} sub="produces assets" />
          <StatCard icon={Target} label="Goals" value={ov?.goalCount ?? '—'} sub="provable targets" />
          <StatCard icon={Scale} label="Policies" value={ov?.policyCount ?? '—'} sub="enforced rules" />
          <StatCard icon={Globe2} label="Jurisdictions" value={ov?.jurisdictionCount ?? '—'} sub="regulatory zones" />
          <StatCard icon={BrainCircuit} label="Memories" value={ov?.memoryCount ?? '—'} sub="self-improving" />
        </div>
      </section>

      {/* Network health */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-500" />
          <h3 className="text-sm font-semibold">Network Health</h3>
          {pub && (
            <Badge variant="outline" className={verification?.allInvariantsHold ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400' : 'border-rose-500/40 text-rose-600'}>
              {verification?.allInvariantsHold ? 'All invariants hold' : 'Invariant violation'}
            </Badge>
          )}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="border-emerald-500/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Health indicators</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: 'Global health score', value: health?.globalScore ?? 0, max: 100, fmt: (v: number) => v.toFixed(1) },
                { label: 'Reserve coverage', value: health?.reserveCoverage ?? 0, max: 100, fmt: (v: number) => `${v}%` },
                { label: 'Settlement success rate', value: health?.settlementSuccessRate ?? 0, max: 100, fmt: (v: number) => `${v}%` },
                { label: 'Twin-token backing', value: health?.twinTokenBacking ?? 0, max: 100, fmt: (v: number) => `${v}%` },
                { label: 'Solvency ratio', value: (health?.solvencyRatio ?? 0) * 100, max: 100, fmt: (v: number) => `${(v / 100).toFixed(2)}` },
              ].map((m) => (
                <div key={m.label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{m.label}</span>
                    <span className="font-medium tabular-nums">{m.fmt(m.value)}</span>
                  </div>
                  <Progress value={m.value} className="h-1.5 bg-muted [&>div]:bg-gradient-to-r [&>div]:from-emerald-500 [&>div]:to-teal-400" />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-emerald-500/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Formal invariants</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {verification?.invariants.map((inv) => (
                <div key={inv.name} className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs">
                    {inv.holds ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-rose-500" />
                    )}
                    <span className="font-medium">{inv.name}</span>
                  </div>
                  <Badge variant="outline" className={inv.holds ? 'border-emerald-500/40 text-emerald-600' : 'border-rose-500/40 text-rose-600'}>
                    {inv.holds ? 'HOLDS' : 'VIOLATED'}
                  </Badge>
                </div>
              )) ?? (
                <div className="text-xs text-muted-foreground">Loading invariants…</div>
              )}
              <Separator className="my-2" />
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="text-muted-foreground">Settlement latency</div>
                  <div className="font-semibold tabular-nums">{pub?.settlementLatencyMs ?? '—'} ms</div>
                </div>
                <div className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="text-muted-foreground">Reserve growth 30d</div>
                  <div className="font-semibold text-emerald-600 tabular-nums">+{pct(pub?.reserveGrowth30d ?? 0)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Goals preview */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-emerald-500" />
          <h3 className="text-sm font-semibold">Provable goals</h3>
          <span className="text-xs text-muted-foreground">— pick one in the Economic Graph tab to run prove()</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ekg?.goals.map((g) => (
            <Card key={g.id} className="border-emerald-500/10">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold">{g.name}</h4>
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500/60" />
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{g.description}</p>
                <div className="mt-2 truncate rounded bg-muted/40 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                  target: {g.targetAsset}
                </div>
              </CardContent>
            </Card>
          )) ?? null}
        </div>
      </section>
    </div>
  );
}
