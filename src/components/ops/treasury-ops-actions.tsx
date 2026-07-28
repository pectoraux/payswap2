'use client';

import { useState } from 'react';
import { Loader2, Check, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { TreasuryOperation } from '@/ops/types';

interface Props {
  op: TreasuryOperation;
}

/**
 * Action buttons for a treasury operation: approve (if pending), execute
 * (if approved). Calls the M-OPS-42 treasury-ops API.
 */
export function TreasuryOpsActions({ op }: Props) {
  const [busy, setBusy] = useState<'approve' | 'execute' | null>(null);

  async function run(action: 'approve' | 'execute') {
    setBusy(action);
    try {
      const res = await fetch(
        `/api/ops/treasury-ops/${encodeURIComponent(op.id)}/${action}`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Action failed (${res.status})`);
      }
      toast.success(`Operation ${action}d`);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  const visible: ('approve' | 'execute')[] = [];
  if (op.status === 'pending') visible.push('approve');
  if (op.status === 'approved') visible.push('execute');
  if (visible.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {visible.map((action) => {
        const cfg =
          action === 'approve'
            ? {
                label: 'Approve',
                icon: Check,
                className:
                  'border-sky-500/40 text-sky-600 hover:bg-sky-500/10 dark:text-sky-400',
              }
            : {
                label: 'Execute',
                icon: Play,
                className:
                  'border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400',
              };
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
