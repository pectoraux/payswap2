'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type ReplayFrame, type CurrencyCode, type LedgerEntry } from '@/kernel';
import { fmtMoney, fmtNumber } from './format';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  ArrowDownToLine,
  ArrowUpFromLine,
  Coins,
  Flame,
  BookOpen,
  Radio,
  Brain,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';

const FRAME_META: Record<ReplayFrame['type'], { icon: LucideIcon; color: string }> = {
  debit: { icon: ArrowUpFromLine, color: 'text-rose-500' },
  credit: { icon: ArrowDownToLine, color: 'text-emerald-500' },
  mint: { icon: Coins, color: 'text-amber-500' },
  burn: { icon: Flame, color: 'text-orange-500' },
  ledger: { icon: BookOpen, color: 'text-sky-500' },
  events: { icon: Radio, color: 'text-violet-500' },
  ai: { icon: Brain, color: 'text-fuchsia-500' },
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
          <CardTitle className="text-base">Replay</CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setIdx(0); setPlaying(false); }} title="Restart">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prev} disabled={idx === 0} title="Previous">
              <SkipBack className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="default"
              size="icon"
              className="h-8 w-8 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => setPlaying((p) => !p)}
              disabled={idx >= replay.length - 1 && !playing}
              title={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={next} disabled={idx >= replay.length - 1} title="Next">
              <SkipForward className="h-3.5 w-3.5" />
            </Button>
            <Badge variant="outline" className="ml-1 font-mono text-[10px]">
              {idx + 1}/{replay.length}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Frame chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {replay.map((f, i) => {
            const meta = FRAME_META[f.type];
            const Icon = meta.icon;
            const active = i === idx;
            return (
              <button
                key={f.key}
                onClick={() => { setIdx(i); setPlaying(false); }}
                className={`flex shrink-0 flex-col items-center gap-1 rounded-lg border px-2.5 py-1.5 text-center transition-colors ${
                  active
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : 'border-border bg-muted/30 hover:bg-muted/60'
                }`}
                style={{ minWidth: 64 }}
              >
                <Icon className={`h-3.5 w-3.5 ${active ? meta.color : 'text-muted-foreground'}`} />
                <span className={`text-[10px] leading-tight ${active ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                  {f.title}
                </span>
              </button>
            );
          })}
        </div>

        {/* Frame detail */}
        <AnimatePresence mode="wait">
          <motion.div
            key={frame.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="rounded-lg border bg-muted/20 p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">FRAME {frame.index}</span>
              <span className="text-sm font-semibold">{frame.title}</span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">{frame.description}</p>
            <FrameDetail frame={frame} currency={currency} />
            {frame.summary && (
              <div className="mt-3 rounded-md bg-background/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                {frame.summary}
              </div>
            )}
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
          <div key={i} className="flex gap-2 text-xs">
            <span className="font-mono text-[10px] text-fuchsia-500">›</span>
            <div><span className="font-medium">{d.step}.</span> <span className="text-muted-foreground">{d.rationale}</span></div>
          </div>
        ))}
      </div>
    );
  }

  if (frame.type === 'events' && frame.events) {
    return (
      <ScrollArea className="max-h-64">
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
          <span>Minted: frame {t.mintedAtFrame}</span>
          <span>Burned: {t.burnedAtFrame ?? '—'}</span>
        </div>
      </div>
    );
  }

  if (frame.ledgerEntries && frame.ledgerEntries.length > 0) {
    return <LedgerTable entries={frame.ledgerEntries} currency={currency} />;
  }

  if (frame.type === 'settlement') {
    return <div className="text-xs text-muted-foreground">Settlement finalized. See metrics above and ledger entries in frame 6.</div>;
  }

  return <div className="text-xs text-muted-foreground">No detail for this frame.</div>;
}

function LedgerTable({ entries, currency }: { entries: LedgerEntry[]; currency: CurrencyCode }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.9fr] gap-2 border-b bg-muted/50 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Account</span>
        <span className="text-right">Debit</span>
        <span className="text-right">Credit</span>
        <span className="text-right">Balance</span>
      </div>
      <div className="divide-y divide-border/50">
        {entries.map((e) => (
          <div key={e.id} className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.9fr] items-start gap-2 px-2.5 py-1.5 text-[11px]">
            <div className="min-w-0">
              <div className="truncate font-medium">{e.accountLabel}</div>
              <div className="truncate text-[9px] text-muted-foreground">{e.memo}</div>
            </div>
            <span className="text-right font-mono text-rose-600 dark:text-rose-400">{e.debit ? fmtNumber(e.debit, 2) : '—'}</span>
            <span className="text-right font-mono text-emerald-600 dark:text-emerald-400">{e.credit ? fmtNumber(e.credit, 2) : '—'}</span>
            <span className="text-right font-mono text-muted-foreground">{fmtNumber(e.balanceAfter, 2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
