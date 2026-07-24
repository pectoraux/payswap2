'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { type ConstitutionVerdict } from '@/kernel';
import { Shield, CheckCircle2, XCircle, AlertTriangle, Scroll } from 'lucide-react';

const SECTION_ICON: Record<string, string> = {
  Accounting: '📊', Liquidity: '💧', Treasury: '🏦', Insurance: '🛡️',
  Risk: '⚠️', Compliance: '✅', Governance: '⚖️', Security: '🔐',
  Performance: '⚡', Availability: '🟢', Auditability: '📝', AI: '🤖',
};

export function ConstitutionPanel({ constitution }: { constitution: ConstitutionVerdict }) {
  return (
    <Card className={constitution.passed ? '' : 'border-rose-500/40'}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Scroll className="h-4 w-4 text-emerald-500" />
            Kernel Constitution
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">{constitution.passedRules}/{constitution.totalRules} rules</Badge>
            <Badge className={`gap-1 text-[10px] ${constitution.passed ? 'bg-emerald-600 hover:bg-emerald-600 text-white' : 'bg-rose-600 hover:bg-rose-600 text-white'}`}>
              <Shield className="h-3 w-3" />
              {constitution.passed ? 'ALL PASSED' : 'VIOLATED'}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Section grid */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {constitution.sections.map((s) => {
            const passed = s.checks.filter((c) => c.passed).length;
            return (
              <div key={s.section} className={`rounded-lg border p-2 ${s.passed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold">{SECTION_ICON[s.section]} {s.section}</span>
                  {s.passed ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <AlertTriangle className="h-3 w-3 text-amber-500" />}
                </div>
                <div className="text-[9px] text-muted-foreground">{passed}/{s.checks.length} rules</div>
              </div>
            );
          })}
        </div>

        <Separator />

        {/* Detailed checks */}
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {constitution.sections.map((s) => (
            <div key={s.section}>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">{SECTION_ICON[s.section]} {s.section}</div>
              {s.checks.map((c, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] py-0.5">
                  {c.passed ? (
                    <CheckCircle2 className="mt-0.5 h-2.5 w-2.5 shrink-0 text-emerald-500" />
                  ) : c.severity === 'block' ? (
                    <XCircle className="mt-0.5 h-2.5 w-2.5 shrink-0 text-rose-500" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0 text-amber-500" />
                  )}
                  <span className={`font-medium ${c.passed ? '' : c.severity === 'block' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>{c.invariant}</span>
                  <span className="text-[9px] text-muted-foreground truncate">{c.detail}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
