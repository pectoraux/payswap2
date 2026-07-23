'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { type LPLifecycleEvent } from '@/kernel';
import { Coins, ArrowUpCircle, ArrowDownCircle, RefreshCw, Ban, CheckCircle, AlertTriangle } from 'lucide-react';

const ACTION_STYLE: Record<string, { icon: typeof Coins; color: string }> = {
  mint: { icon: Coins, color: 'text-amber-500' },
  stake: { icon: ArrowUpCircle, color: 'text-emerald-500' },
  trade: { icon: RefreshCw, color: 'text-sky-500' },
  withdraw: { icon: ArrowDownCircle, color: 'text-rose-500' },
  restake: { icon: ArrowUpCircle, color: 'text-emerald-500' },
  suspend: { icon: Ban, color: 'text-rose-500' },
  reactivate: { icon: CheckCircle, color: 'text-emerald-500' },
  slash: { icon: AlertTriangle, color: 'text-rose-500' },
};

export function LPLifecyclePanel({ events }: { events: LPLifecycleEvent[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="h-4 w-4 text-emerald-500" />
          LP Lifecycle
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <div className="text-xs text-muted-foreground">No lifecycle events.</div>
        ) : (
          <div className="space-y-1">
            {events.map((e) => {
              const style = ACTION_STYLE[e.action] ?? ACTION_STYLE.trade;
              const Icon = style.icon;
              return (
                <div key={e.id} className="flex items-center gap-2 rounded border border-border/60 bg-muted/10 px-2 py-1">
                  <Icon className={`h-3 w-3 shrink-0 ${style.color}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium">LP{e.lpId} — {e.action}</div>
                    <div className="truncate text-[9px] text-muted-foreground">{e.detail}</div>
                  </div>
                  {e.amount != null && <Badge variant="outline" className="font-mono text-[9px]">{e.amount.toLocaleString()}</Badge>}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
