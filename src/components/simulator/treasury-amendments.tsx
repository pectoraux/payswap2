'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { type TreasuryRecommendation, type PlanAmendment } from '@/kernel';
import { Banknote, AlertTriangle, GitBranch } from 'lucide-react';

const PRIORITY_COLOR: Record<string, string> = {
  high: 'text-rose-500 bg-rose-500/10',
  medium: 'text-amber-500 bg-amber-500/10',
  low: 'text-sky-500 bg-sky-500/10',
};

export function TreasuryAIPanel({ recommendations }: { recommendations: TreasuryRecommendation[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Banknote className="h-4 w-4 text-violet-500" /> Treasury AI
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {recommendations.length === 0 ? (
          <div className="text-xs text-muted-foreground">No active recommendations. Treasury is healthy.</div>
        ) : (
          recommendations.map((r) => (
            <div key={r.id} className="rounded-lg border bg-muted/20 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{r.action}</span>
                <Badge variant="outline" className={`text-[9px] ${PRIORITY_COLOR[r.priority]}`}>{r.priority}</Badge>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">{r.rationale}</div>
              <div className="mt-1 text-[10px] font-mono text-emerald-600 dark:text-emerald-400">↪ {r.estimatedImpact}</div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function AmendmentsPanel({ amendments }: { amendments: PlanAmendment[] }) {
  if (amendments.length === 0) return null;
  return (
    <Card className="border-rose-500/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-rose-600 dark:text-rose-400">
          <AlertTriangle className="h-4 w-4" /> Plan Amendments ({amendments.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {amendments.map((a) => (
          <div key={a.id} className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium">
                <GitBranch className="h-3 w-3 text-rose-500" /> {a.triggeredBy.label}
              </span>
              <Badge variant="outline" className="text-[9px] text-emerald-600">frame {a.insertedAtFrame}</Badge>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">{a.reason}</div>
            <div className="mt-1 flex items-center gap-1.5 text-[10px]">
              <span className="text-muted-foreground">Recovery:</span>
              <Badge variant="outline" className="text-[9px] text-emerald-600 dark:text-emerald-400">{a.recoveryStrategy}</Badge>
              <span className="text-muted-foreground">· {a.steps.length} step(s)</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
