'use client';

import { useState } from 'react';
import { RotateCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/**
 * "Replay Failed Webhooks" quick action. POSTs to
 * /api/ops/sre/replay-failed and toasts the count of deliveries queued for
 * replay. The actual re-send is handled by the delivery loop in the
 * background.
 */
export function ReplayFailedWebhooksButton() {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch('/api/ops/sre/replay-failed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed (${res.status})`);
      }
      const queued = (data as any)?.queued ?? 0;
      if (queued === 0) {
        toast.info('No failed webhooks to replay');
      } else {
        toast.success(`Replay queued for ${queued} failed webhook${queued === 1 ? '' : 's'}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Replay failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => run()}
      disabled={busy}
      className="gap-1.5 border-teal-500/40 text-teal-600 hover:bg-teal-500/10 dark:text-teal-400"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <RotateCw className="h-4 w-4" />
      )}
      Replay failed webhooks
    </Button>
  );
}
