'use client';

import { useState } from 'react';
import { Loader2, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface Props {
  transactionId: string;
}

/**
 * "Retry" button for a failed settlement. Submits a `retry_failed`
 * settlement operation via POST /api/ops/settlement-ops. On success:
 * toast + reload.
 */
export function RetrySettlementButton({ transactionId }: Props) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch('/api/ops/settlement-ops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'retry_failed',
          transactionId,
          rationale: `Retry failed settlement for transaction ${transactionId}.`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Retry failed (${res.status})`);
      }
      toast.success('Retry requested');
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={run}
      disabled={busy}
      className="h-7 gap-1.5 px-2 text-[11px] border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <RotateCw className="h-3 w-3" />
      )}
      Retry
    </Button>
  );
}
