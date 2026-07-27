'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type ReplayFrame, type CurrencyCode, type LedgerEntry, type Workflow, type InsuranceClaim, type PlanAmendment, insuranceStatusLabel } from '@/kernel';
import { fmtMoney, fmtNumber, sourceKindLabel } from './format';
import {
  Play, Pause, SkipBack, SkipForward, RotateCcw, ArrowDownToLine, ArrowUpFromLine, Coins, Flame,
  BookOpen, Radio, Brain, CheckCircle2, GitBranch, Workflow as WorkflowIcon, ShieldAlert, Banknote, AlertTriangle, type LucideIcon,
} from 'lucide-react';

const FRAME_META: Record<ReplayFrame['type'], { icon: LucideIcon; color: string }> = {
  debit: { icon: ArrowUpFromLine, color: 'text-rose-500' },
  credit: { icon: ArrowDownToLine, color: 'text-emerald-500' },
  mint: { icon: Coins, color: 'text-amber-500' },
  burn: { icon: Flame, color: 'text-orange-500' },
  ledger: { icon: BookOpen, color: 'text-sky-500' },
  events: { icon: Radio, color: 'text-violet-500' },
  ai: { icon: Brain, color: 'text-fuchsia-500' },
  amendment: { icon: GitBranch, color: 'text-rose-500' },
  workflow: { icon: WorkflowIcon, color: 'text-sky-500' },
  insurance: { icon: ShieldAlert, color: 'text-rose-500' },
  treasury: { icon: Banknote, color: 'text-violet-500' },
  settlement: { icon: CheckCircle2, color: 'text-emerald-500' },
};

export function ReplayStepper({ replay, currency }: { replay: ReplayFrame[]; currency: CurrencyCode }) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frame = replay[idx];

  const next = useCallback(() => setIdx((i) => Math.min(replay.length - 1, i + 1)), [replay.length]);
  const prev = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!playing) return;
    const last = replay.length - 1;
    if (idx >= last) return;
    const reachesEnd = idx + 1 >= last;
    const t = setTimeout(() => {
      setIdx((i) => Math.min(last, i + 1));
      if (reachesEnd) setPlaying(false);
    }, 1500);
    return () => clearTimeout(t);
  }, [playing, idx, replay.length]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            Time Machine
            <Badge variant="outline" className="font-mono text-[10px]">{replay.length} frames</Badge>
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setIdx(0); setPlaying(false); }} title="Restart"><RotateCcw className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prev} disabled={idx === 0} title="Previous"><SkipBack className="h-3.5 w-3.5" /></Button>
            <Button variant="default" size="icon" className="h-8 w-8 bg-emerald-600 hover:bg-emerald-700" onClick={() => setPlaying((p) => !p)} disabled={idx >= replay.length - 1 && !playing} title={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={next} disabled={idx >= replay.length - 1} title="Next"><SkipForward className="h-3.5 w-3.5" /></Button>
            <Badge variant="outline" className="ml-1 font-mono text-[10px]">{idx + 1}/{replay.length}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Frame chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {replay.map((f, i) => {
            const meta = FRAME_META[f.type];
            const Icon = meta.icon;
            const active = i === idx;
            return (
              <button key={f.key} onClick={() => { setIdx(i); setPlaying(false); }}
                className={`flex shrink-0 flex-col items-center gap-0.5 rounded-lg border px-2 py-1.5 text-center transition-colors ${active ? 'border-emerald-500 bg-emerald-500/10' : f.isRecovery ? 'border-rose-500/40 bg-rose-500/5' : 'border-border bg-muted/30 hover:bg-muted/60'}`}
                style={{ minWidth: 56 }}>
                <Icon className={`h-3 w-3 ${active ? meta.color : f.isRecovery ? 'text-rose-500' : 'text-muted-foreground'}`} />
                <span className={`text-[9px] leading-tight ${active ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{f.title.length > 14 ? f.title.slice(0, 13) + '…' : f.title}</span>
              </button>
            );
          })}
        </div>

        {/* Frame detail */}
        <AnimatePresence mode="wait">
          <motion.div key={frame.key} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.2 }}
            className={`rounded-lg border p-3 ${frame.isRecovery ? 'border-rose-500/30 bg-rose-500/5' : 'bg-muted/20'}`}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">FRAME {frame.index}</span>
              {frame.isRecovery && <Badge className="h-4 px-1 text-[9px] bg-rose-600 hover:bg-rose-600 text-white">RECOVERY</Badge>}
              <span className="text-sm font-semibold">{frame.title}</span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">{frame.description}</p>
            <FrameDetail frame={frame} currency={currency} />
            {frame.summary && <div className="mt-3 rounded-md bg-background/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">{frame.summary}</div>}
          </motion.div>
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

function FrameDetail({ frame, currency }: { frame: ReplayFrame; currency: CurrencyCode }) {
  if (frame.type === 'ai' && frame.decisions) {
    return (
      <div className="space-y-1.5">
        {frame.decisions.map((d, i) => (
          <div key={i} className="flex gap-2 text-xs"><span className="font-mono text-[10px] text-fuchsia-500">›</span><div><span className="font-medium">{d.step}.</span> <span className="text-muted-foreground">{d.rationale}</span></div></div>
        ))}
      </div>
    );
  }
  if (frame.type === 'events' && frame.events) {
    return (
      <ScrollArea className="max-h-56">
        <div className="space-y-1">
          {frame.events.map((e) => (
            <div key={e.id} className="flex items-center gap-2 rounded border border-border/60 bg-background/40 px-2 py-1 font-mono text-[10px]">
              <Badge variant="outline" className="bg-violet-500/10 text-[9px] text-violet-600 dark:text-violet-400">{e.type}</Badge>
              <span className="truncate text-muted-foreground">{JSON.stringify(e.payload)}</span>
            </div>
          ))}
        </div>
      </ScrollArea>
    );
  }
  if ((frame.type === 'mint' || frame.type === 'burn') && frame.twinToken) {
    const t = frame.twinToken;
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm font-semibold text-amber-600 dark:text-amber-400">{t.symbol}</span>
          <Badge variant={t.status === 'burned' ? 'destructive' : 'default'} className="text-[9px]">{t.status}</Badge>
        </div>
        <div className="mt-1 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
          <span>Amount: <span className="font-mono text-foreground">{fmtMoney(t.amount, t.currency)}</span></span>
          <span>Corridor: {t.fromCountry} → {t.toCountry}</span>
        </div>
      </div>
    );
  }
  if (frame.type === 'amendment' && frame.amendment) {
    return <AmendmentDetail amendment={frame.amendment} />;
  }
  if (frame.type === 'workflow' && frame.workflow) {
    return <WorkflowDetail workflow={frame.workflow} />;
  }
  if (frame.type === 'insurance' && frame.insurance) {
    return <InsuranceDetail claim={frame.insurance} />;
  }
  if (frame.type === 'treasury') {
    return <div className="text-xs text-muted-foreground">Treasury AI monitors reserve health, stablecoin balance and liquidity shifts. See Treasury AI panel for active recommendations.</div>;
  }
  if (frame.ledgerEntries && frame.ledgerEntries.length > 0) {
    return <LedgerTable entries={frame.ledgerEntries} currency={currency} />;
  }
  if (frame.type === 'settlement') {
    return <div className="text-xs text-muted-foreground">Settlement finalized. See metrics above and the full ledger in the Ledger Entries frame.</div>;
  }
  return <div className="text-xs text-muted-foreground">No detail for this frame.</div>;
}

function AmendmentDetail({ amendment }: { amendment: PlanAmendment }) {
  return (
    <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs">
        <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
        <span className="font-medium">{amendment.triggeredBy.label}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">{amendment.reason}</div>
      <div className="flex items-center gap-1.5 text-[10px]"><span className="text-muted-foreground">Recovery:</span><Badge variant="outline" className="text-[9px] text-emerald-600">{amendment.recoveryStrategy}</Badge></div>
      {amendment.steps.length > 0 && (
        <div className="space-y-1 pt-1">
          {amendment.steps.map((s) => (
            <div key={s.id} className="flex items-center gap-1.5 text-[11px]"><GitBranch className="h-3 w-3 text-rose-500" /><span>{s.title}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowDetail({ workflow }: { workflow: Workflow }) {
  return (
    <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{workflow.name}</span>
        <Badge variant="outline" className="text-[9px]">{workflow.type}</Badge>
      </div>
      <div className="mt-2 space-y-1">
        {workflow.steps.map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-[11px]">
            <span className={`h-2 w-2 rounded-full ${s.status === 'complete' ? 'bg-emerald-500' : s.status === 'failed' ? 'bg-rose-500' : s.status === 'running' ? 'bg-amber-500' : 'bg-muted-foreground/30'}`} />
            <span className="flex-1">{s.name}</span>
            <span className="text-[9px] text-muted-foreground">{s.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InsuranceDetail({ claim }: { claim: InsuranceClaim }) {
  return (
    <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5 space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs font-semibold">{claim.id}</span>
        <Badge variant={claim.status === 'approved' ? 'default' : claim.status === 'denied' ? 'destructive' : 'secondary'} className="text-[9px]">{insuranceStatusLabel(claim.status)}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
        <span>Amount: <span className="font-mono text-foreground">{fmtMoney(claim.amount, claim.currency)}</span></span>
        <span>Coverage: <span className="font-mono text-foreground">{fmtMoney(claim.coverage, claim.currency)}</span></span>
        <span>Community votes: {claim.communityVotes}</span>
        <span>PaySwap vote: {claim.payswapVote}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">Reason: {claim.reason}</div>
    </div>
  );
}

function LedgerTable({ entries, currency }: { entries: LedgerEntry[]; currency: CurrencyCode }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.9fr] gap-2 border-b bg-muted/50 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Account</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span className="text-right">Balance</span>
      </div>
      <div className="divide-y divide-border/50 max-h-64 overflow-y-auto">
        {entries.map((e) => (
          <div key={e.id} className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.9fr] items-start gap-2 px-2.5 py-1.5 text-[11px]">
            <div className="min-w-0"><div className="truncate font-medium">{e.accountLabel}</div><div className="truncate text-[9px] text-muted-foreground">{e.memo}</div></div>
            <span className="text-right font-mono text-rose-600 dark:text-rose-400">{e.debit ? fmtNumber(e.debit, 2) : '—'}</span>
            <span className="text-right font-mono text-emerald-600 dark:text-emerald-400">{e.credit ? fmtNumber(e.credit, 2) : '—'}</span>
            <span className="text-right font-mono text-muted-foreground">{fmtNumber(e.balanceAfter, 2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
