'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, CreditCard, ArrowDownToLine, RefreshCcw, Users, ShieldAlert, Vault, Webhook, AlertTriangle, Activity, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface NotificationItem {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
  description: string;
  category: 'payment' | 'payout' | 'refund' | 'team' | 'compliance' | 'treasury' | 'webhook' | 'incident' | 'system';
  createdAt: string;
}

const CATEGORY_META: Record<
  NotificationItem['category'],
  { icon: React.ReactNode; tone: string }
> = {
  payment: {
    icon: <CreditCard className="h-3.5 w-3.5" />,
    tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  payout: {
    icon: <ArrowDownToLine className="h-3.5 w-3.5" />,
    tone: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  },
  refund: {
    icon: <RefreshCcw className="h-3.5 w-3.5" />,
    tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  team: {
    icon: <Users className="h-3.5 w-3.5" />,
    tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
  compliance: {
    icon: <ShieldAlert className="h-3.5 w-3.5" />,
    tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  },
  treasury: {
    icon: <Vault className="h-3.5 w-3.5" />,
    tone: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  },
  webhook: {
    icon: <Webhook className="h-3.5 w-3.5" />,
    tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
  incident: {
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  system: {
    icon: <Activity className="h-3.5 w-3.5" />,
    tone: 'bg-muted text-muted-foreground',
  },
};

const READ_AT_KEY = 'payswap:notifications:readAt';

function readStoredReadAt(): number {
  if (typeof window === 'undefined') return Date.now();
  try {
    const raw = window.localStorage.getItem(READ_AT_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return Date.now();
  }
}

function writeReadAt(ts: number) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(READ_AT_KEY, String(ts));
  } catch {
    // localStorage may be unavailable in private mode — ignore.
  }
}

function fmtRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Notification bell rendered in the unified shell header.
 *
 * Pulls the last 10 audit log entries from `/api/notifications` and shows
 * them in a dropdown panel. Unread state is tracked locally (localStorage
 * timestamp) — when the panel opens, the marker advances so the bell badge
 * clears.
 */
export function NotificationCenter() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [readAt, setReadAt] = useState<number>(() => readStoredReadAt());
  const [hydrated, setHydrated] = useState(false);

  // Fetch notifications on mount + every 30s while mounted.
  useEffect(() => {
    setHydrated(true);
    let cancelled = false;

    const fetchOnce = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/notifications', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.items)) {
          setItems(data.items as NotificationItem[]);
        }
      } catch {
        // Network failure — silently leave the current state.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchOnce();
    const timer = window.setInterval(fetchOnce, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // When the dropdown opens, advance the read marker so the badge clears.
  useEffect(() => {
    if (!open) return;
    const now = Date.now();
    writeReadAt(now);
    setReadAt(now);
  }, [open]);

  const unreadCount = hydrated
    ? items.filter((i) => new Date(i.createdAt).getTime() > readAt).length
    : 0;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {hydrated && unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-background">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <DropdownMenuLabel className="p-0 text-sm font-semibold">
            Notifications
          </DropdownMenuLabel>
          {hydrated && unreadCount > 0 && (
            <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
              {unreadCount} new
            </span>
          )}
        </div>

        <ScrollArea className="max-h-80">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                <Bell className="h-4 w-4" />
              </div>
              <p className="text-xs font-medium">You&apos;re all caught up</p>
              <p className="text-[11px] text-muted-foreground">
                New activity will appear here as it happens.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((item) => {
                const meta = CATEGORY_META[item.category] ?? CATEGORY_META.system;
                const isUnread = new Date(item.createdAt).getTime() > readAt;
                const isFailure = /error|fail|denied/i.test(item.result);
                return (
                  <li
                    key={item.id}
                    className={cn(
                      'flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-accent/40',
                      isUnread && 'bg-emerald-500/[0.04]',
                    )}
                  >
                    <div
                      className={cn(
                        'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                        meta.tone,
                      )}
                    >
                      {meta.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs font-medium">
                          {item.description}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {fmtRelative(item.createdAt)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span
                          className={cn(
                            'rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                            isFailure
                              ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                          )}
                        >
                          {item.result}
                        </span>
                        {isUnread && (
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>

        <DropdownMenuSeparator className="m-0" />
        <DropdownMenuItem asChild className="cursor-pointer py-2">
          <Link
            href="/dashboard/activity"
            className="flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
          >
            View all activity
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
