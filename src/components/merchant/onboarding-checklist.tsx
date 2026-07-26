'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  Building2,
  KeyRound,
  Webhook,
  Users,
  Package,
  CreditCard,
  ArrowDownToLine,
  X,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface ChecklistItemState {
  /** Stable key — also used to pick the icon. */
  id: string;
  label: string;
  href: string;
  description: string;
  done: boolean;
}

interface OnboardingChecklistProps {
  /** Pre-computed checklist items (the server component computes the `done`
   * flags from DB state and passes them in). */
  items: ChecklistItemState[];
}

const DISMISS_KEY = 'payswap:onboarding-checklist-dismissed';

/**
 * Tiny external store around the localStorage dismissal flag.
 *
 * `useSyncExternalStore` is the hydration-safe way to read from external
 * systems like localStorage without tripping the `react-hooks/set-state-in-effect`
 * lint rule. The server snapshot returns `false` so SSR + first client paint
 * match; the client snapshot reads the real value.
 */
const dismissStore = {
  listeners: new Set<() => void>(),
  subscribe(cb: () => void) {
    dismissStore.listeners.add(cb);
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', cb);
    }
    return () => {
      dismissStore.listeners.delete(cb);
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', cb);
      }
    };
  },
  getSnapshot(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  },
  getServerSnapshot(): boolean {
    return false;
  },
  set(value: boolean) {
    try {
      if (value) {
        window.localStorage.setItem(DISMISS_KEY, '1');
      } else {
        window.localStorage.removeItem(DISMISS_KEY);
      }
    } catch {
      // ignore — localStorage may be unavailable.
    }
    dismissStore.listeners.forEach((cb) => cb());
  },
};

/**
 * OnboardingChecklist — a first-run progress card shown above the dashboard
 * KPIs for new merchants.
 *
 * - Each row shows a checkbox reflecting the server-computed `done` state.
 * - The progress bar reflects the percentage of items already complete.
 * - Dismissible: stores a flag in localStorage so the user can hide it even
 *   before they've completed every step.
 * - Auto-hides once the merchant has completed every step.
 */
export function OnboardingChecklist({ items }: OnboardingChecklistProps) {
  const dismissed = useSyncExternalStore(
    dismissStore.subscribe,
    dismissStore.getSnapshot,
    dismissStore.getServerSnapshot,
  );

  function handleDismiss() {
    dismissStore.set(true);
  }

  // Hide entirely once the merchant has completed every step OR dismissed.
  const completedCount = items.filter((i) => i.done).length;
  const allDone = items.length > 0 && completedCount === items.length;
  const pct = items.length === 0 ? 0 : Math.round((completedCount / items.length) * 100);

  if (dismissed || allDone) return null;

  return (
    <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-background to-teal-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">Get started with PaySwap</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Complete these steps to set up your account and start taking payments.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={handleDismiss}
            aria-label="Dismiss onboarding checklist"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground">
              {completedCount} of {items.length} complete
            </span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {pct}%
            </span>
          </div>
          <Progress
            value={pct}
            className="h-2 bg-emerald-500/15 [&>div]:bg-emerald-500"
          />
        </div>

        <ol className="grid gap-2 sm:grid-cols-2">
          {items.map((item, idx) => {
            const Icon = ICON_MAP[item.id] ?? CheckCircle2;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className={cn(
                    'group flex items-start gap-3 rounded-lg border p-3 transition-colors',
                    item.done
                      ? 'border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10'
                      : 'border-border bg-card/40 hover:bg-accent/40',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                      item.done
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-muted text-muted-foreground',
                    )}
                    aria-hidden
                  >
                    {item.done ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <span
                        className={cn(
                          'text-sm font-medium',
                          item.done && 'text-muted-foreground line-through decoration-emerald-500/40',
                        )}
                      >
                        {item.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                      {item.description}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  profile: Building2,
  api_key: KeyRound,
  webhook: Webhook,
  customer: Users,
  product: Package,
  payment: CreditCard,
  payout: ArrowDownToLine,
};
