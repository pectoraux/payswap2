'use client';

import { useState } from 'react';
import { Loader2, Snowflake, Play, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export interface CorridorActionsProps {
  corridor: string;
  /** True if the corridor is currently frozen (latest AuditLog state). */
  frozen: boolean;
  /** Other corridor keys, used as rebalance destinations. */
  otherCorridors: string[];
}

/**
 * Per-row action cluster for a settlement corridor on the Treasury corridors
 * page. Renders up to three actions:
 *
 *   - **Freeze / Resume**: toggles the corridor's frozen state via
 *     POST /api/treasury/corridors/freeze. Freezing requires a reason
 *     (collected via AlertDialog prompt); resuming is a single-tap confirm.
 *   - **Rebalance**: opens a Dialog to pick a destination corridor and an
 *     amount, then POSTs /api/treasury/rebalance and shows a toast.
 *
 * All actions reload the page on success so the new state reflects
 * immediately in the table.
 */
export function CorridorActions({
  corridor,
  frozen,
  otherCorridors,
}: CorridorActionsProps) {
  const [busy, setBusy] = useState<'freeze' | 'resume' | 'rebalance' | null>(
    null,
  );
  const [freezeReason, setFreezeReason] = useState('');
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [rebalanceOpen, setRebalanceOpen] = useState(false);
  const [destCorridor, setDestCorridor] = useState(
    otherCorridors[0] ?? '',
  );
  const [rebalanceAmount, setRebalanceAmount] = useState('');

  async function freeze() {
    if (!freezeReason.trim()) {
      toast.error('A reason is required to freeze a corridor');
      return;
    }
    setBusy('freeze');
    try {
      const res = await fetch('/api/treasury/corridors/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          corridor,
          action: 'freeze',
          reason: freezeReason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Freeze failed (${res.status})`);
      }
      toast.success(`Corridor ${corridor} frozen`);
      setFreezeReason('');
      setFreezeOpen(false);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Freeze failed');
    } finally {
      setBusy(null);
    }
  }

  async function resume() {
    setBusy('resume');
    try {
      const res = await fetch('/api/treasury/corridors/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corridor, action: 'resume' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Resume failed (${res.status})`);
      }
      toast.success(`Corridor ${corridor} resumed`);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Resume failed');
    } finally {
      setBusy(null);
    }
  }

  async function rebalance() {
    const amount = parseFloat(rebalanceAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a positive amount to rebalance');
      return;
    }
    if (!destCorridor) {
      toast.error('Select a destination corridor');
      return;
    }
    if (destCorridor === corridor) {
      toast.error('Destination corridor must differ from source');
      return;
    }
    setBusy('rebalance');
    toast.info(`Rebalancing corridor ${corridor} → ${destCorridor}…`);
    try {
      const res = await fetch('/api/treasury/rebalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromCorridor: corridor,
          toCorridor: destCorridor,
          amount,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Rebalance failed (${res.status})`);
      }
      toast.success(
        `Rebalance initiated: ${corridor} → ${destCorridor} (${amount.toFixed(2)})`,
      );
      setRebalanceAmount('');
      setRebalanceOpen(false);
      setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rebalance failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {frozen ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={resume}
          disabled={busy !== null}
          className="h-7 gap-1 px-2 text-[11px] border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
        >
          {busy === 'resume' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          Resume
        </Button>
      ) : (
        <AlertDialog open={freezeOpen} onOpenChange={setFreezeOpen}>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              className="h-7 gap-1 px-2 text-[11px] border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
            >
              <Snowflake className="h-3 w-3" />
              Freeze
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Freeze corridor {corridor}?</AlertDialogTitle>
              <AlertDialogDescription>
                Freezing halts all routing through this corridor until
                manually resumed. The action is audit-logged with your name
                and timestamp.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor={`freeze-reason-${corridor}`}>Reason</Label>
              <Textarea
                id={`freeze-reason-${corridor}`}
                value={freezeReason}
                onChange={(e) => setFreezeReason(e.target.value)}
                placeholder="Why is this corridor being frozen?"
                rows={3}
                maxLength={500}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  freeze();
                }}
                disabled={busy !== null || !freezeReason.trim()}
                className="bg-rose-600 text-white hover:bg-rose-700"
              >
                {busy === 'freeze' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Freezing…
                  </>
                ) : (
                  <>
                    <Snowflake className="mr-2 h-4 w-4" /> Freeze corridor
                  </>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      <Dialog open={rebalanceOpen} onOpenChange={setRebalanceOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            className="h-7 gap-1 px-2 text-[11px] border-teal-500/40 text-teal-600 hover:bg-teal-500/10 dark:text-teal-400"
          >
            <RefreshCw className="h-3 w-3" />
            Rebalance
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rebalance {corridor}</DialogTitle>
            <DialogDescription>
              Move reserve liquidity from this corridor to an under-reserved
              destination. The rebalance is recorded in the AuditLog.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Destination corridor</Label>
              <Select value={destCorridor} onValueChange={setDestCorridor}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select destination" />
                </SelectTrigger>
                <SelectContent>
                  {otherCorridors.length === 0 ? (
                    <SelectItem value="_none" disabled>
                      No other corridors available
                    </SelectItem>
                  ) : (
                    otherCorridors.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`rebalance-amount-${corridor}`}>Amount (USD)</Label>
              <Input
                id={`rebalance-amount-${corridor}`}
                type="number"
                min="0"
                step="0.01"
                value={rebalanceAmount}
                onChange={(e) => setRebalanceAmount(e.target.value)}
                placeholder="e.g. 25000"
                className="tabular-nums"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRebalanceOpen(false)}
              disabled={busy !== null}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={rebalance}
              disabled={busy !== null}
              className="bg-teal-600 text-white hover:bg-teal-700"
            >
              {busy === 'rebalance' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rebalancing…
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" /> Rebalance
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
