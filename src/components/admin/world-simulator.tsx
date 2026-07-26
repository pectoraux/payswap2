'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  Globe, Play, Loader2, CheckCircle2, AlertTriangle,
  TrendingUp, CreditCard, ArrowDownToLine, FileText, Webhook,
  Shield, BarChart3, Database, RefreshCcw, Download, Activity,
  ArrowUpRight, ArrowDownRight, Zap,
} from 'lucide-react';

interface WorldEvent {
  ts: number;
  actor: string;
  action: string;
  description: string;
  resourceType?: string;
  resourceId?: string;
}

interface NetworkSnapshot {
  totalPayments: number;
  totalVolume: number;
  totalLpRevenue: number;
  amlAlerts: number;
  webhooksDelivered: number;
  webhooksFailed: number;
}

interface NetworkImpact {
  before: NetworkSnapshot;
  after: NetworkSnapshot;
  delta: {
    payments: number;
    volume: number;
    lpRevenue: number;
    amlAlerts: number;
    webhooksDelivered: number;
    webhooksFailed: number;
  };
}

interface SimResult {
  runId: string;
  scenario: string;
  duration: string;
  paymentsCreated: number;
  payoutsCreated: number;
  refundsCreated: number;
  invoicesCreated: number;
  webhooksCreated: number;
  ledgerEntries: number;
  auditLogs: number;
  complianceAlerts: number;
  lpRevenue: number;
  totalVolume: number;
  errors: string[];
  duration_ms: number;
  events: WorldEvent[];
  networkImpact?: NetworkImpact;
}

const scenarios = [
  {
    value: 'normal',
    label: 'Normal Day',
    icon: '📊',
    short: 'Typical payment volume with standard success rates',
    description: 'Typical day with standard payment volume. 95% success rate, 3% refund rate.',
    metrics: ['95% success', '3% refunds', 'Standard volume'],
  },
  {
    value: 'holiday',
    label: 'Holiday Shopping',
    icon: '🎉',
    short: 'Higher volume, larger baskets, more refunds',
    description: 'High-volume shopping day. 15% high-value transactions, 5% refunds, 93% success.',
    metrics: ['93% success', '5% refunds', '15% high-value'],
  },
  {
    value: 'outage',
    label: 'Connector Outage',
    icon: '⚠️',
    short: 'High failure rate, manual settlements, webhook delays',
    description: 'Connector outage scenario. 30% connector failures, 25% webhook failures, 80% success.',
    metrics: ['80% success', '25% webhook fails', 'Manual settlement'],
  },
  {
    value: 'growth',
    label: 'Growth Surge',
    icon: '🚀',
    short: 'Accelerated volume with high success rates',
    description: 'Rapid growth surge. 97% success rate, elevated volume.',
    metrics: ['97% success', 'Elevated volume', 'Low risk'],
  },
  {
    value: 'stress',
    label: 'Stress Test',
    icon: '🔥',
    short: 'Extreme conditions: failures, compliance alerts, disputes',
    description: 'Extreme stress test. 15% failures, 2% compliance alerts, 88% success.',
    metrics: ['88% success', '2% AML alerts', '15% failures'],
  },
];

const durations = [
  { value: '1h', label: '1 Hour', count: '~5 payments' },
  { value: '1d', label: '1 Day', count: '~30 payments' },
  { value: '1w', label: '1 Week', count: '~80 payments' },
  { value: '1m', label: '1 Month', count: '~200 payments' },
];

// Event color map (emerald=payment, amber=refund, teal=payout, rose=AML, sky=invoice)
const EVENT_COLORS: Record<string, {
  text: string;
  bg: string;
  dot: string;
  icon: React.ReactNode;
  label: string;
}> = {
  payment: {
    text: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    dot: 'bg-emerald-500',
    icon: <CreditCard className="h-3.5 w-3.5" />,
    label: 'Payment',
  },
  refund: {
    text: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
    dot: 'bg-amber-500',
    icon: <RefreshCcw className="h-3.5 w-3.5" />,
    label: 'Refund',
  },
  payout: {
    text: 'text-teal-600 dark:text-teal-400',
    bg: 'bg-teal-500/10 border-teal-500/20',
    dot: 'bg-teal-500',
    icon: <ArrowDownToLine className="h-3.5 w-3.5" />,
    label: 'Payout',
  },
  aml_alert: {
    text: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-500/10 border-rose-500/20',
    dot: 'bg-rose-500',
    icon: <Shield className="h-3.5 w-3.5" />,
    label: 'AML Alert',
  },
  invoice: {
    text: 'text-sky-600 dark:text-sky-400',
    bg: 'bg-sky-500/10 border-sky-500/20',
    dot: 'bg-sky-500',
    icon: <FileText className="h-3.5 w-3.5" />,
    label: 'Invoice',
  },
};

export function WorldSimulator() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [scenario, setScenario] = useState('normal');
  const [duration, setDuration] = useState('1d');

  const runSimulation = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/simulate/world', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration, scenario }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Simulation failed');
      }
      const data: SimResult = await res.json();
      setResult(data);
      toast.success(`World simulation complete`, {
        description: `${data.paymentsCreated} payments · ${data.payoutsCreated} payouts · ${data.totalVolume.toLocaleString()} GHS volume`,
      });
    } catch (e) {
      toast.error('World simulation failed', { description: e instanceof Error ? e.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

  const exportTimeline = () => {
    if (!result) return;
    const payload = {
      runId: result.runId,
      scenario: result.scenario,
      duration: result.duration,
      exportedAt: new Date().toISOString(),
      summary: {
        paymentsCreated: result.paymentsCreated,
        payoutsCreated: result.payoutsCreated,
        refundsCreated: result.refundsCreated,
        invoicesCreated: result.invoicesCreated,
        webhooksCreated: result.webhooksCreated,
        complianceAlerts: result.complianceAlerts,
        lpRevenue: result.lpRevenue,
        totalVolume: result.totalVolume,
        durationMs: result.duration_ms,
      },
      events: result.events,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payswap-timeline-${result.runId.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Timeline exported', {
      description: `${result.events.length} events saved as JSON`,
    });
  };

  // Action breakdown counts for legend
  const actionCounts = result?.events?.reduce<Record<string, number>>((acc, e) => {
    acc[e.action] = (acc[e.action] || 0) + 1;
    return acc;
  }, {}) ?? {};

  return (
    <Card className="border-emerald-500/20">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4 text-emerald-500" />
          Digital Twin — World Simulator
        </CardTitle>
        <CardDescription>
          Generate realistic network activity that creates real database records. Every dashboard, report, and activity feed updates immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Scenario selection with detailed descriptions */}
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2 block">Scenario</label>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {scenarios.map((s) => (
              <button
                key={s.value}
                onClick={() => setScenario(s.value)}
                disabled={loading}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  scenario === s.value
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="text-lg mb-1">{s.icon}</div>
                <div className="text-xs font-semibold">{s.label}</div>
                <div className="text-[10px] text-muted-foreground mt-1 leading-snug">{s.description}</div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {s.metrics.map((m) => (
                    <span key={m} className="text-[9px] rounded px-1 py-0.5 bg-muted text-muted-foreground border border-border/50">
                      {m}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Duration selection */}
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2 block">Duration</label>
          <div className="grid gap-2 sm:grid-cols-4">
            {durations.map((d) => (
              <button
                key={d.value}
                onClick={() => setDuration(d.value)}
                disabled={loading}
                className={`rounded-lg border p-2.5 text-left transition-colors ${
                  duration === d.value
                    ? 'border-teal-500 bg-teal-500/10'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="text-sm font-semibold">{d.label}</div>
                <div className="text-[10px] text-muted-foreground">{d.count}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Run button */}
        <Button
          onClick={runSimulation}
          disabled={loading}
          className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {loading ? 'Generating world activity...' : 'Run World Simulation'}
        </Button>

        {/* Loading progress */}
        {loading && (
          <div className="space-y-2">
            <Progress value={undefined} className="h-1" />
            <p className="text-xs text-center text-muted-foreground">
              Creating payments, payouts, refunds, webhooks, ledger entries, audit logs...
            </p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold">Simulation Complete</div>
                <div className="text-xs text-muted-foreground font-mono">{result.runId.slice(0, 24)}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-muted-foreground">Duration</div>
                <div className="text-sm font-mono">{(result.duration_ms / 1000).toFixed(1)}s</div>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <StatCard icon={<CreditCard className="h-4 w-4" />} label="Payments" value={result.paymentsCreated} color="emerald" />
              <StatCard icon={<ArrowDownToLine className="h-4 w-4" />} label="Payouts" value={result.payoutsCreated} color="teal" />
              <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Total Volume" value={`${result.totalVolume.toLocaleString()}`} color="emerald" suffix="GHS" />
              <StatCard icon={<BarChart3 className="h-4 w-4" />} label="LP Revenue" value={result.lpRevenue.toLocaleString()} color="teal" suffix="GHS" />
              <StatCard icon={<FileText className="h-4 w-4" />} label="Refunds" value={result.refundsCreated} color="amber" />
              <StatCard icon={<FileText className="h-4 w-4" />} label="Invoices" value={result.invoicesCreated} color="emerald" />
              <StatCard icon={<Webhook className="h-4 w-4" />} label="Webhooks" value={result.webhooksCreated} color="violet" />
              <StatCard icon={<Shield className="h-4 w-4" />} label="AML Alerts" value={result.complianceAlerts} color="rose" />
              <StatCard icon={<Database className="h-4 w-4" />} label="Ledger Entries" value={result.ledgerEntries} color="emerald" />
              <StatCard icon={<Database className="h-4 w-4" />} label="Audit Logs" value={result.auditLogs} color="teal" />
            </div>

            {/* Network Impact section */}
            {result.networkImpact && (
              <NetworkImpactPanel impact={result.networkImpact} />
            )}

            {/* Cross-system effects notice */}
            <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 p-3">
              <div className="flex items-center gap-2 mb-1">
                <Globe className="h-3.5 w-3.5 text-teal-500" />
                <span className="text-xs font-semibold text-teal-600 dark:text-teal-400">Cross-System Effects</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                All records have been written to the database. The following dashboards now show new activity:
                Merchant Dashboard · Customer History · LP Revenue · Treasury Balances ·
                Compliance Queue (if alerts triggered) · Support Timeline · Activity Feed ·
                Analytics · Reports · Audit Trail · Webhook Logs
              </p>
            </div>

            {/* World Event Timeline */}
            {result.events && result.events.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    World Event Timeline
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={exportTimeline}
                    className="h-7 gap-1.5 text-[11px]"
                  >
                    <Download className="h-3 w-3" />
                    Export Timeline
                  </Button>
                </div>

                {/* Legend with counts */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {Object.entries(EVENT_COLORS).map(([action, cfg]) => {
                    const count = actionCounts[action] || 0;
                    if (count === 0 && !result.events.some(e => e.action === action)) return null;
                    return (
                      <div
                        key={action}
                        className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.bg} ${cfg.text}`}
                      >
                        {cfg.icon}
                        <span>{cfg.label}</span>
                        <span className="opacity-70 tabular-nums">×{count}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Scrollable color-coded timeline */}
                <ScrollArea className="h-72 w-full rounded-lg border bg-muted/20">
                  <div className="p-2 space-y-1">
                    {result.events.map((evt, i) => {
                      const cfg = EVENT_COLORS[evt.action] ?? EVENT_COLORS.payment;
                      // Try to extract amount from description (e.g. "...paid X 123 GHS via...")
                      const amountMatch = evt.description.match(/(\d+(?:\.\d+)?)\s+([A-Z]{3})/);
                      const amount = amountMatch ? `${amountMatch[1]} ${amountMatch[2]}` : null;
                      return (
                        <div
                          key={i}
                          className={`flex items-start gap-2 text-[11px] py-1.5 px-2 rounded border-b border-border/30 last:border-0 ${cfg.bg}`}
                        >
                          <span className="shrink-0 mt-0.5">{cfg.icon}</span>
                          <span className="font-mono text-[10px] text-muted-foreground shrink-0 w-16 tabular-nums">
                            {new Date(evt.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-baseline gap-x-1.5">
                              <span className={`font-semibold ${cfg.text}`}>{evt.actor}</span>
                              <span className="text-muted-foreground">{cfg.label.toLowerCase()}</span>
                              {amount && (
                                <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${cfg.text} border-current/20`}>
                                  {amount}
                                </Badge>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{evt.description}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
                {result.events.length > 50 && (
                  <div className="text-[10px] text-muted-foreground text-center pt-1">
                    Showing all {result.events.length} events. Use Export to download full timeline.
                  </div>
                )}
              </div>
            )}

            {/* Errors */}
            {result.errors.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-xs font-semibold text-amber-600">{result.errors.length} non-fatal errors</span>
                </div>
                <div className="max-h-32 overflow-y-auto space-y-0.5">
                  {result.errors.slice(0, 5).map((err, i) => (
                    <div key={i} className="text-[10px] text-muted-foreground font-mono">{err}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Network Impact Panel ───────────────────────────────────────────────────

function NetworkImpactPanel({ impact }: { impact: NetworkImpact }) {
  const items = [
    {
      label: 'Total Payments',
      before: impact.before.totalPayments,
      after: impact.after.totalPayments,
      delta: impact.delta.payments,
      icon: <CreditCard className="h-3.5 w-3.5" />,
      color: 'emerald' as const,
      format: 'int',
    },
    {
      label: 'Total Volume',
      before: impact.before.totalVolume,
      after: impact.after.totalVolume,
      delta: impact.delta.volume,
      icon: <TrendingUp className="h-3.5 w-3.5" />,
      color: 'teal' as const,
      format: 'currency',
    },
    {
      label: 'Total LP Revenue',
      before: impact.before.totalLpRevenue,
      after: impact.after.totalLpRevenue,
      delta: impact.delta.lpRevenue,
      icon: <BarChart3 className="h-3.5 w-3.5" />,
      color: 'emerald' as const,
      format: 'currency',
    },
    {
      label: 'AML Alerts',
      before: impact.before.amlAlerts,
      after: impact.after.amlAlerts,
      delta: impact.delta.amlAlerts,
      icon: <Shield className="h-3.5 w-3.5" />,
      color: 'rose' as const,
      format: 'int',
    },
    {
      label: 'Webhooks Delivered',
      before: impact.before.webhooksDelivered,
      after: impact.after.webhooksDelivered,
      delta: impact.delta.webhooksDelivered,
      icon: <Webhook className="h-3.5 w-3.5" />,
      color: 'teal' as const,
      format: 'int',
    },
    {
      label: 'Webhooks Failed',
      before: impact.before.webhooksFailed,
      after: impact.after.webhooksFailed,
      delta: impact.delta.webhooksFailed,
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      color: 'amber' as const,
      format: 'int',
    },
  ];

  const fmt = (val: number, format: string) => {
    if (format === 'currency') return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return val.toLocaleString();
  };

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 via-teal-500/5 to-transparent p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Activity className="h-3.5 w-3.5" />
        </div>
        <div>
          <div className="text-sm font-bold flex items-center gap-1.5">
            Network Impact
            <Zap className="h-3 w-3 text-amber-500" />
          </div>
          <div className="text-[10px] text-muted-foreground">
            Live DB state — before vs after this simulation run
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {items.map((item) => {
          const isUp = item.delta > 0;
          const isFlat = item.delta === 0;
          const deltaColor = isFlat
            ? 'text-muted-foreground'
            : (item.label === 'Webhooks Failed' || item.label === 'AML Alerts')
              ? (isUp ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')
              : (isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400');
          const colorClasses = {
            emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10',
            teal: 'text-teal-600 dark:text-teal-400 bg-teal-500/10',
            amber: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
            rose: 'text-rose-600 dark:text-rose-400 bg-rose-500/10',
          };
          return (
            <div key={item.label} className="rounded-md border bg-background/50 p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <div className={`flex h-5 w-5 items-center justify-center rounded ${colorClasses[item.color]}`}>
                  {item.icon}
                </div>
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{item.label}</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold tabular-nums">{fmt(item.after, item.format)}</span>
                {!isFlat && (
                  <span className={`flex items-center gap-0.5 text-[10px] font-medium ${deltaColor}`}>
                    {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {isUp ? '+' : ''}{fmt(item.delta, item.format)}
                  </span>
                )}
              </div>
              <div className="text-[9px] text-muted-foreground mt-0.5">
                Before: {fmt(item.before, item.format)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color, suffix }: {
  icon: React.ReactNode; label: string; value: number | string;
  color: 'emerald' | 'teal' | 'amber' | 'rose' | 'violet'; suffix?: string;
}) {
  const colors = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    teal: 'text-teal-600 dark:text-teal-400',
    amber: 'text-amber-600 dark:text-amber-400',
    rose: 'text-rose-600 dark:text-rose-400',
    violet: 'text-violet-600 dark:text-violet-400',
  };
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className={`mb-1 ${colors[color]}`}>{icon}</div>
      <div className="text-lg font-bold tabular-nums">{value}{suffix && <span className="text-xs text-muted-foreground ml-1">{suffix}</span>}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
