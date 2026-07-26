'use client';

import { useState } from 'react';
import { Loader2, UserCheck, CheckCircle2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface IncidentActionsProps {
  incidentId: string;
  /** Whether the incident is already acknowledged. */
  acknowledged: boolean;
  /** Whether the incident is already resolved. */
  resolved: boolean;
  /** Whether the incident is currently assigned. */
  assigned: boolean;
}

type Action = 'ASSIGN' | 'ACKNOWLEDGE' | 'RESOLVE';

const CONFIG: Record<
  Action,
  { label: string; icon: typeof UserCheck; className: string }
> = {
  ASSIGN: {
    label: 'Assign to me',
    icon: UserCheck,
    className:
      'border-teal-500/40 text-teal-600 hover:bg-teal-500/10 dark:text-teal-400',
  },
  ACKNOWLEDGE: {
    label: 'Acknowledge',
    icon: ShieldCheck,
    className:
      'border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400',
  },
  RESOLVE: {
    label: 'Resolve',
    icon: CheckCircle2,
    className:
      'border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400',
  },
};

/**
 * Action buttons for an incident detail view. Each button PATCHes
 * /api/incidents/[id] with the action verb. Resolves toast and reloads the
 * page so the new state reflects immediately.
 */
export function IncidentActions({
  incidentId,
  acknowledged,
  resolved,
  assigned,
}: IncidentActionsProps) {
  const [busy, setBusy] = useState<Action | null>(null);

  async function run(action: Action) {
    setBusy(action);
    try {
      const res = await fetch(
        `/api/incidents/${encodeURIComponent(incidentId)}`,
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
      toast.success(`${CONFIG[action].label} succeeded`);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  // Build the visible action set based on incident state.
  const visible: Action[] = [];
  if (!resolved) {
    if (!assigned) visible.push('ASSIGN');
    if (!acknowledged) visible.push('ACKNOWLEDGE');
    visible.push('RESOLVE');
  }

  if (visible.length === 0) {
    return (
      <span className="text-xs text-muted-foreground italic">
        No further actions
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {visible.map((action) => {
        const cfg = CONFIG[action];
        const Icon = cfg.icon;
        const isBusy = busy === action;
        return (
          <Button
            key={action}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => run(action)}
            disabled={busy !== null}
            className={`h-8 gap-1.5 px-2.5 text-xs ${cfg.className}`}
          >
            {isBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Icon className="h-3.5 w-3.5" />
            )}
            {cfg.label}
          </Button>
        );
      })}
    </div>
  );
}
