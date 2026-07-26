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

type AlertAction = 'INVESTIGATE' | 'ESCALATE' | 'CLOSE' | 'SAR';

interface AlertActionsProps {
  alertId: string;
  status: string;
}

interface ActionConfig {
  label: string;
  icon: typeof Search;
  className: string;
}

const ACTION_CONFIG: Record<AlertAction, ActionConfig> = {
  INVESTIGATE: {
    label: 'Investigate',
    icon: Search,
    className:
      'border-teal-500/40 text-teal-600 hover:bg-teal-500/10 dark:text-teal-400',
  },
  ESCALATE: {
    label: 'Escalate',
    icon: ArrowUpRight,
    className:
      'border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400',
  },
  CLOSE: {
    label: 'Close',
    icon: CheckCircle2,
    className:
      'border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400',
  },
  SAR: {
    label: 'File SAR',
    icon: FileWarning,
    className:
      'border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400',
  },
};

const TERMINAL_STATUSES = new Set(['CLOSED', 'SAR_FILED']);

/**
 * Per-row action buttons for an AML alert. The buttons shown depend on the
 * alert's current status:
 *
 *   OPEN          → Investigate, Escalate, Close, File SAR
 *   INVESTIGATING → Escalate, Close, File SAR
 *   ESCALATED     → Close, File SAR
 *   CLOSED        → (none — terminal)
 *   SAR_FILED     → (none — terminal)
 *
 * Each click PATCHes /api/compliance/alerts/[id] with the action verb, shows
 * a toast, and reloads the page so the new status reflects immediately.
 */
export function AlertActions({ alertId, status }: AlertActionsProps) {
  const [busyAction, setBusyAction] = useState<AlertAction | null>(null);
  const s = (status || '').toUpperCase();
  const isTerminal = TERMINAL_STATUSES.has(s);

  const available: AlertAction[] = isTerminal
    ? []
    : s === 'ESCALATED'
    ? ['CLOSE', 'SAR']
    : s === 'INVESTIGATING'
    ? ['ESCALATE', 'CLOSE', 'SAR']
    : ['INVESTIGATE', 'ESCALATE', 'CLOSE', 'SAR'];

  async function runAction(action: AlertAction) {
    setBusyAction(action);
    try {
      const res = await fetch(
        `/api/compliance/alerts/${encodeURIComponent(alertId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.error || `Action failed (${res.status})`,
        );
      }
      toast.success(`Alert ${ACTION_CONFIG[action].label.toLowerCase()}d`);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Action failed',
      );
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
