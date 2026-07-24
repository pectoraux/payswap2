'use client';

import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { type PlanMetrics } from '@/kernel';
import { fmtDuration, fmtNumber } from './format';
import { Clock, Percent, ShieldCheck, Gauge, TrendingUp, ArrowLeftRight, ShieldAlert } from 'lucide-react';

const RISK_COLOR: Record<string, string> = {
  Low: 'text-emerald-600 dark:text-emerald-400',
  Moderate: 'text-amber-600 dark:text-amber-400',
  Elevated: 'text-orange-600 dark:text-orange-400',
  High: 'text-rose-600 dark:text-rose-400',
};

export function MetricsPanel({ metrics, currency, settled }: { metrics: PlanMetrics; currency: string; settled: boolean }) {
  const cards = [
    { label: 'Settlement Time', value: metrics.settlementTimeLabel, sub: `${fmtNumber(metrics.settlementTimeMs / 1000, 1)}s total`, icon: Clock, accent: 'text-sky-600 dark:text-sky-400' },
    { label: 'Blended Cost', value: `${metrics.costPercent}%`, sub: `${fmtNumber(metrics.totalFees, 2)} ${currency}`, icon: Percent, accent: 'text-violet-600 dark:text-violet-400' },
    { label: 'Risk Score', value: metrics.riskScore.toFixed(2), sub: metrics.riskLabel, icon: ShieldCheck, accent: RISK_COLOR[metrics.riskLabel] ?? 'text-muted-foreground' },
    { label: 'Confidence', value: `${metrics.confidence}%`, sub: settled ? 'autonomous settle' : 'blocked', icon: Gauge, accent: 'text-emerald-600 dark:text-emerald-400' },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c, i) => {
          const Icon = c.icon;
          return (
            <motion.div key={c.label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, duration: 0.25 }}>
              <Card className="overflow-hidden">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{c.label}</span>
                    <Icon className={`h-3.5 w-3.5 ${c.accent}`} />
                  </div>
                  <div className={`mt-1 font-mono text-xl font-bold ${c.accent}`}>{c.value}</div>
                  <div className="text-[10px] text-muted-foreground">{c.sub}</div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <Card>
        <CardContent className="space-y-3 p-3">
          <UtilBar label="Reserve utilization" value={metrics.reserveUtilization} icon={TrendingUp} hint={`${fmtNumber(metrics.reserveUtilization, 1)}% of destination reserve`} />
          <UtilBar label="Liquidity utilization" value={metrics.liquidityUtilization} icon={ArrowLeftRight} hint={`${fmtNumber(metrics.liquidityUtilization, 1)}% of corridor LP capacity`} />
          <div className="flex items-center justify-between pt-1 text-[11px]">
            <span className="text-muted-foreground">FX rate (source → target) · spread</span>
            <Badge variant="outline" className="font-mono text-[10px]">{fmtNumber(metrics.fxRate, 6)} · {metrics.fxSpreadBps} bps</Badge>
          </div>
          {metrics.insuranceExposure > 0 && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1 text-muted-foreground"><ShieldAlert className="h-3 w-3 text-rose-500" /> Insurance exposure</span>
              <Badge variant="outline" className="font-mono text-[10px] text-rose-600 dark:text-rose-400">{fmtNumber(metrics.insuranceExposure, 2)} {currency}</Badge>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UtilBar({ label, value, icon: Icon, hint }: { label: string; value: number; icon: typeof Clock; hint: string }) {
  const color = value > 80 ? 'text-rose-500' : value > 50 ? 'text-amber-500' : 'text-emerald-500';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1.5 text-muted-foreground"><Icon className="h-3 w-3" /> {label}</span>
        <span className={`font-mono font-medium ${color}`}>{hint}</span>
      </div>
      <Progress value={Math.min(100, value)} className="h-1.5" />
    </div>
  );
}
