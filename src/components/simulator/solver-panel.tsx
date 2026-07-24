'use client';

import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { type SolverCandidateSummary, type TransitionSummary } from '@/kernel';
import { fmtDuration, fmtNumber } from './format';
import { Cpu, Trophy, CheckCircle2, XCircle, ArrowRight, Zap } from 'lucide-react';

export function SolverPanel({ candidates }: { candidates: SolverCandidateSummary[] }) {
  const winner = candidates.find((c) => c.selected);
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4 text-violet-500" />
            Constraint Solver
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
              {winner.transitionCount} transitions · cost {fmtNumber(winner.totalCost, 2)} · {fmtDuration(winner.totalLatencyMs)} · risk {winner.riskScore.toFixed(2)} · score {winner.weightedScore.toFixed(4)}
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
              <span className="font-mono text-[10px] text-muted-foreground">{c.weightedScore.toFixed(4)}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge variant="outline" className="text-[9px]">{c.transitionCount} transitions</Badge>
              <Badge variant="outline" className="text-[9px]">cost {fmtNumber(c.totalCost, 2)}</Badge>
              <Badge variant="outline" className="text-[9px]">{fmtDuration(c.totalLatencyMs)}</Badge>
              <Badge variant="outline" className="text-[9px]">risk {c.riskScore.toFixed(2)}</Badge>
              {c.usesReserve && <Badge variant="outline" className="text-[9px] text-amber-600">reserve</Badge>}
              {c.usesTreasury && <Badge variant="outline" className="text-[9px] text-violet-600">treasury</Badge>}
            </div>
            {c.rejectionReason && <div className="mt-1 text-[9px] text-muted-foreground">{c.rejectionReason}</div>}
          </motion.div>
        ))}
        <div className="mt-2 rounded-md bg-muted/20 p-2 text-[10px] text-muted-foreground">
          <Zap className="inline h-3 w-3 text-emerald-500 mr-1" />
          The solver never knows finance — it queries capabilities ("who canBridge?") and the graph answers.
        </div>
      </CardContent>
    </Card>
  );
}

export function TransitionsPanel({ transitions }: { transitions: TransitionSummary[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowRight className="h-4 w-4 text-sky-500" />
          Transitions (atomic units)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {transitions.map((t, i) => (
          <motion.div key={t.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
            className="flex items-center gap-2 rounded border border-border/60 bg-muted/10 px-2 py-1.5">
            <Badge variant="outline" className="font-mono text-[9px] shrink-0">T{i + 1}</Badge>
            <Badge variant="outline" className="text-[8px] text-violet-600 shrink-0">{t.capability}</Badge>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-medium">{t.command}</div>
              <div className="truncate font-mono text-[9px] text-muted-foreground">{t.entityType}:{t.entityId}</div>
            </div>
            <span className="font-mono text-[9px] text-muted-foreground">{t.fromState}</span>
            <ArrowRight className="h-2.5 w-2.5 text-emerald-500" />
            <span className="font-mono text-[9px] font-medium text-emerald-600">{t.toState}</span>
            {t.amount != null && <span className="font-mono text-[10px] font-semibold">{t.amount.toLocaleString()}</span>}
          </motion.div>
        ))}
      </CardContent>
    </Card>
  );
}
