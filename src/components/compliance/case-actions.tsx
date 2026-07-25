'use client';

import { useState } from 'react';
import {
  Loader2,
  UserCheck,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type CaseAction = 'ASSIGN' | 'ESCALATE' | 'APPROVE' | 'REJECT' | 'CLOSE';

interface CaseActionsProps {
  caseId: string;
  status: string;
}

interface ActionConfig {
  label: string;
  icon: typeof UserCheck;
  className: string;
  needsAssignee?: boolean;
}

const ACTION_CONFIG: Record<CaseAction, ActionConfig> = {
  ASSIGN: {
    label: 'Assign',
    icon: UserCheck,
    className:
      'border-teal-500/40 text-teal-600 hover:bg-teal-500/10 dark:text-teal-400',
    needsAssignee: true,
  },
  ESCALATE: {
    label: 'Escalate',
    icon: ArrowUpRight,
    className:
      'border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400',
  },
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
  CLOSE: {
    label: 'Close',
    icon: Lock,
    className:
      'border-zinc-500/40 text-zinc-700 hover:bg-zinc-500/10 dark:text-zinc-300',
  },
};

const TERMINAL_STATUSES = new Set(['APPROVED', 'REJECTED', 'CLOSED']);

/**
 * Per-row action buttons for a compliance case. Actions available depend on
 * the case's current status:
 *
 *   OPEN         → Assign, Escalate, Approve, Reject, Close
 *   ESCALATED    → Assign, Approve, Reject, Close
 *   APPROVED     → (terminal)
 *   REJECTED     → (terminal)
 *   CLOSED       → (terminal)
 *
 * Each click PATCHes /api/compliance/cases/[id]. ASSIGN opens a small dialog
 * to capture the assignee (an email or user id) since the API requires it.
 */
export function CaseActions({ caseId, status }: CaseActionsProps) {
  const [busyAction, setBusyAction] = useState<CaseAction | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [notes, setNotes] = useState('');

  const s = (status || '').toUpperCase();
  const isTerminal = TERMINAL_STATUSES.has(s);

  const available: CaseAction[] = isTerminal
    ? []
    : s === 'ESCALATED'
    ? ['ASSIGN', 'APPROVE', 'REJECT', 'CLOSE']
    : ['ASSIGN', 'ESCALATE', 'APPROVE', 'REJECT', 'CLOSE'];

  async function runAction(action: CaseAction, body: Record<string, unknown> = {}) {
    setBusyAction(action);
    try {
      const res = await fetch(
        `/api/compliance/cases/${encodeURIComponent(caseId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...body }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Action failed (${res.status})`);
      }
      toast.success(`Case ${ACTION_CONFIG[action].label.toLowerCase()}ed`);
      setAssignOpen(false);
      setAssignee('');
      setNotes('');
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

        if (cfg.needsAssignee) {
          return (
            <Dialog
              key={action}
              open={assignOpen}
              onOpenChange={(v) => {
                setAssignOpen(v);
                if (!v) {
                  setAssignee('');
                  setNotes('');
                }
              }}
            >
              <DialogTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
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
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Assign case</DialogTitle>
                  <DialogDescription>
                    Hand this case off to a reviewer. The assignee can be a
                    user id or email — whoever picks it up next will see it in
                    their queue.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="assignee">Assignee</Label>
                    <Input
                      id="assignee"
                      placeholder="user@payswap.io or user id"
                      value={assignee}
                      onChange={(e) => setAssignee(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="assign-notes">Notes (optional)</Label>
                    <Textarea
                      id="assign-notes"
                      placeholder="Context for the assignee"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="min-h-20"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAssignOpen(false)}
                    disabled={busyAction !== null}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      if (!assignee.trim()) {
                        toast.error('Please enter an assignee');
                        return;
                      }
                      void runAction('ASSIGN', {
                        assignee: assignee.trim(),
                        notes: notes.trim() || undefined,
                      });
                    }}
                    disabled={busyAction !== null || !assignee.trim()}
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    {busyAction ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />{' '}
                        Assigning…
                      </>
                    ) : (
                      'Assign case'
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          );
        }

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
