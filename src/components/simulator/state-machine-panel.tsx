'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { type StateTransitionSummary } from '@/kernel';
import { GitBranch, ArrowRight } from 'lucide-react';

export function StateMachinePanel({ transitions }: { transitions: StateTransitionSummary[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitBranch className="h-4 w-4 text-sky-500" />
          State Machine Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {transitions.length === 0 ? (
          <div className="text-xs text-muted-foreground">No state transitions.</div>
        ) : (
          <div className="space-y-1">
            {transitions.map((t, i) => (
              <div key={t.id} className="flex items-center gap-2 rounded border border-border/60 bg-muted/10 px-2 py-1.5">
                <span className="font-mono text-[9px] text-muted-foreground">{i + 1}</span>
                <Badge variant="outline" className="text-[9px]">{t.objectKind}</Badge>
                <span className="font-mono text-[10px] text-muted-foreground">{t.from}</span>
                <ArrowRight className="h-2.5 w-2.5 text-emerald-500" />
                <span className="font-mono text-[10px] font-medium text-emerald-600 dark:text-emerald-400">{t.to}</span>
                <span className="ml-auto truncate text-[9px] text-muted-foreground">{t.reason}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
