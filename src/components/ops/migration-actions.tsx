'use client';

import { useState } from 'react';
import { Loader2, Play, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Migration } from '@/ops/types';

interface Props {
  migration: Migration;
}

/**
 * Action buttons for a migration: start (if planned), rollback (if
 * in_progress or completed). Rollback requires a reason and uses a
 * confirmation dialog.
 */
export function MigrationActions({ migration }: Props) {
  const [busy, setBusy] = useState<'start' | 'rollback' | null>(null);
  const [rollbackReason, setRollbackReason] = useState('');

  async function run(action: 'start' | 'rollback', reason?: string) {
    setBusy(action);
    try {
      const res = await fetch(
        `/api/ops/migrations/${encodeURIComponent(migration.id)}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reason ? { reason } : {}),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Action failed (${res.status})`);
      }
      toast.success(`Migration ${action}ed`);
      setRollbackReason('');
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  const visible: ('start' | 'rollback')[] = [];
  if (migration.status === 'planned') visible.push('start');
  if (
    migration.status === 'in_progress' ||
    migration.status === 'completed' ||
    migration.status === 'failed'
  ) {
    visible.push('rollback');
  }

  if (visible.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {visible.includes('start') && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => run('start')}
          disabled={busy !== null}
          className="h-7 gap-1 px-2 text-[11px] border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
        >
          {busy === 'start' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          Start
        </Button>
      )}
      {visible.includes('rollback') && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              className="h-7 gap-1 px-2 text-[11px] border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
            >
              {busy === 'rollback' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3" />
              )}
              Roll back
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Roll back migration?</AlertDialogTitle>
              <AlertDialogDescription>
                This will mark “{migration.name}” as rolled back. The rollback
                plan will need to be executed manually. Provide a reason for
                the audit log.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="rollback-reason">Reason</Label>
              <Input
                id="rollback-reason"
                placeholder="e.g. verification suite failed"
                value={rollbackReason}
                onChange={(e) => setRollbackReason(e.target.value)}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={!rollbackReason.trim() || busy !== null}
                onClick={() => run('rollback', rollbackReason.trim())}
              >
                {busy === 'rollback' ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Rolling back…
                  </>
                ) : (
                  'Roll back'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
