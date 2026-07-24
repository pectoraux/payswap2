'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, XCircle, Loader2, FlaskConical, Shield, AlertTriangle, Zap } from 'lucide-react';

interface ScenarioSummary {
  scenarioId: string;
  name: string;
  category: string;
  passed: boolean;
  settled: boolean;
  constitutionPassed: boolean;
  cost: number;
  risk: number;
  time: string;
  candidates: number;
  transitions: number;
  escrowEntries: number;
  collateralEntries: number;
  fiatProofs: number;
  validates: string[];
  verifiedInvariants: number;
  totalInvariants: number;
  error?: string;
}

interface ScenarioInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  expectedBehavior: string;
  validates: string[];
}

const CATEGORY_COLOR: Record<string, string> = {
  Payment: 'text-sky-500',
  Failure: 'text-rose-500',
  Auction: 'text-violet-500',
  Settlement: 'text-amber-500',
  Dispute: 'text-rose-500',
  Fraud: 'text-orange-500',
  'LP Lifecycle': 'text-emerald-500',
  Treasury: 'text-violet-500',
  Stress: 'text-red-500',
  Replay: 'text-cyan-500',
};

export function ProtocolScenariosPanel({
  scenarios,
  onRunScenario,
  onRunAll,
  loading,
  results,
}: {
  scenarios: ScenarioInfo[];
  onRunScenario: (id: string) => void;
  onRunAll: () => void;
  loading: boolean;
  results: Map<string, ScenarioSummary>;
}) {
  const passed = [...results.values()].filter((r) => r.passed).length;
  const total = results.size;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4 text-emerald-500" />
            Protocol Scenarios (20)
          </CardTitle>
          <div className="flex items-center gap-2">
            {total > 0 && (
              <Badge className={`gap-1 text-[10px] ${passed === total ? 'bg-emerald-600 hover:bg-emerald-600 text-white' : 'bg-amber-600 hover:bg-amber-600 text-white'}`}>
                {passed}/{total} passed
              </Badge>
            )}
            <Button size="sm" onClick={onRunAll} disabled={loading} className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
              {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Zap className="mr-1 h-3 w-3" />}
              Run All
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-[10px] text-muted-foreground">
          20 architecture-proof scenarios. Each executes through <code className="font-mono">kernel.converge(intent)</code> with no special-case code.
          If any requires runtime changes, that's an architectural failure.
        </p>
        <ScrollArea className="max-h-96">
          <div className="space-y-1.5">
            {scenarios.map((s, i) => {
              const result = results.get(s.id);
              const categoryColor = CATEGORY_COLOR[s.category] ?? 'text-muted-foreground';
              return (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className={`flex items-center gap-2 rounded-lg border p-2 ${result ? (result.passed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5') : 'border-border bg-muted/20'}`}
                >
                  <span className="font-mono text-[9px] text-muted-foreground shrink-0">{(i + 1).toString().padStart(2, '0')}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium">{s.name}</span>
                      <Badge variant="outline" className={`text-[8px] ${categoryColor}`}>{s.category}</Badge>
                    </div>
                    <div className="truncate text-[9px] text-muted-foreground">{s.description}</div>
                    {result && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[8px]">
                        {result.passed ? (
                          <span className="flex items-center gap-0.5 text-emerald-600"><CheckCircle2 className="h-2.5 w-2.5" /> {result.verifiedInvariants}/{result.totalInvariants} invariants</span>
                        ) : (
                          <span className="flex items-center gap-0.5 text-rose-600"><XCircle className="h-2.5 w-2.5" /> failed</span>
                        )}
                        {result.settled && <Badge variant="outline" className="text-[7px] text-emerald-600">settled</Badge>}
                        <span className="font-mono text-muted-foreground">{result.cost}% · {result.time}</span>
                        {result.escrowEntries > 0 && <Badge variant="outline" className="text-[7px] text-amber-600">{result.escrowEntries} escrow</Badge>}
                        {result.fiatProofs > 0 && <Badge variant="outline" className="text-[7px] text-sky-600">{result.fiatProofs} proofs</Badge>}
                      </div>
                    )}
                    {result?.error && <div className="text-[8px] text-rose-600">{result.error}</div>}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRunScenario(s.id)}
                    disabled={loading}
                    className="h-7 shrink-0 text-[10px]"
                  >
                    Run
                  </Button>
                </motion.div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export function FiatProofPanel({ proofs }: { proofs: { id: string; lpId: string; proofType: string; currency: string; attestedAmount: number; confidence: number; effectiveLiquidity: number; status: string }[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-4 w-4 text-sky-500" />
          Fiat Proofs (confidence-based)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="mb-2 text-[10px] text-muted-foreground">
          The solver asks "what is the confidence that LP A can complete 50,000 right now?" — not "does LP A have 50,000?"
        </p>
        {proofs.length === 0 ? (
          <div className="text-xs text-muted-foreground">No fiat proofs.</div>
        ) : (
          proofs.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded border border-border/60 bg-muted/10 px-2 py-1">
              <Shield className="h-3 w-3 text-sky-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium">LP {p.lpId}</div>
                <div className="font-mono text-[9px] text-muted-foreground">{p.proofType} · {p.currency}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[10px] font-semibold text-sky-600">{(p.confidence * 100).toFixed(0)}%</div>
                <div className="font-mono text-[8px] text-muted-foreground">{p.effectiveLiquidity.toLocaleString()} / {p.attestedAmount.toLocaleString()}</div>
              </div>
              <Badge variant={p.status === 'valid' ? 'default' : 'secondary'} className={`text-[8px] ${p.status === 'valid' ? 'bg-emerald-600 hover:bg-emerald-600 text-white' : ''}`}>
                {p.status}
              </Badge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function ConstitutionalVerificationPanel({ checks }: { checks: { invariant: string; passed: boolean; detail: string }[] }) {
  const passed = checks.filter((c) => c.passed).length;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-emerald-500" />
            Constitutional Verification
          </CardTitle>
          <Badge className={`text-[10px] ${passed === checks.length ? 'bg-emerald-600 hover:bg-emerald-600 text-white' : 'bg-rose-600 hover:bg-rose-600 text-white'}`}>
            {passed}/{checks.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {checks.map((c, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            {c.passed ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <AlertTriangle className="h-3 w-3 text-rose-500" />}
            <span className="font-medium">{c.invariant}</span>
            <span className="ml-auto truncate text-[9px] text-muted-foreground">{c.detail}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
