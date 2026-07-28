'use client';

import { useState } from 'react';
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

type SanctionsAction = 'true_positive' | 'false_positive' | 'review';

interface SanctionsResolveActionsProps {
  screeningId: string;
  status: string;
}

const ACTION_CONFIG: Record<SanctionsAction, {
  label: string;
  icon: typeof CheckCircle2;
  className: string;
}> = {
  true_positive: {
    label: 'True positive',
    icon: XCircle,
    className:
      'border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400',
  },
  false_positive: {
    label: 'False positive',
    icon: CheckCircle2,
    className:
      'border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400',
  },
  review: {
    label: 'Review',
    icon: AlertTriangle,
    className:
      'border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400',
  },
};

const TERMINAL_STATUSES = new Set(['true_positive', 'false_positive']);

export function SanctionsResolveActions({
  screeningId,
  status,
}: SanctionsResolveActionsProps) {
  const [busyAction, setBusyAction] = useState<SanctionsAction | null>(null);
  const s = (status || '').toLowerCase();
  const isTerminal = TERMINAL_STATUSES.has(s);

  const available: SanctionsAction[] = isTerminal ? [] : ['true_positive', 'false_positive', 'review'];

  async function runAction(action: SanctionsAction) {
    setBusyAction(action);
    try {
      const res = await fetch(
        `/api/trust/sanctions/${encodeURIComponent(screeningId)}/resolve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: action }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Action failed (${res.status})`);
      }
      toast.success(`Screening marked as ${action.replace('_', ' ')}`);
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
        Resolved
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
