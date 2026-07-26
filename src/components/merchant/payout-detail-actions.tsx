'use client';

import { useState } from 'react';
import { XCircle, Loader2 } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface CancelPayoutButtonProps {
  payoutId: string;
}

/**
 * CancelPayoutButton — opens a confirmation dialog, then POSTs to
 * `/api/payouts/[id]/cancel` to flip the payout's status to CANCELLED.
 *
 * Only rendered when the payout is in a cancellable state (REQUESTED or
 * REVIEWING); the parent decides whether to show the button at all.
 */
export function CancelPayoutButton({ payoutId }: CancelPayoutButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleCancel() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/payouts/${encodeURIComponent(payoutId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed to cancel payout (${res.status})`);
      }
      toast.success('Payout cancellation requested');
      setOpen(false);
      setReason('');
      // Reload so the new status reflects immediately.
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel payout');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setReason(''); }}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10">
          <XCircle className="h-4 w-4" />
          Cancel Payout
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this payout?</AlertDialogTitle>
          <AlertDialogDescription>
            The payout will be marked as cancelled and the funds returned to your
            available balance. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="cancel-reason">Reason (optional)</Label>
          <Textarea
            id="cancel-reason"
            placeholder="Why is this payout being cancelled?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-h-20"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Keep payout</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleCancel();
            }}
            disabled={submitting}
            className="bg-rose-600 text-white hover:bg-rose-700"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cancelling…
              </>
            ) : (
              'Cancel payout'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
