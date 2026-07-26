'use client';

import { useState } from 'react';
import { RotateCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ReplayButtonProps {
  /** Initial from/to seq values (e.g. the min/max seq in the current view). */
  defaultFromSeq?: number;
  defaultToSeq?: number;
}

/**
 * Replay button for EventRecord slices. Opens a dialog that lets the SRE
 * confirm / adjust the [fromSeq, toSeq] range, then POSTs to
 * /api/ops/replay with `{ fromSeq, toSeq }`.
 *
 * On success the server returns `{ replayed, errors }` and we toast the
 * counts. The page is reloaded so any audit-log entries are visible.
 */
export function ReplayButton({
  defaultFromSeq = 0,
  defaultToSeq = 0,
}: ReplayButtonProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fromSeq, setFromSeq] = useState(String(defaultFromSeq));
  const [toSeq, setToSeq] = useState(String(defaultToSeq));

  async function handleReplay() {
    const from = Number(fromSeq);
    const to = Number(toSeq);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      toast.error('Please enter valid sequence numbers');
      return;
    }
    if (from > to) {
      toast.error('fromSeq must be <= toSeq');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/ops/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromSeq: from, toSeq: to }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Replay failed (${res.status})`);
      }
      const replayed = (data as any)?.replayed ?? 0;
      const errors: unknown[] = (data as any)?.errors ?? [];
      if (errors.length === 0) {
        toast.success(`Replayed ${replayed} event${replayed === 1 ? '' : 's'}`);
      } else {
        toast.warning(
          `Replayed ${replayed} event${replayed === 1 ? '' : 's'} with ${errors.length} error${
            errors.length === 1 ? '' : 's'
          }`,
        );
      }
      setOpen(false);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Replay failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setFromSeq(String(defaultFromSeq));
          setToSeq(String(defaultToSeq));
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="gap-1.5 border-teal-500/40 text-teal-600 hover:bg-teal-500/10 dark:text-teal-400"
        >
          <RotateCw className="h-4 w-4" />
          Replay events
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replay event stream?</AlertDialogTitle>
          <AlertDialogDescription>
            Replay the slice of EventRecord rows whose <code>seq</code> falls
            in the inclusive range below. This re-applies every event to the
            projection layer (ledger / wallet / merchant state) so projections
            can be rebuilt after corruption.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="from-seq">From seq</Label>
            <Input
              id="from-seq"
              type="number"
              min="0"
              value={fromSeq}
              onChange={(e) => setFromSeq(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to-seq">To seq</Label>
            <Input
              id="to-seq"
              type="number"
              min="0"
              value={toSeq}
              onChange={(e) => setToSeq(e.target.value)}
            />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleReplay();
            }}
            disabled={submitting}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Replaying…
              </>
            ) : (
              'Replay events'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
