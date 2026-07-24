'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type WorldInspector as WorldInspectorType } from '@/kernel';
import { fmtMoney, fmtNumber, flag } from './format';
import { Microscope, TrendingDown, TrendingUp, ArrowRight } from 'lucide-react';

export function WorldInspectorPanel({ inspector, currency }: { inspector: WorldInspectorType; currency: import('@/kernel').CurrencyCode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Microscope className="h-4 w-4 text-sky-500" />
          World Inspector
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Before / After summary */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border bg-muted/20 p-2">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Before</div>
            {inspector.before.reserves.map((r) => (
              <div key={r.country} className="text-[10px] font-mono">{flag(r.country)} {fmtNumber(r.available, 0)}</div>
            ))}
          </div>
          <div className="rounded-lg border bg-muted/20 p-2">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">After</div>
            {inspector.after.reserves.map((r) => (
              <div key={r.country} className="text-[10px] font-mono">{flag(r.country)} {fmtNumber(r.available, 0)}</div>
            ))}
          </div>
        </div>

        {/* Per-frame deltas */}
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Per-frame deltas</div>
        <ScrollArea className="max-h-64">
          <div className="space-y-1.5">
            {inspector.deltas.map((d) => (
              <div key={d.frame} className="rounded border border-border/60 bg-muted/10 p-1.5">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="font-mono text-[9px]">frame {d.frame}</Badge>
                  <span className="text-[9px] text-muted-foreground">{d.ledger.length} ledger · {d.events.length} events</span>
                </div>
                {d.ledger.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {d.ledger.map((e, i) => (
                      <div key={i} className="flex items-center gap-1 text-[9px]">
                        <span className="truncate">{e.account}</span>
                        {e.debit > 0 && <span className="font-mono text-rose-500">-{fmtNumber(e.debit, 0)}</span>}
                        {e.credit > 0 && <span className="font-mono text-emerald-500">+{fmtNumber(e.credit, 0)}</span>}
                        <ArrowRight className="h-2 w-2 text-muted-foreground" />
                        <span className="font-mono text-muted-foreground">{fmtNumber(e.balanceAfter, 0)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {d.twinTokens.length > 0 && (
                  <div className="mt-0.5 flex items-center gap-1 text-[9px]">
                    {d.twinTokens.map((t, i) => (
                      <Badge key={i} variant="outline" className="text-[8px] text-amber-600">{t.symbol} {t.status}</Badge>
                    ))}
                  </div>
                )}
                {d.events.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-0.5">
                    {d.events.slice(0, 4).map((e, i) => (
                      <Badge key={i} variant="outline" className="text-[7px] text-violet-600">{e.type.split('.').pop()}</Badge>
                    ))}
                    {d.events.length > 4 && <span className="text-[7px] text-muted-foreground">+{d.events.length - 4}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
