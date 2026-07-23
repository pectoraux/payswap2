'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { type WorldStateResult } from '@/kernel';
import { fmtMoney, flag } from './format';
import { Landmark, Coins, TrendingDown, TrendingUp } from 'lucide-react';

export function WorldStatePanel({ world, currency }: { world: WorldStateResult; currency: import('@/kernel').CurrencyCode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">World State (after)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
            <Landmark className="h-3 w-3" /> Reserves
          </div>
          {world.reserves.map((r) => {
            const pct = r.balanceBefore > 0 ? (r.balanceAfter / r.balanceBefore) * 100 : 0;
            return (
              <div key={r.country} className="rounded-lg border bg-muted/20 p-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    {flag(r.country)} {r.country}
                  </span>
                  <Badge variant={r.healthy ? 'outline' : 'destructive'} className="text-[9px]">
                    {r.healthy ? 'healthy' : 'below threshold'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="font-mono">{fmtMoney(r.balanceBefore, r.currency)}</span>
                  <span className="font-mono">→ {fmtMoney(r.balanceAfter, r.currency)}</span>
                </div>
                <Progress value={Math.max(0, Math.min(100, pct))} className="mt-1.5 h-1" />
                <div className="mt-1 flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">min {fmtMoney(r.minThreshold, r.currency)}</span>
                  <span className={`flex items-center gap-0.5 font-mono ${r.delta < 0 ? 'text-rose-500' : r.delta > 0 ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                    {r.delta < 0 ? <TrendingDown className="h-2.5 w-2.5" /> : r.delta > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : null}
                    {r.delta > 0 ? '+' : ''}{fmtMoney(r.delta, r.currency)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-500">
            <Coins className="h-3 w-3" /> Liquidity Providers
          </div>
          {world.liquidityProviders.map((lp) => {
            const pct = lp.capacity > 0 ? (lp.remaining / lp.capacity) * 100 : 0;
            return (
              <div key={lp.lpId} className="rounded-lg border bg-muted/20 p-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-xs font-medium">LP{lp.lpId} {flag(lp.country)}</span>
                  <Badge variant="outline" className="text-[9px]">{lp.rate}%</Badge>
                </div>
                <Progress value={pct} className="h-1" />
                <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="font-mono">used {fmtMoney(lp.used, lp.currency)}</span>
                  <span className="font-mono">{fmtMoney(lp.remaining, lp.currency)} left</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
