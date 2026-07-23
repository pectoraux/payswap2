'use client';

import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  type TransactionPlan,
  type PlanHop,
  type PlanHopType,
  type CurrencyCode,
} from '@/kernel';
import { flag, fmtMoney } from './format';
import {
  User,
  CreditCard,
  Banknote,
  ArrowDownLeft,
  Coins,
  Landmark,
  Store,
  ChevronDown,
} from 'lucide-react';

const HOP_STYLE: Record<PlanHopType, { icon: typeof User; color: string; bg: string; label: string }> = {
  source: { icon: User, color: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-500/10 border-sky-500/30', label: 'Source' },
  payment: { icon: CreditCard, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10 border-violet-500/30', label: 'Payment' },
  reserve: { icon: Landmark, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', label: 'Reserve' },
  fx: { icon: Banknote, color: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-500/10 border-teal-500/30', label: 'FX' },
  liquidity: { icon: Coins, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', label: 'Liquidity' },
  destination: { icon: Store, color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10 border-rose-500/30', label: 'Destination' },
};

export function TransactionPlanView({ plan }: { plan: TransactionPlan }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Transaction Plan</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">{plan.totalHops} hops</Badge>
            <Badge variant="outline" className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">{plan.twinTokenSymbol}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-0">
          {plan.hops.map((hop, i) => (
            <HopNode key={hop.index} hop={hop} isLast={i === plan.hops.length - 1} delay={i * 0.06} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function HopNode({ hop, isLast, delay }: { hop: PlanHop; isLast: boolean; delay: number }) {
  const style = HOP_STYLE[hop.type];
  const Icon = style.icon;
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="relative"
    >
      <div className={`flex items-center gap-3 rounded-lg border ${style.bg} p-2.5`}>
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${style.bg} ${style.color}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{hop.label}</span>
            {hop.country && <span className="text-xs">{flag(hop.country)}</span>}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">{hop.detail}</div>
        </div>
        {hop.amount != null && hop.currency && (
          <div className="text-right">
            <div className="font-mono text-sm font-semibold">{fmtMoney(hop.amount, hop.currency)}</div>
            <div className="font-mono text-[10px] text-muted-foreground">{hop.currency}</div>
          </div>
        )}
      </div>
      {!isLast && (
        <div className="flex justify-center py-1">
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" />
        </div>
      )}
    </motion.div>
  );
}
