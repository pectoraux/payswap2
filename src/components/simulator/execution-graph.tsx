'use client';

import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type LiquidityExecutionPlan, type PlanStep, type PlanStepType } from '@/kernel';
import { flag, fmtMoney, sourceKindLabel } from './format';
import {
  User, CreditCard, Landmark, ArrowDownToLine, ArrowUpFromLine, Coins, Flame, Banknote, Building2, Bell, Hourglass, ShieldAlert, Wallet,
} from 'lucide-react';

const STEP_STYLE: Record<PlanStepType, { icon: typeof User; color: string; bg: string }> = {
  debit_source: { icon: ArrowUpFromLine, color: 'text-rose-500', bg: 'bg-rose-500/10 border-rose-500/30' },
  credit_reserve: { icon: Landmark, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/30' },
  draw_reserve: { icon: Landmark, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/30' },
  draw_lp: { icon: Coins, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  draw_treasury: { icon: Banknote, color: 'text-violet-500', bg: 'bg-violet-500/10 border-violet-500/30' },
  fx_convert: { icon: Banknote, color: 'text-teal-500', bg: 'bg-teal-500/10 border-teal-500/30' },
  mint_twin: { icon: Coins, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/30' },
  burn_twin: { icon: Flame, color: 'text-orange-500', bg: 'bg-orange-500/10 border-orange-500/30' },
  credit_destination: { icon: ArrowDownToLine, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  accrue_fee: { icon: Wallet, color: 'text-violet-500', bg: 'bg-violet-500/10 border-violet-500/30' },
  notify_lp: { icon: Bell, color: 'text-sky-500', bg: 'bg-sky-500/10 border-sky-500/30' },
  await_confirmation: { icon: Hourglass, color: 'text-sky-500', bg: 'bg-sky-500/10 border-sky-500/30' },
  insurance_claim: { icon: ShieldAlert, color: 'text-rose-500', bg: 'bg-rose-500/10 border-rose-500/30' },
};

export function ExecutionGraph({ plan }: { plan: LiquidityExecutionPlan }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Liquidity Execution Graph</CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="font-mono text-[10px]">{plan.steps.length} steps</Badge>
            <Badge variant="outline" className="font-mono text-[10px] text-amber-600 dark:text-amber-400">{plan.twinTokenSymbol}</Badge>
            <Badge className={`text-[10px] ${plan.status === 'validated' ? 'bg-emerald-600 hover:bg-emerald-600' : 'bg-amber-600 hover:bg-amber-600'} text-white`}>{plan.status}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-0">
          {plan.steps.map((step, i) => (
            <StepNode key={step.id} step={step} isLast={i === plan.steps.length - 1} delay={i * 0.04} />
          ))}
        </div>
        {!plan.feasible && (
          <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-[11px] text-rose-600 dark:text-rose-400">
            ⚠ Plan infeasible — insufficient liquidity. {plan.notes.join(' ')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StepNode({ step, isLast, delay }: { step: PlanStep; isLast: boolean; delay: number }) {
  const style = STEP_STYLE[step.type] ?? STEP_STYLE.debit_source;
  const Icon = style.icon;
  return (
    <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay, duration: 0.25 }}>
      <div className={`flex items-center gap-2.5 rounded-lg border ${style.bg} p-2`}>
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${style.bg} ${style.color}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium">{step.title}</span>
            <span className="font-mono text-[9px] text-muted-foreground">f{step.frame}</span>
            {step.meta?.recovery && <Badge className="h-3.5 px-1 text-[8px] bg-rose-600 hover:bg-rose-600 text-white">RECOVERY</Badge>}
            {step.meta?.manual && <Badge variant="outline" className="h-3.5 px-1 text-[8px]">manual</Badge>}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">{step.description}</div>
        </div>
        {step.amount != null && step.currency && (
          <div className="text-right">
            <div className="font-mono text-xs font-semibold">{fmtMoney(step.amount, step.currency)}</div>
          </div>
        )}
      </div>
      {!isLast && <div className="flex justify-center py-0.5"><div className="h-2 w-px bg-border" /></div>}
    </motion.div>
  );
}
