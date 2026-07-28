'use client';

import { useState } from 'react';
import { Loader2, Play, CheckCircle2, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { MaintenanceWindow } from '@/ops/types';

interface Props {
  window: MaintenanceWindow;
}

/**
 * Action buttons for a maintenance window. Start/Complete/Cancel call the
 * M-OPS-42 maintenance API. After a successful action the page is reloaded
 * so the new status reflects immediately.
 */
export function MaintenanceActions({ window }: Props) {
  const [busy, setBusy] = useState<'start' | 'complete' | 'cancel' | null>(null);

  async function run(action: 'start' | 'complete' | 'cancel') {
    setBusy(action);
    try {
      const res = await fetch(
        `/api/ops/maintenance/${encodeURIComponent(window.id)}/${action}`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Action failed (${res.status})`);
      }
      toast.success(`Maintenance ${action}d`);
      setTimeout(() => window_location_reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  const visible: ('start' | 'complete' | 'cancel')[] = [];
  if (window.status === 'scheduled') {
    visible.push('start', 'cancel');
  } else if (window.status === 'in_progress') {
    visible.push('complete', 'cancel');
  }

  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((action) => {
        const cfg =
          action === 'start'
            ? { label: 'Start', icon: Play, className: 'border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400' }
            : action === 'complete'
              ? { label: 'Complete', icon: CheckCircle2, className: 'border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400' }
              : { label: 'Cancel', icon: Ban, className: 'border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400' };
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
            className={`h-7 gap-1.5 px-2 text-[11px] ${cfg.className}`}
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
    </>
  );
}

// Wrapper so we can stub `window.location.reload` cleanly if needed.
function window_location_reload() {
  if (typeof window !== 'undefined') window.location.reload();
}
