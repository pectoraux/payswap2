'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { type GraphSnapshot } from '@/kernel';
import { Network, Wallet, Landmark, Coins, Banknote, CreditCard, Shield } from 'lucide-react';

const NODE_STYLE: Record<string, { icon: typeof Wallet; color: string; bg: string }> = {
  wallet: { icon: Wallet, color: 'text-sky-500', bg: 'bg-sky-500/10 border-sky-500/30' },
  reserve: { icon: Landmark, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/30' },
  lp: { icon: Coins, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  treasury: { icon: Banknote, color: 'text-violet-500', bg: 'bg-violet-500/10 border-violet-500/30' },
  stablecoin: { icon: Banknote, color: 'text-violet-500', bg: 'bg-violet-500/10 border-violet-500/30' },
  fo: { icon: CreditCard, color: 'text-teal-500', bg: 'bg-teal-500/10 border-teal-500/30' },
  insurance_pool: { icon: Shield, color: 'text-rose-500', bg: 'bg-rose-500/10 border-rose-500/30' },
};

export function FinancialGraphPanel({ graph }: { graph: GraphSnapshot }) {
  // Group nodes by type for display.
  const byType = graph.nodes.reduce<Record<string, typeof graph.nodes>>((acc, n) => {
    (acc[n.type] ??= []).push(n);
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-4 w-4 text-emerald-500" />
            Financial Graph
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">{graph.nodes.length} nodes</Badge>
            <Badge variant="outline" className="text-[10px]">{graph.edges.length} edges</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {Object.entries(byType).map(([type, nodes]) => {
          const style = NODE_STYLE[type] ?? NODE_STYLE.wallet;
          const Icon = style.icon;
          return (
            <div key={type}>
              <div className={`mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${style.color}`}>
                <Icon className="h-3 w-3" /> {type.replace('_', ' ')} ({nodes.length})
              </div>
              <div className="space-y-1">
                {nodes.map((n) => (
                  <div key={n.id} className={`flex items-center gap-2 rounded border ${style.bg} px-2 py-1`}>
                    <Icon className={`h-3 w-3 shrink-0 ${style.color}`} />
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{n.label}</span>
                    {n.country && <span className="text-[10px]">{n.country}</span>}
                    <span className="font-mono text-[10px] text-muted-foreground">{n.balance.toLocaleString()}</span>
                    {!n.online && <Badge variant="destructive" className="h-3.5 px-1 text-[8px]">off</Badge>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Edge summary */}
        <div className="pt-1">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Edges (weighted)</div>
          <div className="max-h-40 space-y-0.5 overflow-y-auto">
            {graph.edges.slice(0, 12).map((e) => (
              <div key={e.id} className="flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground">
                <span className="truncate">{e.from.replace(':', ' ')}</span>
                <span className="text-emerald-500">→</span>
                <span className="truncate">{e.to.replace(':', ' ')}</span>
                <Badge variant="outline" className="ml-auto text-[8px]">{e.kind}</Badge>
                <span className="w-12 text-right">{e.cost}bps</span>
              </div>
            ))}
            {graph.edges.length > 12 && <div className="text-[9px] text-muted-foreground">+{graph.edges.length - 12} more…</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
