'use client';

import { useState } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface DisputeActionsProps {
  /** Refund / dispute ID to action. */
  id: string;
  /** Current status of the refund. Only PENDING rows show actions. */
  status: string;
  /** Optional reference (payment ref) used for nicer toast copy. */
  reference?: string;
}

/**
 * Per-row action buttons for the Dispute Center.
 *
 * Only renders when the dispute is still open (status = PENDING). The
 * merchant can either:
 *   - Approve → PATCH /api/refunds/[id] { status: 'PROCESSED' }
 *   - Reject  → PATCH /api/refunds/[id] { status: 'REJECTED' }
 *
 * Once actioned the row reloads to reflect the new (resolved) state.
 */
export function DisputeActions({ id, status, reference }: DisputeActionsProps) {
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
  const s = (status || '').toUpperCase();

  // Resolved disputes show a static, read-only label instead of buttons.
  if (s !== 'PENDING') {
    return (
      <span className="text-xs font-medium text-muted-foreground">
        Resolved
      </span>
    );
  }

  async function action(next: 'PROCESSED' | 'REJECTED', label: string) {
    setBusy(next === 'PROCESSED' ? 'approve' : 'reject');
    try {
      const res = await fetch(`/api/refunds/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed to ${label.toLowerCase()} dispute`);
      }
      toast.success(
        `Dispute ${label.toLowerCase()}${reference ? ` · ${reference}` : ''}`,
      );
      // Brief delay so the toast paints before the reload.
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => action('PROCESSED', 'Approved')}
        disabled={busy !== null}
        className="border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
      >
        {busy === 'approve' ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="mr-1 h-3.5 w-3.5" />
        )}
        Approve
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => action('REJECTED', 'Rejected')}
        disabled={busy !== null}
        className="border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
      >
        {busy === 'reject' ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <X className="mr-1 h-3.5 w-3.5" />
        )}
        Reject
      </Button>
    </div>
  );
}
