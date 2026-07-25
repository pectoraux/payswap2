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

interface ReplayWebhookButtonProps {
  deliveryId: string;
  /** Optional compact size for inline table use. */
  compact?: boolean;
}

/**
 * Replay button for a webhook delivery. Opens a confirmation dialog, then
 * POSTs to /api/support/webhooks/replay with `{ deliveryId }`. The API
 * re-sends the original payload and records a new WebhookDelivery row.
 *
 * On success: toast + page reload so the new delivery shows up in the list.
 * On failure: toast with the server's error message.
 */
export function ReplayWebhookButton({
  deliveryId,
  compact = false,
}: ReplayWebhookButtonProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleReplay() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/support/webhooks/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Replay failed (${res.status})`);
      }
      toast.success('Webhook delivery replayed');
      setOpen(false);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Replay failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={compact ? 'sm' : 'default'}
          className={
            compact
              ? 'h-7 gap-1 px-2 text-[11px] border-teal-500/40 text-teal-600 hover:bg-teal-500/10 dark:text-teal-400'
              : 'gap-1.5 border-teal-500/40 text-teal-600 hover:bg-teal-500/10 dark:text-teal-400'
          }
        >
          <RotateCw className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
          {compact ? 'Replay' : 'Replay webhook'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replay this webhook delivery?</AlertDialogTitle>
          <AlertDialogDescription>
            The original event payload will be re-sent to the configured
            endpoint URL and a new delivery record will be created. Use this
            when a downstream system missed or rejected the original delivery.
          </AlertDialogDescription>
        </AlertDialogHeader>
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
              'Replay delivery'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
