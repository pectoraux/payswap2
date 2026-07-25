'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import {
  Globe, Play, Loader2, CheckCircle2, AlertTriangle,
  TrendingUp, CreditCard, ArrowDownToLine, FileText, Webhook,
  Shield, BarChart3, Database, RefreshCcw,
} from 'lucide-react';

interface WorldEvent {
  ts: number;
  actor: string;
  action: string;
  description: string;
  resourceType?: string;
  resourceId?: string;
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
}

const scenarios = [
  { value: 'normal', label: 'Normal Day', desc: 'Typical payment volume with standard success rates', icon: '📊' },
  { value: 'holiday', label: 'Holiday Shopping', desc: 'Higher volume, larger baskets, more refunds', icon: '🎉' },
  { value: 'outage', label: 'Connector Outage', desc: 'High failure rate, manual settlements, webhook delays', icon: '⚠️' },
  { value: 'growth', label: 'Growth Surge', desc: 'Accelerated volume with high success rates', icon: '🚀' },
  { value: 'stress', label: 'Stress Test', desc: 'Extreme conditions: failures, compliance alerts, disputes', icon: '🔥' },
];

const durations = [
  { value: '1h', label: '1 Hour', count: '~5 payments' },
  { value: '1d', label: '1 Day', count: '~30 payments' },
  { value: '1w', label: '1 Week', count: '~80 payments' },
  { value: '1m', label: '1 Month', count: '~200 payments' },
];

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
        description: `${data.paymentsCreated} payments · ${data.payoutsCreated} payouts · ${data.totalVolume} GHS volume`,
      });
    } catch (e) {
      toast.error('World simulation failed', { description: e instanceof Error ? e.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

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
        {/* Scenario selection */}
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
                <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{s.desc}</div>
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
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">World Event Timeline</div>
                <div className="max-h-64 overflow-y-auto rounded-lg border bg-muted/20 p-2 space-y-1">
                  {result.events.slice(0, 30).map((evt, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] py-1 border-b border-border/30 last:border-0">
                      <span className="font-mono text-[10px] text-muted-foreground shrink-0 w-16">
                        {new Date(evt.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="shrink-0">
                        {evt.action === 'payment' && <CreditCard className="h-3 w-3 text-emerald-500" />}
                        {evt.action === 'refund' && <RefreshCcw className="h-3 w-3 text-amber-500" />}
                        {evt.action === 'payout' && <ArrowDownToLine className="h-3 w-3 text-teal-500" />}
                        {evt.action === 'invoice' && <FileText className="h-3 w-3 text-sky-500" />}
                        {evt.action === 'aml_alert' && <Shield className="h-3 w-3 text-rose-500" />}
                      </span>
                      <span className="flex-1 min-w-0 text-muted-foreground">{evt.description}</span>
                    </div>
                  ))}
                  {result.events.length > 30 && (
                    <div className="text-[10px] text-muted-foreground text-center pt-1">
                      ...and {result.events.length - 30} more events
                    </div>
                  )}
                </div>
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
