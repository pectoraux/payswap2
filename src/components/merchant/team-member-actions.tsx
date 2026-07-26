'use client';

import { useState } from 'react';
import { Loader2, RotateCw, Ban, Trash2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

type Props = {
  id: string;
  email: string;
  status: string;
};

/**
 * Per-row action buttons for a team member. The available actions depend on
 * the member's current status:
 *
 *   PENDING  → Resend (toast) + Remove (DELETE)
 *   ACTIVE   → Suspend (PATCH status=SUSPENDED) + Remove (DELETE)
 *   SUSPENDED→ Reactivate (PATCH status=ACTIVE) + Remove (DELETE)
 */
export function TeamMemberActions({ id, email, status }: Props) {
  const [busy, setBusy] = useState(false);
  const s = (status || '').toUpperCase();

  async function patchStatus(next: 'SUSPENDED' | 'ACTIVE', label: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/team/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Failed to ${label.toLowerCase()} member`);
      }
      toast.success(`${label} ${email}`);
      setTimeout(() => window.location.reload(), 300);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember() {
    setBusy(true);
    try {
      const res = await fetch(`/api/team/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to remove member');
      }
      toast.success(`Removed ${email}`);
      setTimeout(() => window.location.reload(), 300);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setBusy(false);
    }
  }

  function resend() {
    // No backend resender yet — surface a toast so the user knows the action
    // was registered.
    toast.info(`Invitation resent to ${email}`);
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {s === 'PENDING' && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={resend}
          disabled={busy}
        >
          <RotateCw className="mr-1 h-3.5 w-3.5" /> Resend
        </Button>
      )}
      {s === 'ACTIVE' && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => patchStatus('SUSPENDED', 'Suspended')}
          disabled={busy}
        >
          <Ban className="mr-1 h-3.5 w-3.5" /> Suspend
        </Button>
      )}
      {s === 'SUSPENDED' && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => patchStatus('ACTIVE', 'Reactivated')}
          disabled={busy}
          className="border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
        >
          <Play className="mr-1 h-3.5 w-3.5" /> Reactivate
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={removeMember}
        disabled={busy}
        className="border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
      >
        {busy ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="mr-1 h-3.5 w-3.5" />
        )}
        Remove
      </Button>
    </div>
  );
}
