'use client';

import { useState } from 'react';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

type KycAction = 'APPROVE' | 'REJECT' | 'REQUEST_REVIEW';

interface KycActionsProps {
  reviewId: string;
  status: string;
}

interface ActionConfig {
  label: string;
  icon: typeof CheckCircle2;
  className: string;
}

const ACTION_CONFIG: Record<KycAction, ActionConfig> = {
  APPROVE: {
    label: 'Approve',
    icon: CheckCircle2,
    className:
      'border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400',
  },
  REJECT: {
    label: 'Reject',
    icon: XCircle,
    className:
      'border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400',
  },
  REQUEST_REVIEW: {
    label: 'Flag',
    icon: AlertTriangle,
    className:
      'border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400',
  },
};

const TERMINAL_STATUSES = new Set(['APPROVED', 'REJECTED']);

/**
 * Per-row action buttons for a KYC compliance review. The buttons shown
 * depend on the review's current status:
 *
 *   PENDING        → Approve, Reject, Flag
 *   REVIEW_NEEDED  → Approve, Reject
 *   APPROVED       → (terminal — no actions)
 *   REJECTED       → (terminal — no actions)
 *
 * Each click PATCHes /api/compliance/kyc/[id] with the action verb, shows
 * a toast, and reloads the page so the new status reflects immediately.
 */
export function KycActions({ reviewId, status }: KycActionsProps) {
  const [busyAction, setBusyAction] = useState<KycAction | null>(null);
  const s = (status || '').toUpperCase();
  const isTerminal = TERMINAL_STATUSES.has(s);

  const available: KycAction[] = isTerminal
    ? []
    : s === 'REVIEW_NEEDED'
    ? ['APPROVE', 'REJECT']
    : ['APPROVE', 'REJECT', 'REQUEST_REVIEW'];

  async function runAction(action: KycAction) {
    setBusyAction(action);
    try {
      const res = await fetch(
        `/api/compliance/kyc/${encodeURIComponent(reviewId)}`,
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
      toast.success(`KYC review ${ACTION_CONFIG[action].label.toLowerCase()}d`);
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
