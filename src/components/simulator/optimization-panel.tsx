'use client';

import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { type CandidatePlanSummary } from '@/kernel';
import { fmtDuration, fmtNumber } from './format';
import { Cpu, CheckCircle2, XCircle, Trophy } from 'lucide-react';

export function OptimizationPanel({ candidates }: { candidates: CandidatePlanSummary[] }) {
  const winner = candidates.find((c) => c.selected);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4 text-violet-500" />
            Optimization Engine
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">{candidates.length} candidates</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {winner && (
          <div className="mb-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <Trophy className="h-3 w-3" /> WINNER: {winner.label}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              weighted score {winner.weightedScore} · cost {winner.costPercent}% · {fmtDuration(winner.settlementTimeMs)} · risk {winner.riskScore.toFixed(2)}
            </div>
          </div>
        )}
        {candidates.map((c, i) => (
          <motion.div key={c.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
            className={`rounded-lg border p-2 ${c.selected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-muted/20'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium">
                {c.selected ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-muted-foreground" />}
                {c.label}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">{c.weightedScore}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge variant="outline" className="text-[9px]">{c.costPercent}% cost</Badge>
              <Badge variant="outline" className="text-[9px]">{fmtDuration(c.settlementTimeMs)}</Badge>
              <Badge variant="outline" className="text-[9px]">risk {c.riskScore.toFixed(2)}</Badge>
              <Badge variant="outline" className="text-[9px]">{c.lpCount} LPs</Badge>
              {c.usesReserve && <Badge variant="outline" className="text-[9px] text-amber-600">reserve</Badge>}
              {c.usesTreasury && <Badge variant="outline" className="text-[9px] text-violet-600">treasury</Badge>}
            </div>
            {c.rejectionReason && (
              <div className="mt-1 text-[9px] text-muted-foreground">{c.rejectionReason}</div>
            )}
            {c.selected && c.objectiveScores.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {c.objectiveScores.map((s) => (
                  <div key={s.objective}>
                    <div className="flex justify-between text-[9px]">
                      <span className="text-muted-foreground">{s.objective.replace(/([A-Z])/g, ' $1').replace(/^./, (ch) => ch.toUpperCase())}</span>
                      <span className="font-mono">{Math.round(s.score * 100)}%</span>
                    </div>
                    <Progress value={s.score * 100} className="h-0.5" />
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        ))}
      </CardContent>
    </Card>
  );
}
