'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { Beaker, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type EnvMode = 'sandbox' | 'live';

const STORAGE_KEY = 'payswap.env-mode';
// Custom event dispatched after a same-window write so useSyncExternalStore
// subscribers re-render. (The native `storage` event only fires in *other*
// windows, so we need our own for the window that made the change.)
const CHANGE_EVENT = 'payswap:env-mode-change';

function readStoredMode(): EnvMode {
  if (typeof window === 'undefined') return 'sandbox';
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'live' ? 'live' : 'sandbox';
  } catch {
    return 'sandbox';
  }
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function getSnapshot(): EnvMode {
  return readStoredMode();
}

function getServerSnapshot(): EnvMode {
  return 'sandbox';
}

function writeStoredMode(next: EnvMode) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
    // Also set a cookie so server-side API routes can read the environment
    document.cookie = `payswap-env-mode=${next}; path=/; max-age=${30 * 24 * 60 * 60}; samesite=lax`;
  } catch {
    // ignore storage errors (private mode, full quota, etc.)
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Imperatively set the environment mode. Persists to localStorage and
 * notifies all subscribers (including the `useEnvMode` hook and any mounted
 * `<EnvSwitcher />`).
 *
 * This is exported so that other surfaces — e.g. the global command palette —
 * can toggle the environment without remounting the switcher.
 */
export function setEnvMode(next: EnvMode): void {
  writeStoredMode(next);
}

/**
 * React hook that returns the current environment mode and re-renders when it
 * changes. Uses the same external store as `<EnvSwitcher />`, so the two are
 * always in sync.
 */
export function useEnvMode(): EnvMode {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Sandbox / Live environment toggle that lives in the unified shell header.
 *
 * - Violet "Sandbox" badge or sky-blue "Live" badge.
 * - Selection is persisted to localStorage and synced across components via
 *   `useSyncExternalStore`.
 * - Toasts on switch so the user gets clear feedback.
 */
export function EnvSwitcher() {
  // useSyncExternalStore handles SSR/hydration: the server snapshot is always
  // 'sandbox', and after hydration the client reads the real stored value.
  const mode = useEnvMode();
  const [switching, setSwitching] = useState(false);

  const toggle = useCallback(async () => {
    if (switching) return;
    const next: EnvMode = mode === 'sandbox' ? 'live' : 'sandbox';
    setSwitching(true);
    try {
      // 1. Switch the in-memory RuntimeHost's active environment so all
      //    runtime calls (sandbox/live) follow the user's choice. Without
      //    this the badge is cosmetic — runtime queries still hit the old
      //    environment.
      const res = await fetch('/api/runtime/host', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: next }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error || `HTTP ${res.status}`);
      }
      // 2. Persist locally (localStorage + cookie) so server-rendered routes
      //    that read the `payswap-env-mode` cookie also see the new env.
      writeStoredMode(next);
      toast.success(
        next === 'live' ? 'Switched to Live mode' : 'Switched to Sandbox mode',
        {
          description:
            next === 'live'
              ? 'Real transactions will be processed.'
              : 'No real funds will move in this mode.',
        },
      );
      // 3. Reload to refresh server-rendered data with the new environment.
      setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      // 4. On failure, the stored mode was never updated so the badge
      //    naturally reverts. Surface the error and re-dispatch the change
      //    event so any optimistic subscribers re-sync to the unchanged
      //    store value.
      toast.error('Failed to switch environment', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } finally {
      setSwitching(false);
    }
  }, [mode, switching]);

  const isLive = mode === 'live';

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={toggle}
      disabled={switching}
      aria-label={`Environment: ${isLive ? 'Live' : 'Sandbox'}. Click to switch.`}
      title={
        switching
          ? 'Switching environment…'
          : isLive
            ? 'Live mode — click to switch to Sandbox'
            : 'Sandbox mode — click to switch to Live'
      }
      className={cn(
        'h-9 shrink-0 gap-1.5 rounded-md border px-2.5 text-xs font-semibold',
        isLive
          ? 'border-sky-500/30 bg-sky-500/10 text-sky-600 hover:bg-sky-500/15 dark:text-sky-300'
          : 'border-violet-500/30 bg-violet-500/10 text-violet-600 hover:bg-violet-500/15 dark:text-violet-300',
        switching && 'opacity-60',
      )}
    >
      {isLive ? <Zap className="h-3.5 w-3.5" /> : <Beaker className="h-3.5 w-3.5" />}
      {isLive ? 'Live' : 'Sandbox'}
    </Button>
  );
}
