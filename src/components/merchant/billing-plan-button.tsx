'use client';

import { useState } from 'react';
import { Check, Loader2, ArrowUpRight, ArrowDownRight } from 'lucide-react';
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
import type { PlanId } from '@/lib/subscription-plans';

type Props = {
  planId: PlanId;
  planName: string;
  isCurrent: boolean;
  /** 0 = starter, 1 = growth, 2 = scale, 3 = enterprise. */
  currentRank: number;
  targetRank: number;
};

/**
 * Per-card button used on the pricing grid. Renders as "Current Plan" (disabled)
 * when the card matches the merchant's plan, "Upgrade" when the card is a
 * higher tier, or "Downgrade" when lower. Confirming triggers a PATCH to
 * /api/subscription.
 */
export function BillingPlanButton({
  planId,
  planName,
  isCurrent,
  currentRank,
  targetRank,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (isCurrent) {
    return (
      <Button
        type="button"
        disabled
        className="w-full border-emerald-500/40 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
        variant="outline"
      >
        <Check className="mr-1.5 h-4 w-4" /> Current plan
      </Button>
    );
  }

  const isUpgrade = targetRank > currentRank;
  const verb = isUpgrade ? 'Upgrade' : 'Downgrade';

  async function confirm() {
    setBusy(true);
    try {
      const res = await fetch('/api/subscription', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed to ${verb.toLowerCase()} plan`);
      }
      toast.success(`${verb} to ${planName} complete`);
      setOpen(false);
      setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change plan');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={isUpgrade ? 'default' : 'outline'}
          className={
            isUpgrade
              ? 'w-full bg-emerald-600 text-white hover:bg-emerald-700'
              : 'w-full'
          }
        >
          {isUpgrade ? (
            <ArrowUpRight className="mr-1.5 h-4 w-4" />
          ) : (
            <ArrowDownRight className="mr-1.5 h-4 w-4" />
          )}
          {verb}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {verb} to {planName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isUpgrade
              ? `Your plan will change immediately. You'll be billed for the ${planName} plan from today.`
              : `Your plan will change at the end of the current billing cycle. Some features may become unavailable.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              confirm();
            }}
            disabled={busy}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Working…
              </>
            ) : (
              `Confirm ${verb.toLowerCase()}`
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
