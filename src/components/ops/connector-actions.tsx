'use client';

import { useState } from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface ConnectorActionsProps {
  connectorId: string;
  /** Whether the connector is currently paused. */
  paused: boolean;
  /** When true, only the appropriate button is shown (compact row layout). */
  compact?: boolean;
}

/**
 * Pause / Resume buttons for a production connector. PATCHes
 * /api/ops/connectors/[id] with `{ action: 'pause' | 'resume' }`.
 *
 * When `paused` is true, only the Resume button is shown (and vice-versa).
 */
export function ConnectorActions({
  connectorId,
  paused,
  compact = true,
}: ConnectorActionsProps) {
  const [busy, setBusy] = useState(false);

  async function runAction(action: 'pause' | 'resume') {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/ops/connectors/${encodeURIComponent(connectorId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Action failed (${res.status})`);
      }
      toast.success(
        action === 'pause'
          ? `Connector ${connectorId} paused`
          : `Connector ${connectorId} resumed`,
      );
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (paused) {
    return (
      <Button
        type="button"
        size={compact ? 'sm' : 'default'}
        variant="outline"
        onClick={() => runAction('resume')}
        disabled={busy}
        className={
          compact
            ? 'h-7 gap-1 px-2 text-[11px] border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400'
            : 'gap-1.5 border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400'
        }
      >
        {busy ? (
          <Loader2 className={compact ? 'h-3 w-3 animate-spin' : 'h-4 w-4 animate-spin'} />
        ) : (
          <Play className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
        )}
        Resume
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size={compact ? 'sm' : 'default'}
      variant="outline"
      onClick={() => runAction('pause')}
      disabled={busy}
      className={
        compact
          ? 'h-7 gap-1 px-2 text-[11px] border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400'
          : 'gap-1.5 border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400'
      }
    >
      {busy ? (
        <Loader2 className={compact ? 'h-3 w-3 animate-spin' : 'h-4 w-4 animate-spin'} />
      ) : (
        <Pause className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
      )}
      Pause
    </Button>
  );
}
