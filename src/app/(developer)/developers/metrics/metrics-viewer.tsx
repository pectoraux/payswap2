'use client';

import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import {
  Activity,
  Webhook,
  CreditCard,
  AlertCircle,
  TrendingUp,
} from 'lucide-react';

interface Metrics {
  apiCalls24h: number;
  webhookDeliveries24h: number;
  webhookSuccess24h: number;
  testPayments24h: number;
  errorRate: number;
  errors24h: number;
}

interface Bucket {
  ts: number;
  count: number;
  errors: number;
}

interface Props {
  initialMetrics: Metrics | null;
  initialBuckets: Bucket[];
}

function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ReactNode;
  tone: 'emerald' | 'teal' | 'amber' | 'rose' | 'cyan' | 'violet';
}) {
  const toneClasses: Record<string, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    teal: 'text-teal-600 dark:text-teal-400',
    amber: 'text-amber-600 dark:text-amber-400',
    rose: 'text-rose-600 dark:text-rose-400',
    cyan: 'text-cyan-600 dark:text-cyan-400',
    violet: 'text-violet-600 dark:text-violet-400',
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span className={toneClasses[tone]}>{icon}</span>
        </div>
        <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
        {hint && <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

const chartConfig = {
  count: {
    label: 'API calls',
    color: '#10b981',
  },
  errors: {
    label: 'Errors',
    color: '#f43f5e',
  },
};

function fmtHour(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function MetricsViewer({ initialMetrics, initialBuckets }: Props) {
  const [metrics, setMetrics] = React.useState<Metrics | null>(initialMetrics);
  const [buckets, setBuckets] = React.useState<Bucket[]>(initialBuckets);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/developer/metrics', { cache: 'no-store' });
        const data = await res.json();
        if (!cancelled && data.ok) {
          setMetrics(data.metrics);
          setBuckets(data.timeseries.buckets);
        }
      } catch (err) {
        console.error('[metrics] reload failed:', err);
      }
    }
    // Refresh every 30s.
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const errorPct = metrics ? (metrics.errorRate * 100).toFixed(1) : '0.0';
  const webhookSuccessPct =
    metrics && metrics.webhookDeliveries24h > 0
      ? ((metrics.webhookSuccess24h / metrics.webhookDeliveries24h) * 100).toFixed(0)
      : '—';

  const chartData = buckets.map((b) => ({
    hour: fmtHour(b.ts),
    count: b.count,
    errors: b.errors,
  }));

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="API calls (24h)"
          value={metrics?.apiCalls24h ?? 0}
          hint="Authenticated requests"
          icon={<Activity className="h-4 w-4" />}
          tone="emerald"
        />
        <StatCard
          label="Webhook deliveries (24h)"
          value={metrics?.webhookDeliveries24h ?? 0}
          hint={`${webhookSuccessPct}% delivered successfully`}
          icon={<Webhook className="h-4 w-4" />}
          tone="teal"
        />
        <StatCard
          label="Test payments (24h)"
          value={metrics?.testPayments24h ?? 0}
          hint="Payment actions in audit log"
          icon={<CreditCard className="h-4 w-4" />}
          tone="cyan"
        />
        <StatCard
          label="Error rate (24h)"
          value={`${errorPct}%`}
          hint={`${metrics?.errors24h ?? 0} error${(metrics?.errors24h ?? 0) === 1 ? '' : 's'}`}
          icon={<AlertCircle className="h-4 w-4" />}
          tone={parseFloat(errorPct) > 5 ? 'rose' : 'emerald'}
        />
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                API calls per hour (last 24h)
              </CardTitle>
              <CardDescription>
                Stacked bars show total calls (emerald) and errors (rose).
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-[10px]">
              Live · auto-refreshes every 30s
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              No data yet. Make an API call to populate this chart.
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    interval={2}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3 }}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="count" fill={chartConfig.count.color} radius={[4, 4, 0, 0]} name="API calls" />
                  <Bar dataKey="errors" fill={chartConfig.errors.color} radius={[4, 4, 0, 0]} name="Errors" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rate limits</CardTitle>
          <CardDescription>
            Per-key token bucket — 1000 req/min default. Contact support to raise.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Window</th>
                  <th className="pb-2 pr-3 font-medium">Limit</th>
                  <th className="pb-2 pr-3 font-medium">Burst</th>
                  <th className="pb-2 text-right font-medium">Used (24h)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b last:border-0">
                  <td className="py-2 pr-3">Per API key</td>
                  <td className="py-2 pr-3 font-mono">1000 req/min</td>
                  <td className="py-2 pr-3 font-mono">1000</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {metrics?.apiCalls24h ?? 0}
                  </td>
                </tr>
                <tr className="border-b last:border-0">
                  <td className="py-2 pr-3">Webhook deliveries</td>
                  <td className="py-2 pr-3 font-mono">unlimited</td>
                  <td className="py-2 pr-3 font-mono">—</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {metrics?.webhookDeliveries24h ?? 0}
                  </td>
                </tr>
                <tr className="border-b last:border-0">
                  <td className="py-2 pr-3">Sandbox reset</td>
                  <td className="py-2 pr-3 font-mono">10/hour</td>
                  <td className="py-2 pr-3 font-mono">—</td>
                  <td className="py-2 text-right font-mono tabular-nums">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
