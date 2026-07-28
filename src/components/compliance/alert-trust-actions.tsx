'use client';

import { useState } from 'react';
import {
  Loader2,
  Search,
  ArrowUpRight,
  CheckCircle2,
  FileWarning,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

type AlertAction = 'investigate' | 'escalate' | 'close' | 'file-sar';

interface AlertTrustActionsProps {
  alertId: string;
  status: string;
}

const ACTION_CONFIG: Record<AlertAction, {
  label: string;
  apiAction: string;
  icon: typeof Search;
  className: string;
}> = {
  investigate: {
    label: 'Investigate',
    apiAction: 'investigate',
    icon: Search,
    className:
      'border-teal-500/40 text-teal-600 hover:bg-teal-500/10 dark:text-teal-400',
  },
  escalate: {
    label: 'Escalate',
    apiAction: 'escalate',
    icon: ArrowUpRight,
    className:
      'border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400',
  },
  close: {
    label: 'Close',
    apiAction: 'close',
    icon: CheckCircle2,
    className:
      'border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400',
  },
  'file-sar': {
    label: 'File SAR',
    apiAction: 'file-sar',
    icon: FileWarning,
    className:
      'border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400',
  },
};

const TERMINAL_STATUSES = new Set(['closed', 'sar_filed']);

/**
 * Per-row action buttons for an AML alert in the Trust Engine. Buttons
 * shown depend on the alert's status:
 *
 *   open          → investigate, escalate, close, file-sar
 *   investigating → escalate, close, file-sar
 *   escalated     → close, file-sar
 *   closed        → (terminal)
 *   sar_filed     → (terminal)
 *
 * Each click POSTs to /api/trust/alerts/[id]/<action> and reloads the page
 * so the new status reflects immediately.
 */
export function AlertTrustActions({
  alertId,
  status,
}: AlertTrustActionsProps) {
  const [busyAction, setBusyAction] = useState<AlertAction | null>(null);
  const s = (status || '').toLowerCase();
  const isTerminal = TERMINAL_STATUSES.has(s);

  const available: AlertAction[] = isTerminal
    ? []
    : s === 'escalated'
    ? ['close', 'file-sar']
    : s === 'investigating'
    ? ['escalate', 'close', 'file-sar']
    : ['investigate', 'escalate', 'close', 'file-sar'];

  async function runAction(action: AlertAction) {
    setBusyAction(action);
    try {
      const res = await fetch(
        `/api/trust/alerts/${encodeURIComponent(alertId)}/${ACTION_CONFIG[action].apiAction}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Action failed (${res.status})`);
      }
      toast.success(`Alert ${ACTION_CONFIG[action].label.toLowerCase()}d`);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyAction(null);
    }
  }

  if (available.length === 0) {
    return (
      <span className="text-[10px] text-muted-foreground italic">
        No actions
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {available.map((action) => {
        const cfg = ACTION_CONFIG[action];
        const Icon = cfg.icon;
        const isBusy = busyAction === action;
        return (
          <Button
            key={action}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => runAction(action)}
            disabled={busyAction !== null}
            className={`h-7 gap-1 px-2 text-[11px] ${cfg.className}`}
          >
            {isBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Icon className="h-3 w-3" />
            )}
            {cfg.label}
          </Button>
        );
      })}
    </div>
  );
}
