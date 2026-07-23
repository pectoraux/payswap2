'use client';

import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { type AIReasoning } from '@/kernel';
import { Brain, Sparkles, CheckCircle2 } from 'lucide-react';

export function AIReasoningView({ reasoning }: { reasoning: AIReasoning }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4 text-violet-500" />
            AI Agent Reasoning
          </CardTitle>
          <Badge
            variant={reasoning.llmPowered ? 'default' : 'secondary'}
            className={`gap-1 text-[10px] ${reasoning.llmPowered ? 'bg-violet-600 hover:bg-violet-600 text-white' : ''}`}
          >
            <Sparkles className="h-3 w-3" />
            {reasoning.llmPowered ? 'LLM' : 'deterministic'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Strategy</div>
          <div className="text-sm font-medium">{reasoning.strategy}</div>
        </div>

        <p className="text-sm leading-relaxed text-foreground/90">{reasoning.narrative}</p>

        <Separator />

        <div className="space-y-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Decision trace</div>
          {reasoning.decisions.map((d, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex gap-2.5 text-sm"
            >
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
              <div>
                <span className="font-medium">{d.step}.</span>{' '}
                <span className="text-muted-foreground">{d.rationale}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
