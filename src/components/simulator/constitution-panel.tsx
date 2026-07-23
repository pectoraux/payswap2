'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { type ConstitutionVerdict } from '@/kernel';
import { Shield, CheckCircle2, XCircle, AlertTriangle, Scroll } from 'lucide-react';

export function ConstitutionPanel({ constitution }: { constitution: ConstitutionVerdict }) {
  const blocks = constitution.violations.filter((v) => v.severity === 'block');
  const warns = constitution.violations.filter((v) => v.severity === 'warn');
  const passed = constitution.checks.filter((c) => c.passed).length;

  return (
    <Card className={constitution.passed ? '' : 'border-rose-500/40'}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Scroll className="h-4 w-4 text-emerald-500" />
            Kernel Constitution
          </CardTitle>
          <Badge className={`gap-1 text-[10px] ${constitution.passed ? 'bg-emerald-600 hover:bg-emerald-600 text-white' : 'bg-rose-600 hover:bg-rose-600 text-white'}`}>
            <Shield className="h-3 w-3" />
            {constitution.passed ? 'ALL PASSED' : 'VIOLATED'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" />{passed} passed</span>
          {blocks.length > 0 && <span className="flex items-center gap-1 text-rose-600"><XCircle className="h-3 w-3" />{blocks.length} blocked</span>}
          {warns.length > 0 && <span className="flex items-center gap-1 text-amber-600"><AlertTriangle className="h-3 w-3" />{warns.length} warnings</span>}
        </div>
        <Separator />
        {constitution.checks.map((c, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            {c.passed ? (
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
            ) : (
              <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-500" />
            )}
            <div className="min-w-0 flex-1">
              <span className={`font-medium ${c.passed ? '' : 'text-rose-600 dark:text-rose-400'}`}>{c.invariant}</span>
              <div className="text-[10px] text-muted-foreground">{c.detail}</div>
            </div>
          </div>
        ))}
        <Separator />
        <p className="text-[9px] italic text-muted-foreground">
          Non-overridable. Every plan must pass these invariants before approval — the financial equivalent of ACID guarantees.
        </p>
      </CardContent>
    </Card>
  );
}
