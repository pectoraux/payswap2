'use client';

import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { type AIRecommendation, type AlternativePlan, type ObjectiveScore } from '@/kernel';
import { Brain, Sparkles, CheckCircle2, GitBranch, TrendingDown, TrendingUp, Minus } from 'lucide-react';

export function AIReasoningView({ reasoning }: { reasoning: AIRecommendation }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4 text-violet-500" />
            AI Agent Reasoning
          </CardTitle>
          <Badge variant={reasoning.llmPowered ? 'default' : 'secondary'}
            className={`gap-1 text-[10px] ${reasoning.llmPowered ? 'bg-violet-600 hover:bg-violet-600 text-white' : ''}`}>
            <Sparkles className="h-3 w-3" />{reasoning.llmPowered ? 'LLM' : 'deterministic'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border bg-muted/30 p-2.5">
          <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Strategy</div>
          <div className="text-sm font-medium">{reasoning.strategy}</div>
          <div className="mt-1 flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">weighted objective score</span>
            <span className="font-mono font-semibold text-violet-600 dark:text-violet-400">{reasoning.weightedScore.toFixed(4)}</span>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-foreground/90">{reasoning.narrative}</p>

        {/* Objective scores */}
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Objective scores (explainable)</div>
          {reasoning.objectiveScores.map((s) => <ObjectiveBar key={s.objective} s={s} />)}
        </div>

        <Separator />

        <div className="space-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Decision trace</div>
          {reasoning.decisions.map((d, i) => (
            <motion.div key={i} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="flex gap-2 text-xs">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
              <div><span className="font-medium">{d.step}.</span> <span className="text-muted-foreground">{d.rationale}</span></div>
            </motion.div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ObjectiveBar({ s }: { s: ObjectiveScore }) {
  const pct = Math.round(s.score * 100);
  const color = pct >= 70 ? 'text-emerald-500' : pct >= 40 ? 'text-amber-500' : 'text-rose-500';
  return (
    <div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">{s.objective.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</span>
        <span className={`font-mono font-medium ${color}`}>{pct}%</span>
      </div>
      <Progress value={pct} className="h-1" />
      <div className="text-[9px] text-muted-foreground truncate">{s.rationale}</div>
    </div>
  );
}

export function AlternativesPanel({ alternatives }: { alternatives: AlternativePlan[] }) {
  if (alternatives.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitBranch className="h-4 w-4 text-sky-500" />
          Alternative Routes Considered
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {alternatives.map((a, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="rounded-lg border bg-muted/20 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{a.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground">score {a.weightedScore}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge variant="outline" className="text-[9px]">{a.costPercent}% cost</Badge>
              <Badge variant="outline" className="text-[9px]">{(a.settlementTimeMs / 1000).toFixed(0)}s</Badge>
              <Badge variant="outline" className="text-[9px]">risk {a.riskScore.toFixed(2)}</Badge>
              {a.usesReserve && <Badge variant="outline" className="text-[9px] text-amber-600">reserve</Badge>}
              {a.usesTreasury && <Badge variant="outline" className="text-[9px] text-violet-600">treasury</Badge>}
            </div>
            <div className="mt-1 flex items-start gap-1 text-[10px] text-muted-foreground">
              <Minus className="mt-0.5 h-2.5 w-2.5 shrink-0 text-rose-500" />
              <span>{a.reason}</span>
            </div>
          </motion.div>
        ))}
      </CardContent>
    </Card>
  );
}
