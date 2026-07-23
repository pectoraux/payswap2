'use client';

import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { type SimulationMetrics } from '@/kernel';
import { fmtDuration, fmtNumber } from './format';
import { Clock, Percent, ShieldCheck, Gauge, TrendingUp, ArrowLeftRight } from 'lucide-react';

const RISK_COLOR: Record<string, string> = {
  Low: 'text-emerald-600 dark:text-emerald-400',
  Moderate: 'text-amber-600 dark:text-amber-400',
  Elevated: 'text-rose-600 dark:text-rose-400',
};

export function MetricsPanel({ metrics, currency }: { metrics: SimulationMetrics; currency: string }) {
  const cards = [
    {
      label: 'Settlement Time',
      value: metrics.settlementTimeLabel,
      sub: `${fmtNumber(metrics.settlementTimeMs / 1000, 1)}s total`,
      icon: Clock,
      accent: 'text-sky-600 dark:text-sky-400',
    },
    {
      label: 'Blended Cost',
      value: `${metrics.costPercent}%`,
      sub: `${fmtNumber(metrics.totalFees, 2)} ${currency}`,
      icon: Percent,
      accent: 'text-violet-600 dark:text-violet-400',
    },
    {
      label: 'Risk Score',
      value: metrics.riskScore.toFixed(2),
      sub: metrics.riskLabel,
      icon: ShieldCheck,
      accent: RISK_COLOR[metrics.riskLabel] ?? 'text-muted-foreground',
    },
    {
      label: 'Confidence',
      value: `${metrics.confidence}%`,
      sub: 'autonomous settle band',
      icon: Gauge,
      accent: 'text-emerald-600 dark:text-emerald-400',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c, i) => {
        const Icon = c.icon;
        return (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.3 }}
          >
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

      {/* Utilization bars */}
      <Card className="col-span-2 lg:col-span-4">
        <CardContent className="space-y-3 p-3">
          <UtilBar
            label="Reserve utilization"
            value={metrics.reserveUtilization}
            icon={TrendingUp}
            hint={`${fmtNumber(metrics.reserveUtilization, 1)}% of destination reserve`}
          />
          <UtilBar
            label="Liquidity utilization"
            value={metrics.liquidityUtilization}
            icon={ArrowLeftRight}
            hint={`${fmtNumber(metrics.liquidityUtilization, 1)}% of corridor LP capacity`}
          />
          <div className="flex items-center justify-between pt-1 text-[11px]">
            <span className="text-muted-foreground">FX rate (source → target)</span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {fmtNumber(metrics.fxRate, 6)} · spread {metrics.fxSpreadBps} bps
            </Badge>
          </div>
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
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3 w-3" /> {label}
        </span>
        <span className={`font-mono font-medium ${color}`}>{hint}</span>
      </div>
      <Progress value={Math.min(100, value)} className="h-1.5" />
    </div>
  );
}
