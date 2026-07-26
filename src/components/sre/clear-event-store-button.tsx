'use client';

import { useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
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

interface ClearEventStoreButtonProps {
  /** Whether the current user has admin privileges. */
  isAdmin: boolean;
  /** Approximate row count to show in the confirmation dialog. */
  rowCount?: number;
}

/**
 * "Clear Event Store" quick action. Admin-only. Shows a confirmation dialog
 * with the current row count, then POSTs to
 * /api/ops/sre/clear-event-store which deletes every EventRecord row and
 * records an AuditLog entry.
 *
 * When the user is not an admin the button is disabled with a tooltip-style
 * hint in the description.
 */
export function ClearEventStoreButton({ isAdmin, rowCount = 0 }: ClearEventStoreButtonProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleClear() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/ops/sre/clear-event-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed (${res.status})`);
      }
      const deleted = (data as any)?.rowsDeleted ?? 0;
      toast.success(`Event store cleared · ${deleted} row${deleted === 1 ? '' : 's'} deleted`);
      setOpen(false);
      setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Clear failed');
    } finally {
      setSubmitting(false);
    }
  }

  const trigger = (
    <Button
      type="button"
      variant="outline"
      disabled={!isAdmin}
      className="gap-1.5 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400 disabled:opacity-50"
    >
      <Trash2 className="h-4 w-4" />
      Clear event store
    </Button>
  );

  if (!isAdmin) {
    // Wrap in a span so the disabled button still renders for non-admins
    // (the button itself is disabled) — clicking does nothing.
    return (
      <span title="Admin role required to clear the event store">
        {trigger}
      </span>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear the entire event store?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete every row in the <code>EventRecord</code>{' '}
            table{rowCount > 0 ? ` (about ${rowCount.toLocaleString()} rows)` : ''}.
            The action is recorded in the audit log and cannot be undone.
            Projections rebuilt from the event stream will need a full recompute.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleClear();
            }}
            disabled={submitting}
            className="bg-rose-600 text-white hover:bg-rose-700"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Clearing…
              </>
            ) : (
              'Clear event store'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
