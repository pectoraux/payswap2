'use client';

import { useState, Fragment } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ChevronRight, ChevronDown, CheckCircle2, XCircle,
  CreditCard, ArrowDownToLine, FileText, Shield, Webhook,
} from 'lucide-react';

interface SimRun {
  id: string;
  runId: string;
  scenarioName: string;
  scenario: string;
  result: string;
  amount: number;
  currency: string;
  costPercent: number;
  settlementMs: number;
  riskScore: number;
  confidence: number;
  settled: boolean;
  amendments: number;
  failures: number;
  createdAt: string;
}

interface ResultSummary {
  paymentsCreated?: number;
  payoutsCreated?: number;
  refundsCreated?: number;
  invoicesCreated?: number;
  webhooksCreated?: number;
  complianceAlerts?: number;
  lpRevenue?: number;
  totalVolume?: number;
  events?: number;
}

interface ScenarioParams {
  duration?: string;
  scenario?: string;
  environment?: string;
  customParams?: {
    successRate?: number;
    refundRate?: number;
    webhookFailureRate?: number;
    complianceAlertRate?: number;
    highValueRate?: number;
    payoutFrequency?: number;
  };
  actorFilter?: { merchantIds?: string[]; lpIds?: string[] };
}

function safeParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function fmtDuration(ms: number) {
  if (ms >= 2592000000) return '1 month';
  if (ms >= 604800000) return '1 week';
  if (ms >= 86400000) return '1 day';
  if (ms >= 3600000) return '1 hour';
  return '<1h';
}

function fmtNumber(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function SimulationsTable({ runs }: { runs: SimRun[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = (id: string) => {
    setExpanded((prev) => (prev === id ? null : id));
  };

  return (
    <ScrollArea className="h-[600px] w-full rounded-md border">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow>
            <TableHead className="w-8"></TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Scenario</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead className="text-right">Payments</TableHead>
            <TableHead className="text-right">Volume</TableHead>
            <TableHead className="text-right">Cost%</TableHead>
            <TableHead className="text-right">Risk</TableHead>
            <TableHead className="text-right">Confidence</TableHead>
            <TableHead>Settled</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((r) => {
            const result = safeParse<ResultSummary>(r.result, {});
            const scenario = safeParse<ScenarioParams>(r.scenario, {});
            const isOpen = expanded === r.id;
            const scenarioKey = (scenario.scenario || r.scenarioName.split(' ')[0] || '').toLowerCase();
            const scenarioBadgeColor =
              scenarioKey === 'custom'
                ? 'border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-400'
                : scenarioKey === 'stress'
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                  : scenarioKey === 'outage'
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : scenarioKey === 'holiday'
                      ? 'border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400'
                      : scenarioKey === 'growth'
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'border-border bg-muted text-muted-foreground';
            return (
              <Fragment key={r.id}>
                <TableRow
                  onClick={() => toggle(r.id)}
                  className="cursor-pointer"
                >
                  <TableCell className="w-8">
                    {isOpen
                      ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                    {fmtDate(r.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] capitalize ${scenarioBadgeColor}`}>
                      {scenarioKey || 'unknown'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {scenario.duration || fmtDuration(r.settlementMs)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {(result.paymentsCreated ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {fmtNumber(r.amount)}
                    <span className="text-[9px] text-muted-foreground ml-0.5">{r.currency}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {r.costPercent.toFixed(2)}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    <span className={r.riskScore > 0.05 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
                      {(r.riskScore * 100).toFixed(2)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {(r.confidence * 100).toFixed(0)}%
                  </TableCell>
                  <TableCell>
                    {r.settled
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      : <XCircle className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableCell colSpan={10} className="p-4">
                      <SimRunDetail run={r} result={result} scenario={scenario} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

function SimRunDetail({
  run,
  result,
  scenario,
}: {
  run: SimRun;
  result: ResultSummary;
  scenario: ScenarioParams;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Run identity */}
        <div className="rounded-md border bg-background/50 p-3 space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Run Identity</div>
          <div className="text-[11px] font-mono break-all">{run.runId}</div>
          <div className="text-[10px] text-muted-foreground">
            Created: {fmtDate(run.createdAt)}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Settlement window: {fmtDuration(run.settlementMs)} ({run.settlementMs.toLocaleString()} ms)
          </div>
        </div>

        {/* Result counts */}
        <div className="rounded-md border bg-background/50 p-3 space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Records Created</div>
          <DetailStat icon={<CreditCard className="h-3 w-3 text-emerald-500" />} label="Payments" value={result.paymentsCreated ?? 0} />
          <DetailStat icon={<ArrowDownToLine className="h-3 w-3 text-teal-500" />} label="Payouts" value={result.payoutsCreated ?? 0} />
          <DetailStat icon={<FileText className="h-3 w-3 text-amber-500" />} label="Refunds" value={result.refundsCreated ?? 0} />
          <DetailStat icon={<FileText className="h-3 w-3 text-sky-500" />} label="Invoices" value={result.invoicesCreated ?? 0} />
          <DetailStat icon={<Webhook className="h-3 w-3 text-violet-500" />} label="Webhooks" value={result.webhooksCreated ?? 0} />
          <DetailStat icon={<Shield className="h-3 w-3 text-rose-500" />} label="AML Alerts" value={result.complianceAlerts ?? 0} />
        </div>

        {/* Financials */}
        <div className="rounded-md border bg-background/50 p-3 space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Financials</div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Volume</span>
            <span className="font-mono tabular-nums">{fmtNumber(result.totalVolume ?? run.amount)} {run.currency}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">LP Revenue</span>
            <span className="font-mono tabular-nums">{fmtNumber(result.lpRevenue ?? 0)} {run.currency}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Cost %</span>
            <span className="font-mono tabular-nums">{run.costPercent.toFixed(2)}%</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Risk score</span>
            <span className="font-mono tabular-nums">{(run.riskScore * 100).toFixed(2)}%</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Confidence</span>
            <span className="font-mono tabular-nums">{(run.confidence * 100).toFixed(0)}%</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Failures / Amendments</span>
            <span className="font-mono tabular-nums">{run.failures} / {run.amendments}</span>
          </div>
        </div>
      </div>

      {/* Scenario parameters */}
      {scenario.customParams && (
        <div className="rounded-md border bg-background/50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Custom Probability Parameters
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[11px]">
            <ParamChip label="Success" value={scenario.customParams.successRate} />
            <ParamChip label="Refund" value={scenario.customParams.refundRate} />
            <ParamChip label="Webhook Fail" value={scenario.customParams.webhookFailureRate} />
            <ParamChip label="AML" value={scenario.customParams.complianceAlertRate} />
            <ParamChip label="High-Value" value={scenario.customParams.highValueRate} />
            <ParamChip label="Payout Freq" value={scenario.customParams.payoutFrequency} />
          </div>
        </div>
      )}

      {/* Actor filter */}
      {scenario.actorFilter && (scenario.actorFilter.merchantIds?.length || scenario.actorFilter.lpIds?.length) ? (
        <div className="rounded-md border bg-background/50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Actor Filter
          </div>
          <div className="flex flex-wrap gap-3 text-[11px]">
            <div>
              <span className="text-muted-foreground">Merchants: </span>
              <span className="font-mono">{scenario.actorFilter.merchantIds?.length ?? 0}</span>
            </div>
            <div>
              <span className="text-muted-foreground">LPs: </span>
              <span className="font-mono">{scenario.actorFilter.lpIds?.length ?? 0}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DetailStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-mono tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}

function ParamChip({ label, value }: { label: string; value?: number }) {
  if (value === undefined) {
    return (
      <div className="rounded border bg-muted/30 px-2 py-1 text-center">
        <div className="text-[9px] text-muted-foreground">{label}</div>
        <div className="text-[10px] font-mono">—</div>
      </div>
    );
  }
  return (
    <div className="rounded border bg-muted/30 px-2 py-1 text-center">
      <div className="text-[9px] text-muted-foreground">{label}</div>
      <div className="text-[10px] font-mono font-semibold">{(value * 100).toFixed(1)}%</div>
    </div>
  );
}
